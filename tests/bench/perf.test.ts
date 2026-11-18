// Performance benchmark on a large SYNTHETIC store.
// Skipped by default; run with:  npm run bench
//   WA_BENCH_MESSAGES (default 500000) and WA_BENCH_CHATS (default 300) size it.
// Needs Node 22.13 or later (node:sqlite).

import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Vault as ObsidianVault } from "obsidian";

import { runIncrementalSync } from "../../src/sync-service";
import { listChats, readMessages } from "../../src/source/whatsapp-repo";
import { loadNativeDriver } from "../../src/source/node-sqlite-driver";
import type { SqliteDriver } from "../../src/source/driver";
import { DEFAULT_SETTINGS, emptyState } from "../../src/core/types";
import { Vault } from "../mocks/obsidian";
import { mac } from "../fixtures/whatsapp-fixture";
import { TestDb } from "../fixtures/sqlite";

const ENABLED = !!process.env.WA_BENCH;
const MESSAGES = Number(process.env.WA_BENCH_MESSAGES ?? 500_000);
const CHATS = Number(process.env.WA_BENCH_CHATS ?? 300);

function buildLargeStore(): string {
	const dir = mkdtempSync(join(tmpdir(), "wa-bench-"));
	const path = join(dir, "ChatStorage.sqlite");
	const db = new TestDb(path);
	db.exec(`
		CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID VARCHAR, ZPARTNERNAME VARCHAR);
		CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZMEMBERJID VARCHAR, ZCHATSESSION INTEGER);
		CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZFROMJID VARCHAR, ZTEXT VARCHAR, ZMESSAGEDATE TIMESTAMP, ZISFROMME INTEGER);
		CREATE INDEX Z_WAMESSAGE_ZMESSAGEDATE ON ZWAMESSAGE (ZMESSAGEDATE);
		CREATE TABLE ZWAPROFILEPUSHNAME (Z_PK INTEGER PRIMARY KEY, ZJID VARCHAR, ZPUSHNAME VARCHAR);
	`);
	db.exec("BEGIN");
	for (let c = 1; c <= CHATS; c++) {
		const group = c % 3 === 0;
		const jid = group ? `1203630000${String(c).padStart(8, "0")}@g.us` : `55119${String(c).padStart(8, "0")}@s.whatsapp.net`;
		db.run("INSERT INTO ZWACHATSESSION VALUES (?, ?, ?)", [c, jid, `Chat ${c}`]);
		if (group) {
			for (let m = 0; m < 5; m++) db.run("INSERT INTO ZWAGROUPMEMBER (ZMEMBERJID, ZCHATSESSION) VALUES (?, ?)", [`${c}00${m}@lid`, c]);
		}
	}
	const start = mac("2025-01-01T00:00:00Z");
	const step = (mac("2026-03-01T00:00:00Z") - start) / MESSAGES;
	const insert = "INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZGROUPMEMBER, ZFROMJID, ZTEXT, ZMESSAGEDATE, ZISFROMME) VALUES (?, ?, ?, ?, ?, ?, ?)";
	for (let i = 1; i <= MESSAGES; i++) {
		const chat = 1 + (i % CHATS);
		db.run(insert, [i, chat, chat % 3 === 0 ? (chat - 1) * 5 + (i % 5) + 1 : null, null, `Mensagem ${i} com algum texto típico de conversa`, start + i * step, i % 4 === 0 ? 1 : 0]);
	}
	db.exec("COMMIT");
	db.close();
	return path;
}

function ms(start: bigint): number {
	return Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
}

function heldMb(): number {
	const m = process.memoryUsage();
	return (m.heapUsed + m.external + m.arrayBuffers) / 1024 / 1024;
}

describe.skipIf(!ENABLED)("benchmark", () => {
	it(
		"first sync, incremental sync and memory",
		async () => {
			const path = buildLargeStore();
			const dbMb = statSync(path).size / 1024 / 1024;
			const native = await loadNativeDriver();
			if (!native) throw new Error("The benchmark needs node:sqlite (Node 22.13 or later).");
			const drivers: SqliteDriver[] = [native];
			const results: Record<string, string | number>[] = [];

			for (const driver of drivers) {
				const settings = { ...DEFAULT_SETTINGS, chatStoragePathOverride: path, periodDays: 0 };
				const state = emptyState();
				const vault = new Vault();
				const opts = { isCancelled: () => false, driver };

				let t = process.hrtime.bigint();
				const first = await runIncrementalSync(vault as unknown as ObsidianVault, settings, state, opts);
				const firstMs = ms(t);

				t = process.hrtime.bigint();
				const noop = await runIncrementalSync(vault as unknown as ObsidianVault, settings, state, opts);
				const noopMs = ms(t);

				// Baseline without cursors or high-water mark: read the whole window.
				const allRead = {
					sinceMac: 0,
					cursors: {},
					afterPk: 0,
					includeGroupChats: true,
					includeDirectChats: true,
					chatFilterMode: "all" as const,
					chatFilterJids: [],
					skipArchived: false,
				};
				t = process.hrtime.bigint();
				const reread = (await readMessages(path, allRead, driver)).rows;
				const rereadMs = ms(t);

				// Chat picker: one aggregate pass over every message.
				t = process.hrtime.bigint();
				const listed = await listChats(path, driver);
				const listMs = ms(t);
				expect(listed).toHaveLength(CHATS);

				// Memory held by an open connection (pages are read on demand).
				globalThis.gc?.();
				const before = heldMb();
				const conn = await driver.open(path);
				conn.all("SELECT COUNT(*) AS n FROM ZWAMESSAGE");
				const heldDelta = heldMb() - before;
				conn.close();

				expect(first.messagesSaved).toBe(MESSAGES);
				expect(noop.messagesSaved).toBe(0);
				expect(reread).toHaveLength(MESSAGES);

				results.push({
					"db MB": Math.round(dbMb),
					"first sync ms": firstMs,
					"incremental (nothing new) ms": noopMs,
					"full window re-read ms (baseline)": rereadMs,
					"chat list (picker) ms": listMs,
					"memory held by open db MB": Math.round(heldDelta),
				});
			}
			// Written straight to stdout: console.* is silenced in tests (tests/setup.ts).
			const header = Object.keys(results[0] ?? {});
			const lines = [
				`Benchmark: ${MESSAGES} messages, ${CHATS} chats`,
				`| ${header.join(" | ")} |`,
				`|${header.map(() => "---").join("|")}|`,
				...results.map((r) => `| ${header.map((h) => String(r[h])).join(" | ")} |`),
			];
			process.stdout.write(`\n${lines.join("\n")}\n\n`);
		},
		600_000,
	);
});
