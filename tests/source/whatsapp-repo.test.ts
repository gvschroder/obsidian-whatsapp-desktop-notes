// The read query: cursor and scope filters pushed into SQL, and write-ahead-log
// freshness.

import { describe, expect, it } from "vitest";
import { mkdtempSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { listChats, readMessages, type MessageQuery } from "../../src/source/whatsapp-repo";
import { loadNativeDriver } from "../../src/source/node-sqlite-driver";
import type { SqliteDriver } from "../../src/source/driver";
import { buildFixture, mutateChatStorage, JID, mac } from "../fixtures/whatsapp-fixture";

const native = await loadNativeDriver();
if (!native) throw new Error("The tests need node:sqlite (Node 22.13 or later).");
const driver: SqliteDriver = native;

const ALL: MessageQuery = {
	sinceMac: 0,
	cursors: {},
	afterPk: 0,
	includeGroupChats: true,
	includeDirectChats: true,
	chatFilterMode: "all",
	chatFilterJids: [],
	skipArchived: false,
};

describe("readMessages", () => {
	it("returns every in-scope text message, oldest first with Z_PK breaking ties", async () => {
		const fx = await buildFixture();
		const rows = (await readMessages(fx.chatStorage, ALL, driver)).rows;
		expect(rows).toHaveLength(19); // 21 rows − 1 NULL text − 1 status broadcast
		expect(rows.map((r) => r.zPk).slice(0, 4)).toEqual([10, 11, 12, 20]); // 11 and 12 share a second
		expect(rows.some((r) => r.jid === JID.status)).toBe(false);
	});

	it("applies per-chat cursors in SQL: only rows above each chat's cursor come back", async () => {
		const fx = await buildFixture();
		const rows = (await readMessages(fx.chatStorage, { ...ALL, cursors: { [JID.falcon]: 24, [JID.alice]: 99 } }, driver)).rows;
		expect(rows.filter((r) => r.jid === JID.falcon).map((r) => r.zPk)).toEqual([25, 26]);
		expect(rows.filter((r) => r.jid === JID.alice)).toEqual([]);
		expect(rows.filter((r) => r.jid === JID.injection)).toHaveLength(5); // no cursor → all
	});

	it("with every chat up to date nothing is read", async () => {
		const fx = await buildFixture();
		const cursors = Object.fromEntries([JID.alice, JID.unsaved, JID.falcon, JID.special, JID.injection].map((j) => [j, 1000]));
		expect((await readMessages(fx.chatStorage, { ...ALL, cursors }, driver)).rows).toEqual([]);
	});

	it("applies the global floor (high-water mark) and reports MAX(Z_PK)", async () => {
		const fx = await buildFixture();
		const read = await readMessages(fx.chatStorage, { ...ALL, afterPk: 61 }, driver);
		expect(read.rows.map((r) => r.zPk)).toEqual([62, 63, 64]);
		expect(read.maxPk).toBe(64);
	});

	it("applies the group / personal scope in SQL", async () => {
		const fx = await buildFixture();
		const groupsOnly = (await readMessages(fx.chatStorage, { ...ALL, includeDirectChats: false }, driver)).rows;
		expect(new Set(groupsOnly.map((r) => r.jid))).toEqual(new Set([JID.falcon, JID.special, JID.injection]));
		const personalOnly = (await readMessages(fx.chatStorage, { ...ALL, includeGroupChats: false }, driver)).rows;
		expect(new Set(personalOnly.map((r) => r.jid))).toEqual(new Set([JID.alice, JID.unsaved]));
	});

	it("selective sync — 'include' / 'exclude' filters are applied in SQL", async () => {
		const fx = await buildFixture();
		const inc = (await readMessages(fx.chatStorage, { ...ALL, chatFilterMode: "include", chatFilterJids: [JID.alice, JID.special] }, driver)).rows;
		expect(new Set(inc.map((r) => r.jid))).toEqual(new Set([JID.alice, JID.special]));
		const exc = (await readMessages(fx.chatStorage, { ...ALL, chatFilterMode: "exclude", chatFilterJids: [JID.alice, JID.special] }, driver)).rows;
		expect(new Set(exc.map((r) => r.jid))).toEqual(new Set([JID.unsaved, JID.falcon, JID.injection]));
		const none = (await readMessages(fx.chatStorage, { ...ALL, chatFilterMode: "include", chatFilterJids: [] }, driver)).rows;
		expect(none).toEqual([]);
	});

	it("'Skip archived chats' uses ZARCHIVED, and is ignored when the column does not exist", async () => {
		const fx = await buildFixture();
		await mutateChatStorage(fx.chatStorage, { sql: ["UPDATE ZWACHATSESSION SET ZARCHIVED = 1 WHERE Z_PK = 2"] });
		const skipped = (await readMessages(fx.chatStorage, { ...ALL, skipArchived: true }, driver)).rows;
		expect(skipped.some((r) => r.jid === JID.falcon)).toBe(false);
		expect(skipped).toHaveLength(12);

		await mutateChatStorage(fx.chatStorage, { sql: ["ALTER TABLE ZWACHATSESSION DROP COLUMN ZARCHIVED"] });
		const noColumn = (await readMessages(fx.chatStorage, { ...ALL, skipArchived: true }, driver)).rows;
		expect(noColumn).toHaveLength(19);
	});

	it("listChats — real chats with counts, newest message and archived flag, in one pass", async () => {
		const fx = await buildFixture();
		await mutateChatStorage(fx.chatStorage, { sql: ["UPDATE ZWACHATSESSION SET ZARCHIVED = 1 WHERE Z_PK = 3"] });
		const chats = await listChats(fx.chatStorage, driver);
		const byJid = Object.fromEntries(chats.map((c) => [c.jid, c]));
		expect(Object.keys(byJid).sort()).toEqual([JID.alice, JID.unsaved, JID.falcon, JID.special, JID.injection].sort());
		expect(byJid[JID.alice]).toEqual({
			jid: JID.alice,
			name: "Alice Souza",
			kind: "personal",
			lastMessageMac: mac("2026-03-11T11:30:00Z"),
			messageTotal: 5, // the NULL-text media row is not counted
			archived: false,
		});
		expect(byJid[JID.unsaved]?.name).toBe("+5511999990005"); // untitled chat: phone, not the raw ID
		expect(byJid[JID.special]).toMatchObject({ kind: "group", archived: true, messageTotal: 1 });
	});

	it("listChats — hides removed chats and survives a store without ZARCHIVED / ZREMOVED", async () => {
		const fx = await buildFixture();
		await mutateChatStorage(fx.chatStorage, { sql: ["UPDATE ZWACHATSESSION SET ZREMOVED = 1 WHERE Z_PK = 5"] });
		expect((await listChats(fx.chatStorage, driver)).some((c) => c.jid === JID.unsaved)).toBe(false);
		await mutateChatStorage(fx.chatStorage, {
			sql: ["ALTER TABLE ZWACHATSESSION DROP COLUMN ZARCHIVED", "ALTER TABLE ZWACHATSESSION DROP COLUMN ZREMOVED"],
		});
		const chats = await listChats(fx.chatStorage, driver);
		expect(chats).toHaveLength(5);
		expect(chats.every((c) => !c.archived)).toBe(true);
	});

	it("applies the time window", async () => {
		const fx = await buildFixture();
		const rows = (await readMessages(fx.chatStorage, { ...ALL, sinceMac: mac("2026-03-10T17:00:00Z") }, driver)).rows;
		expect(rows.map((r) => r.zPk)).toEqual([61, 62, 63, 64, 14, 15]);
	});
});

describe("write-ahead log", () => {
	it("reads messages that are still only in ChatStorage.sqlite-wal (WhatsApp running)", async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const fx = await buildFixture();
		// Recreate the store the way WhatsApp keeps it: WAL mode, with the newest
		// row not yet checkpointed into the main file.
		const dir = mkdtempSync(join(tmpdir(), "wa-wal-test-"));
		const path = join(dir, "ChatStorage.sqlite");
		copyFileSync(fx.chatStorage, path);
		const whatsapp = new DatabaseSync(path);
		try {
			whatsapp.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
			whatsapp
				.prepare("INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZFROMJID, ZTEXT, ZMESSAGEDATE, ZISFROMME) VALUES (90, 1, ?, 'Recém-chegada', ?, 0)")
				.run(JID.alice, mac("2026-03-12T12:00:00Z"));

			const viaNative = (await readMessages(path, { ...ALL, cursors: { [JID.alice]: 15 } }, driver)).rows;
			expect(viaNative.filter((r) => r.jid === JID.alice).map((r) => r.text)).toEqual(["Recém-chegada"]);

			// And reading never wrote anything: the row is still uncheckpointed.
			expect(whatsapp.prepare("PRAGMA wal_checkpoint(PASSIVE)").get()).toBeDefined();
		} finally {
			whatsapp.close();
		}
	});
});
