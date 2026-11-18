// Characterization ("golden master") tests: they pin the plugin's output so
// refactors can be proven behaviour-neutral. Any intentional output change must
// show up as a reviewed diff of tests/characterization/__golden__/ (regenerate
// with `npx vitest run -u`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import type { Vault as ObsidianVault } from "obsidian";

import { rebuildChats, runIncrementalSync, type SyncHooks } from "../../src/sync-service";
import { scopeKey } from "../../src/core/planner";
import { startSyncing, stopSyncing, storeList } from "../../src/core/selection";
import { inspectChatStorage } from "../../src/source/whatsapp-repo";
import { loadNativeDriver } from "../../src/source/node-sqlite-driver";
import type { SqliteDriver } from "../../src/source/driver";
import { log } from "../../src/util/logger";
import { userMessage } from "../../src/core/errors";
import { DEFAULT_SETTINGS, emptyState, type SyncState, type UserSettings } from "../../src/core/types";
import { Vault } from "../mocks/obsidian";
import { buildFixture, mutateChatStorage, FixturePaths, JID, INJECTION_PAYLOADS } from "../fixtures/whatsapp-fixture";

// Wrap the fs calls a temp-file snapshot would need, the test can assert they are
// never made by the plugin (the fixture builder's own calls are cleared first).
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>();
	return { ...actual, mkdtempSync: vi.fn(actual.mkdtempSync), copyFileSync: vi.fn(actual.copyFileSync) };
});

const asVault = (v: Vault): ObsidianVault => v as unknown as ObsidianVault;
const neverCancel = { isCancelled: () => false };

interface Config {
	settings: UserSettings;
	state: SyncState;
}

function configFor(fx: FixturePaths, overrides: Partial<UserSettings> = {}): Config {
	return {
		settings: {
			...structuredClone(DEFAULT_SETTINGS),
			chatStoragePathOverride: fx.chatStorage,
			periodDays: 0, // all history: the fixture uses fixed 2026-03 dates
			selfDisplayName: "Eu",
			...overrides,
		},
		state: emptyState(),
	};
}

// Every scenario reads the fixture through node:sqlite, as the plugin does.
const native = await loadNativeDriver();
if (!native) throw new Error("The tests need node:sqlite (Node 22.13 or later).");
const driver: SqliteDriver = native;

function sync(vault: Vault, cfg: Config, opts: SyncHooks = neverCancel): ReturnType<typeof runIncrementalSync> {
	return runIncrementalSync(asVault(vault), cfg.settings, cfg.state, { driver, ...opts });
}

function rebuild(vault: Vault, cfg: Config, ...jids: string[]): ReturnType<typeof rebuildChats> {
	return rebuildChats(asVault(vault), cfg.settings, cfg.state, jids, { driver });
}

const FALCON = "WhatsApp/Groups/Projeto Falcon.md";
const ALICE_PREFIX = "WhatsApp/Personal/Alice Souza";

function noteContaining(vault: Vault, fragment: string): string {
	return [...vault.files.entries()].find(([p]) => p.includes(fragment))?.[1] ?? "";
}

let fx: FixturePaths;
beforeEach(async () => {
	fx = await buildFixture();
});

describe("sync", () => {

	describe("first sync", () => {
		it("writes one transcript per chat plus the index (golden)", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);

			const summary = await sync(vault, cfg);

			expect(summary).toEqual({ chatsUpdated: 5, messagesSaved: 19, failedChats: 0 });
			await expect(vault.dump()).toMatchFileSnapshot("__golden__/first-sync.md");
			await expect(JSON.stringify(cfg.state.chatRecords, null, 2)).toMatchFileSnapshot("__golden__/first-sync.state.json");
		});

		it("skips status broadcast and media rows (NULL text)", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			expect(vault.dump()).not.toContain("Status de alguém");
			expect(Object.keys(cfg.state.chatRecords)).not.toContain(JID.status);
		});

		it("resolves group senders: contact → push-name → phone → Member-<hash>", async () => {
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const falcon = vault.files.get(FALCON) ?? "";
			expect(falcon).toContain("— Bruno Lima: Contato salvo (Bruno)");
			expect(falcon).toContain("— Carla ⚡: Só push-name (Carla)");
			expect(falcon).toContain("— +5511988887777: Só telefone");
			expect(falcon).toContain("— Member-1uyzqlg: LID desconhecido");
			expect(falcon).toContain("— Member-zpvto3: Push-name opaco");
			expect(falcon).toContain("— +5511966665555: Ponte LID → telefone");
			expect(falcon).toContain("— Eu: Linha 1\nLinha 2");
		});

		it("without ContactsV2 falls back to push-names and Member-<hash>", async () => {
			const noContacts = await buildFixture({ withContacts: false });
			const vault = new Vault();
			await sync(vault, configFor(noContacts));
			const falcon = vault.files.get(FALCON) ?? "";
			expect(falcon).toContain("— Bruninho: Contato salvo (Bruno)");
			expect(falcon).toContain("— Carla ⚡: Só push-name (Carla)");
			expect(falcon).toContain("— Member-");
		});

		it("respects 'Sync group chats' = off", async () => {
			const vault = new Vault();
			const summary = await sync(vault, configFor(fx, { includeGroupChats: false }));
			expect(summary.chatsUpdated).toBe(2);
			expect([...vault.files.keys()].some((p) => p.includes("/Groups/"))).toBe(false);
		});

		it("respects 'Sync personal chats' = off", async () => {
			const vault = new Vault();
			const summary = await sync(vault, configFor(fx, { includeDirectChats: false }));
			expect(summary.chatsUpdated).toBe(3);
			expect([...vault.files.keys()].some((p) => p.includes("/Personal/"))).toBe(false);
		});

		it("a missing database fails with a message that explains the fixes", async () => {
			const cfg = configFor(fx, { chatStoragePathOverride: "/nonexistent/ChatStorage.sqlite" });
			const error: unknown = await sync(new Vault(), cfg).then(
				() => null,
				(e: unknown) => e,
			);
			expect(error).toBeInstanceOf(Error);
			expect(userMessage(error)).toMatch(/Could not open WhatsApp's database.*Full Disk Access/);
		});

		it("stops between chats when cancelled", async () => {
			const vault = new Vault();
			let calls = 0;
			const summary = await sync(vault, configFor(fx), { isCancelled: () => ++calls > 2 });
			expect(summary.chatsUpdated).toBe(1);
		});
	});

	describe("incremental sync", () => {
		it("appends only rows with a higher Z_PK, even within the same second", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);

			await mutateChatStorage(fx.chatStorage, {
				messages: [
					{ zPk: 70, chat: 2, member: 2, fromJid: JID.falcon, text: "Nova no grupo", at: "2026-03-12T12:00:00Z" },
					{ zPk: 71, chat: 2, member: 1, fromJid: JID.falcon, text: "Mesmo segundo", at: "2026-03-12T12:00:00Z" },
				],
			});
			const summary = await sync(vault, cfg);

			expect(summary).toEqual({ chatsUpdated: 1, messagesSaved: 2, failedChats: 0 });
			await expect(vault.dump()).toMatchFileSnapshot("__golden__/incremental-sync.md");
		});

		it("is a no-op when nothing changed", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const before = vault.dump();
			const summary = await sync(vault, cfg);
			expect(summary.messagesSaved).toBe(0);
			expect(vault.dump()).toBe(before);
		});

		it("does not rewrite the index when nothing changed, but recreates it when missing", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const process = vi.spyOn(vault, "process");
			await sync(vault, cfg);
			expect(process).not.toHaveBeenCalled();

			vault.files.delete("WhatsApp/WhatsApp Index.md");
			await sync(vault, cfg);
			expect(vault.files.get("WhatsApp/WhatsApp Index.md")).toContain("_5 chats · updated on every sync._");
		});

		it("losing the sync state re-appends the period (Rebuild cleans it up)", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			cfg.state = emptyState(); // e.g. data.json deleted
			await sync(vault, cfg);
			const falcon = vault.files.get(FALCON) ?? "";
			expect(falcon.split("Contato salvo (Bruno)").length - 1).toBe(2);
		});
	});

	describe("time window", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("'last N days' excludes older messages", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
			const vault = new Vault();
			// Window lower bound = now − 1 day = 2026-03-10T12:00:00Z, compared with a
			// strict ">" — a message exactly on the boundary is excluded.
			const summary = await sync(vault, configFor(fx, { periodDays: 1 }));
			expect(summary.messagesSaved).toBe(18); // 19 text messages minus the one at 12:00:00Z
			const all = vault.dump();
			expect(all).toContain("Bom dia");
			expect(all).not.toContain("Oi! Tudo bem?");
		});

		it("widening the period inserts the older messages at the top, same result as syncing the wider period", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
			const direct = new Vault();
			await sync(direct, configFor(fx, { periodDays: 30 }));

			const vault = new Vault();
			const cfg = configFor(fx, { periodDays: 1 });
			await sync(vault, cfg);
			expect(vault.dump()).not.toContain("Oi! Tudo bem?");
			cfg.settings.periodDays = 30;
			const summary = await sync(vault, cfg);
			expect(summary.messagesSaved).toBe(1);
			expect(vault.dump()).toBe(direct.dump());
			expect(await sync(vault, cfg)).toMatchObject({ messagesSaved: 0 });
		});

		it("keeps text added to a note when inserting older messages", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-03-11T12:00:00Z"));
			const vault = new Vault();
			const cfg = configFor(fx, { periodDays: 1 });
			await sync(vault, cfg);
			const path = [...vault.files.keys()].find((p) => p.includes("Alice Souza")) ?? "";
			vault.files.set(path, `${vault.files.get(path) ?? ""}Minha anotação\n`);
			cfg.settings.periodDays = 0;
			await sync(vault, cfg);
			const note = vault.files.get(path) ?? "";
			expect(note.indexOf("Oi! Tudo bem?")).toBeLessThan(note.indexOf("Bom dia"));
			expect(note.endsWith("Minha anotação\n")).toBe(true);
		});

		it("narrowing the period keeps what the notes already have", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, { periodDays: 0 });
			await sync(vault, cfg);
			const before = vault.dump();
			cfg.settings.periodDays = 1;
			await sync(vault, cfg);
			cfg.settings.periodDays = 0;
			expect(await sync(vault, cfg)).toMatchObject({ messagesSaved: 0 });
			expect(vault.dump()).toBe(before);
		});
	});

	describe("regressions", () => {
		it("third-party text is escaped: no embeds, remote images, HTML, links, tags, fields or code fences", async () => {
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const injection = noteContaining(vault, "/Injeção.md");

			for (const payload of Object.values(INJECTION_PAYLOADS)) {
				expect(injection).not.toContain(payload);
			}
			expect(injection).not.toMatch(/^\s*(```|~~~)/m); // no live code fence
			expect(injection).not.toContain("![](");
			expect(injection).not.toContain("<img");
			expect(injection).not.toContain("[[Senhas]]");
			expect(injection).not.toContain("![[");
			expect(injection).not.toMatch(/(^|[^\\])#urgente/);
			expect(injection).not.toMatch(/(^|[^\\])::/);

			// …while staying readable, with URLs as inert autolinks.
			expect(injection).toContain("olha isso !\\[\\](<https://atacante.exemplo/p.png?id=vitima>)");
			expect(injection).toContain("\\`\\`\\`dataviewjs");
			expect(injection).toContain("veja \\[\\[Senhas\\]\\] e !\\[\\[Diario privado\\]\\] \\#urgente chave\\:\\: valor");
			expect(injection).toContain('&lt;img src\\="<https://atacante.exemplo/x.gif>"&gt;');
		});

		it("whatsapp_chat stays YAML-quoted; heading escaped; filename sanitized", async () => {
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const entry = [...vault.files.entries()].find(([p]) => p.includes("Projeto Falcon Q4 1 beta"));
			expect(entry?.[0]).toBe("WhatsApp/Groups/Projeto Falcon Q4 1 beta.md");
			expect(entry?.[1]).toContain('whatsapp_chat: "Projeto: \\"Falcon\\" / Q4 #1 [beta]"');
			expect(entry?.[1]).toContain('# Projeto: "Falcon" / Q4 \\#1 \\[beta\\]\n');
		});

		it("unknown @lid senders get Member-<hash>, never the group's JID as a phone", async () => {
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const all = vault.dump();
			expect(all).not.toContain("+120363");
			expect(vault.files.get(FALCON)).toContain("— Member-1uyzqlg: LID desconhecido");
		});

		it("1:1 incoming messages use the chat title; unnamed chats fall back to the phone", async () => {
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const alice = noteContaining(vault, ALICE_PREFIX);
			expect(alice).toContain("# Alice Souza\n");
			expect(alice).toContain("— Alice Souza: Oi! Tudo bem?");
			expect(alice).not.toContain("(agenda)");
			expect(noteContaining(vault, "/+5511999990005.md")).toContain("— +5511999990005: Oi, sou um número não salvo");
		});

		it("index aliases cannot break the wiki-link", async () => {
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const index = vault.files.get("WhatsApp/WhatsApp Index.md") ?? "";
			expect(index).toContain('[[WhatsApp/Groups/Projeto Falcon Q4 1 beta|Projeto: "Falcon" / Q4 #1 (beta)]]');
		});

		it("each chat's cursor is persisted right after its note is written", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			const persisted: string[][] = [];
			await sync(vault, cfg, {
				...neverCancel,
				afterChatSaved: async () => {
					persisted.push(Object.keys(cfg.state.chatRecords));
				},
			});
			// One save per chat, plus one for the high-water mark at the end.
			expect(persisted.map((keys) => keys.length)).toEqual([1, 2, 3, 4, 5, 5]);
		});

		it("renaming a chat keeps appending to the same note", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			await mutateChatStorage(fx.chatStorage, {
				sql: ["UPDATE ZWACHATSESSION SET ZPARTNERNAME = 'Falcon Renomeado' WHERE Z_PK = 2"],
				messages: [{ zPk: 80, chat: 2, member: 1, fromJid: JID.falcon, text: "Depois de renomear", at: "2026-03-12T12:00:00Z" }],
			});
			await sync(vault, cfg);
			const paths = [...vault.files.keys()];
			expect(paths).not.toContain("WhatsApp/Groups/Falcon Renomeado.md");
			expect(vault.files.get(FALCON)).toContain("Depois de renomear");
			expect(cfg.state.chatRecords[JID.falcon]?.transcriptPath).toBe(FALCON);
			expect(cfg.state.chatRecords[JID.falcon]?.name).toBe("Falcon Renomeado"); // index shows the new name
		});

		it("a deleted note is recreated with its day header", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			vault.files.delete(FALCON);
			await mutateChatStorage(fx.chatStorage, {
				messages: [{ zPk: 81, chat: 2, member: 1, fromJid: JID.falcon, text: "Mesmo dia", at: "2026-03-10T20:00:00Z" }],
			});
			await sync(vault, cfg);
			expect(vault.files.get(FALCON)).toContain("# Projeto Falcon\n\n## 2026-03-10\n\n**17:00** — Bruno Lima: Mesmo dia");
		});

		it("no copy of the database is written to disk", async () => {
			vi.mocked(fs.mkdtempSync).mockClear();
			vi.mocked(fs.copyFileSync).mockClear();
			await sync(new Vault(), configFor(fx));
			await inspectChatStorage(fx.chatStorage, driver);
			expect(fs.mkdtempSync).not.toHaveBeenCalled();
			expect(fs.copyFileSync).not.toHaveBeenCalled();
		});

		it("nothing is logged to the console by default; progress only with Debug logging", async () => {
			const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
			const logSpy = vi.spyOn(console, "log");
			await sync(new Vault(), configFor(fx));
			expect(logSpy).not.toHaveBeenCalled();
			expect(debugSpy).not.toHaveBeenCalled();

			log.setVerbose(true);
			try {
				await sync(new Vault(), configFor(fx));
				expect(debugSpy).toHaveBeenCalled();
			} finally {
				log.setVerbose(false);
			}
		});
	});

	describe("global high-water mark", () => {
		it("records MAX(Z_PK) and the scope after a complete sync", async () => {
			const cfg = configFor(fx);
			await sync(new Vault(), cfg);
			expect(cfg.state.highWater).toBe(64);
			expect(cfg.state.scopeKey).toBe(scopeKey(cfg.settings));
		});

		it("a cancelled sync keeps the old mark, so skipped chats are picked up next time", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			let calls = 0;
			await sync(vault, cfg, { isCancelled: () => ++calls > 2 }); // writes 1 chat, then stops
			expect(cfg.state.highWater).toBeNull();
			const rest = await sync(vault, cfg);
			expect(rest).toEqual({ chatsUpdated: 4, messagesSaved: 14, failedChats: 0 });
			expect(cfg.state.highWater).toBe(64);
		});

		it("a failed chat keeps the old mark, so it is retried next time", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			const append = vault.append.bind(vault);
			const create = vault.create.bind(vault);
			vault.create = (path: string, data: string) =>
				path.includes("Projeto Falcon.md") ? Promise.reject(new Error("disk full")) : create(path, data);
			const first = await sync(vault, cfg);
			expect(first.failedChats).toBe(1);
			expect(cfg.state.highWater).toBeNull();
			vault.create = create;
			vault.append = append;
			const retry = await sync(vault, cfg);
			expect(retry).toEqual({ chatsUpdated: 1, messagesSaved: 7, failedChats: 0 });
		});

		it("a scope change rescans the window instead of trusting the mark", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, { includeGroupChats: false });
			await sync(vault, cfg);
			expect(cfg.state.highWater).toBe(64);
			cfg.settings.includeGroupChats = true; // groups were never written
			const after = await sync(vault, cfg);
			expect(after).toEqual({ chatsUpdated: 3, messagesSaved: 13, failedChats: 0 });
		});

		it("new messages after a complete sync are read from above the mark only", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			await mutateChatStorage(fx.chatStorage, {
				messages: [{ zPk: 65, chat: 6, member: 7, fromJid: JID.injection, text: "Depois", at: "2026-03-12T12:00:00Z" }],
			});
			expect(await sync(vault, cfg)).toEqual({ chatsUpdated: 1, messagesSaved: 1, failedChats: 0 });
			expect(cfg.state.highWater).toBe(65);
		});
	});

	describe("selective sync", () => {
		const ALICE = { jid: JID.alice, name: "Alice Souza", kind: "personal" as const };
		const FALCON_CHAT = { jid: JID.falcon, name: "Projeto Falcon", kind: "group" as const };

		it("'include' writes only the chosen chats (and lists only them in the index)", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, {
				chatFilterMode: "include",
				excludedChats: {}, chosenChats: { [ALICE.jid]: { name: ALICE.name, kind: ALICE.kind }, [FALCON_CHAT.jid]: { name: FALCON_CHAT.name, kind: FALCON_CHAT.kind } },
			});
			const summary = await sync(vault, cfg);
			expect(summary).toEqual({ chatsUpdated: 2, messagesSaved: 12, failedChats: 0 });
			expect([...vault.files.keys()].sort()).toEqual([
				"WhatsApp/Groups/Projeto Falcon.md",
				"WhatsApp/Personal/Alice Souza.md",
				"WhatsApp/WhatsApp Index.md",
			]);
			expect(Object.keys(cfg.state.chatRecords).sort()).toEqual([JID.alice, JID.falcon].sort()); // minimal data.json too
		});

		it("'exclude' writes everything except the chosen chats", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, { chatFilterMode: "exclude", chosenChats: {}, excludedChats: { [JID.injection]: { name: "Injeção", kind: "group" } } });
			const summary = await sync(vault, cfg);
			expect(summary.chatsUpdated).toBe(4);
			expect([...vault.files.keys()].some((p) => p.includes("Injeção"))).toBe(false);
		});

		it("an empty 'include' selection syncs nothing", async () => {
			const vault = new Vault();
			expect(await sync(vault, configFor(fx, { chatFilterMode: "include", excludedChats: {}, chosenChats: {} }))).toEqual({ chatsUpdated: 0, messagesSaved: 0, failedChats: 0 });
		});

		it("adding a chat later backfills its history (the high-water mark is not trusted across selection changes)", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, { chatFilterMode: "include", excludedChats: {}, chosenChats: { [ALICE.jid]: { name: ALICE.name, kind: ALICE.kind } } });
			await sync(vault, cfg);
			const change = startSyncing(cfg.settings, FALCON_CHAT);
			cfg.settings.chatFilterMode = change.mode;
			Object.assign(cfg.settings, storeList("include", change.filter));
			const after = await sync(vault, cfg);
			expect(after).toEqual({ chatsUpdated: 1, messagesSaved: 7, failedChats: 0 });
		});

		it("stopping a chat keeps its note and its cursor; resuming continues without duplicates", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const stop = stopSyncing(cfg.settings, FALCON_CHAT); // "all" → "exclude" [Falcon]
			cfg.settings.chatFilterMode = stop.mode;
			Object.assign(cfg.settings, storeList("exclude", stop.filter));
			await mutateChatStorage(fx.chatStorage, {
				messages: [{ zPk: 70, chat: 2, member: 1, fromJid: JID.falcon, text: "Enquanto pausado", at: "2026-03-12T12:00:00Z" }],
			});
			expect((await sync(vault, cfg)).messagesSaved).toBe(0);
			expect(vault.files.get(FALCON)).toBeDefined();
			const resume = startSyncing(cfg.settings, FALCON_CHAT);
			cfg.settings.chatFilterMode = resume.mode;
			Object.assign(cfg.settings, storeList("exclude", resume.filter));
			expect(await sync(vault, cfg)).toEqual({ chatsUpdated: 1, messagesSaved: 1, failedChats: 0 });
			expect(vault.files.get(FALCON)?.split("Contato salvo (Bruno)").length).toBe(2); // once
		});

		it("the selection follows the chat across renames (keyed by JID)", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, { chatFilterMode: "include", excludedChats: {}, chosenChats: { [FALCON_CHAT.jid]: { name: "Nome antigo", kind: "group" } } });
			await mutateChatStorage(fx.chatStorage, { sql: ["UPDATE ZWACHATSESSION SET ZPARTNERNAME = 'Nome novo' WHERE Z_PK = 2"] });
			expect((await sync(vault, cfg)).chatsUpdated).toBe(1);
		});

		it("'Skip archived chats' leaves archived chats out", async () => {
			const vault = new Vault();
			await mutateChatStorage(fx.chatStorage, { sql: ["UPDATE ZWACHATSESSION SET ZARCHIVED = 1 WHERE Z_PK IN (2, 6)"] });
			const summary = await sync(vault, configFor(fx, { skipArchived: true }));
			expect(summary.chatsUpdated).toBe(3);
		});
	});

	describe("media messages", () => {
		const media = (zPk: number, type: number, text: string | null, item: string): string[] => [
			`INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZFROMJID, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZMESSAGETYPE, ZMEDIAITEM) VALUES (${zPk}, 1, '${JID.alice}', ${text === null ? "NULL" : `'${text}'`}, 795268800 + ${zPk}, 0, ${type}, ${zPk})`,
			`INSERT INTO ZWAMEDIAITEM (Z_PK, ZMESSAGE, ZTITLE, ZMOVIEDURATION, ZVCARDNAME, ZLATITUDE, ZLONGITUDE, ZMEDIALOCALPATH) VALUES (${zPk}, ${zPk}, ${item})`,
		];

		it("writes a labelled line for each supported media type, with captions, durations and names", async () => {
			await mutateChatStorage(fx.chatStorage, {
				sql: [
					...media(100, 1, null, "'Foto da *praia*', NULL, 'hash123', NULL, NULL, 'Media/x/abc.jpg'"),
					...media(101, 3, null, "NULL, 65, 'hash', NULL, NULL, 'Media/x/a.opus'"),
					...media(102, 8, "contrato [final].pdf", "NULL, NULL, 'hash', NULL, NULL, 'Media/x/d.pdf'"),
					...media(103, 4, null, "NULL, NULL, 'Ana Lima', NULL, NULL, NULL"),
					...media(104, 5, null, "NULL, NULL, NULL, -23.5505, -46.6333, NULL"),
					...media(105, 15, null, "NULL, NULL, 'hash', NULL, NULL, 'Media/x/s.webp'"),
					...media(106, 2, null, "NULL, 3725, 'hash', NULL, NULL, 'Media/x/v.mp4'"),
					...media(107, 66, null, "NULL, NULL, NULL, NULL, NULL, NULL"), // unknown type: left out
				],
			});
			const vault = new Vault();
			await sync(vault, configFor(fx));
			const alice = vault.files.get("WhatsApp/Personal/Alice Souza.md") ?? "";
			expect(alice).toContain("— Alice Souza: [Image] Foto da \\*praia\\*\n");
			expect(alice).toContain("— Alice Souza: [Audio 1:05]\n");
			expect(alice).toContain("— Alice Souza: [Document: contrato \\[final\\].pdf]\n");
			expect(alice).toContain("— Alice Souza: [Contact: Ana Lima]\n");
			expect(alice).toContain("— Alice Souza: [Location] <https://www.openstreetmap.org/?mlat=-23.55050&mlon=-46.63330#map=17/-23.55050/-46.63330>\n");
			expect(alice).toContain("— Alice Souza: [Sticker]\n");
			expect(alice).toContain("— Alice Souza: [Video 1:02:05]\n");
			expect(alice.match(/\[(Image|Audio|Document|Contact|Location|Sticker|Video)/g)).toHaveLength(7);
		});

		it("reads only text messages when this WhatsApp build has no media table", async () => {
			await mutateChatStorage(fx.chatStorage, { sql: ["DROP TABLE ZWAMEDIAITEM"] });
			const vault = new Vault();
			const summary = await sync(vault, configFor(fx));
			expect(summary.failedChats).toBe(0);
			expect(vault.dump()).not.toContain("[Image]");
		});
	});

	describe("note names", () => {
		it("two chats with the same name get separate notes, each identified by its whatsapp_jid", async () => {
			await mutateChatStorage(fx.chatStorage, {
				sql: [`UPDATE ZWACHATSESSION SET ZPARTNERNAME = 'Projeto Falcon' WHERE ZCONTACTJID = '${JID.special}'`],
			});
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			expect(vault.files.get(FALCON)).toContain(`whatsapp_jid: "${JID.falcon}"`);
			expect(vault.files.get("WhatsApp/Groups/Projeto Falcon (2).md")).toContain(`whatsapp_jid: "${JID.special}"`);
			expect(cfg.state.chatRecords[JID.special]?.transcriptPath).toBe("WhatsApp/Groups/Projeto Falcon (2).md");
		});

		it("without data.json, finds each chat's existing note by its whatsapp_jid", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const paths = [...vault.files.keys()].sort();
			cfg.state = emptyState();
			await sync(vault, cfg);
			expect([...vault.files.keys()].sort()).toEqual(paths); // no "(2)" copies
		});

		it("rebuilding moves a note to the chat's current name", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const old = "WhatsApp/Groups/Nome antigo.md";
			vault.files.set(old, vault.files.get(FALCON) ?? "");
			vault.files.delete(FALCON);
			cfg.state.chatRecords[JID.falcon] = { ...cfg.state.chatRecords[JID.falcon]!, transcriptPath: old };
			await rebuild(vault, cfg, JID.falcon);
			expect(vault.files.has(old)).toBe(false);
			expect(vault.files.get(FALCON)).toContain("# Projeto Falcon");
			expect(cfg.state.chatRecords[JID.falcon]?.transcriptPath).toBe(FALCON);
		});
	});

	describe("rebuild notes", () => {
		it("regenerates a clean note — e.g. after lost state duplicated it", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const clean = vault.files.get(FALCON);
			cfg.state = emptyState();
			await sync(vault, cfg); // duplicates every message
			expect(vault.files.get(FALCON)).not.toBe(clean);

			const result = await rebuild(vault, cfg, JID.falcon);
			expect(result).toEqual({ notesRebuilt: 1, messagesSaved: 7, failed: 0, missing: [] });
			expect(vault.files.get(FALCON)).toBe(clean);
			expect(cfg.state.chatRecords[JID.falcon]).toMatchObject({ lastMessageZPk: 26, messageTotal: 7 });
		});

		it("reflects messages edited or deleted in WhatsApp", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			await mutateChatStorage(fx.chatStorage, {
				sql: ["UPDATE ZWAMESSAGE SET ZTEXT = 'Texto editado' WHERE Z_PK = 21", "DELETE FROM ZWAMESSAGE WHERE Z_PK = 22"],
			});
			await rebuild(vault, cfg, JID.falcon);
			const note = vault.files.get(FALCON) ?? "";
			expect(note).toContain("— Carla ⚡: Texto editado");
			expect(note).not.toContain("Só telefone");
			expect(cfg.state.chatRecords[JID.falcon]?.messageTotal).toBe(6);
		});

		it("works for a chat outside the current selection and leaves the high-water mark alone", async () => {
			const vault = new Vault();
			const cfg = configFor(fx, { chatFilterMode: "include", excludedChats: {}, chosenChats: {} });
			await sync(vault, cfg);
			const mark = cfg.state.highWater;
			await rebuild(vault, cfg, JID.alice);
			expect(noteContaining(vault, ALICE_PREFIX)).toContain("# Alice Souza");
			expect(cfg.state.highWater).toBe(mark);
		});

		it("rebuilds several chats with one read", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const before = vault.dump();
			const result = await rebuild(vault, cfg, JID.falcon, JID.alice);
			expect(result).toMatchObject({ notesRebuilt: 2, failed: 0, missing: [] });
			expect(vault.dump()).toEqual(before);
		});

		it("leaves the note alone and reports the chat as missing when it has no messages in the period", async () => {
			const vault = new Vault();
			const cfg = configFor(fx);
			await sync(vault, cfg);
			const before = vault.files.get(FALCON);
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
			try {
				cfg.settings.periodDays = 7;
				expect(await rebuild(vault, cfg, JID.falcon)).toMatchObject({ notesRebuilt: 0, missing: [JID.falcon] });
			} finally {
				vi.useRealTimers();
			}
			expect(vault.files.get(FALCON)).toBe(before);
		});
	});

	describe("inspectChatStorage", () => {
		it("counts text messages and resolves sample senders without exposing text or raw ids", async () => {
			const r = await inspectChatStorage(fx.chatStorage, driver);
			expect(r.total).toBe(20); // 21 rows, 1 with NULL text
			expect(r.hasContactsDb).toBe(true);
			expect(r.contacts).toBe(2); // rows with a usable name
			expect(r.pushNames).toBe(2); // opaque push-name rejected
			expect(r.samples).toHaveLength(8);
			const text = r.samples.join("\n");
			expect(text).toContain('"Bruno Lima" ← @lid');
			expect(text).toContain('"Member-1uyzqlg" ← @lid');
			expect(text).not.toContain("@s.whatsapp.net"); // no raw JIDs…
			expect(text).not.toContain("333333333333333"); // …nor LIDs
			expect(text).not.toContain("olha isso"); // no message text
		});
	});
});
