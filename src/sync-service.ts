// Orchestrates one sync: read the WhatsApp store (source/), decide what to
// write (core/planner + core/render) and write it (vault/). Per-chat writes are
// isolated so one bad chat cannot abort the whole run.

import type { Vault } from "obsidian";

import type { ChatSyncRecord, SyncState, UserSettings } from "./core/types";
import {
	chatParticipants,
	chatsToBackfill,
	cursorsOf,
	freshMessages,
	groupByChat,
	indexPath,
	INDEX_NOTE_NAME,
	candidateNotePath,
	freeNotePath,
	olderMessages,
	readFloor,
	sameParticipants,
	scopeKey,
	targetRoot,
	periodStartCoreDataTime,
} from "./core/planner";
import { insertOlderMessages, transcriptHeader, renderIndex, renderMessages } from "./core/render";
import { toYamlString } from "./core/markdown";
import { setFrontmatterList } from "./core/frontmatter";
import type { ChatGroup } from "./core/planner";
import { dbNotFoundMessage } from "./core/errors";
import { listFor } from "./core/selection";
import { findChatStorage } from "./source/paths";
import { readMessages } from "./source/whatsapp-repo";
import type { SqliteDriver } from "./source/driver";
import { appendToTranscript, ensureVaultFolder, moveNote, noteExists, transformNote, writeVaultFile, type RenameFile } from "./vault/notes-writer";
import { log } from "./util/logger";

export interface SyncReport {
	chatsUpdated: number;
	messagesSaved: number;
	failedChats: number;
}

export interface SyncHooks {
	isCancelled: () => boolean;
	reportProgress?: (done: number, total: number) => void;
	/**
	 * Called after each chat's note is written and its cursor updated in
	 * `state.chatRecords`. Persist the state here: notes are append-only, so a cursor
	 * that is not saved before a crash means duplicated messages on the next run.
	 */
	afterChatSaved?: () => Promise<void>;
	/** Clock, injectable for tests. */
	now?: () => number;
	/** SQLite driver; defaults to node:sqlite (tests inject one). */
	driver?: SqliteDriver;
	/** How rebuilds rename notes; Obsidian's FileManager keeps links working. */
	renameFile?: RenameFile;
}

/** Give the event loop a turn (input, repaint) between chats. */
function yieldToUi(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/**
 * Paths already used by other chats, the index or existing files.
 * Case-insensitive, like the default macOS file system. `own` is
 * the path of the chat being placed, which does not count as taken.
 */
export function pathTaken(vault: Vault, state: SyncState, settings: UserSettings, own?: string): (path: string) => boolean {
	const ownKey = own?.toLowerCase();
	return (path) => {
		const key = path.toLowerCase();
		if (key === ownKey) return false;
		const used = [indexPath(settings), ...Object.values(state.chatRecords).map((c) => c.transcriptPath)];
		return used.some((p) => p.toLowerCase() === key) || noteExists(vault, path);
	};
}

/**
 * Where to write a chat that has no stored note: an existing note of this same
 * chat (its frontmatter `whatsapp_jid` matches — e.g. after data.json was lost),
 * otherwise the first free name. The chat ID in the note, not its file name,
 * is what identifies the chat.
 */
async function placeNewNote(vault: Vault, state: SyncState, settings: UserSettings, group: ChatGroup): Promise<string> {
	const marker = `\nwhatsapp_jid: ${toYamlString(group.jid)}\n`;
	for (let n = 1; ; n++) {
		const path = candidateNotePath(group.name, group.kind, settings, n);
		const file = vault.getFileByPath(path);
		if (!file) break;
		if ((await vault.cachedRead(file)).includes(marker)) return path;
	}
	return freeNotePath(group.name, group.kind, settings, pathTaken(vault, state, settings));
}

function parentOf(path: string): string {
	return path.split("/").slice(0, -1).join("/");
}

function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function requireDbPath(settings: UserSettings): string {
	const dbPath = findChatStorage(settings.chatStoragePathOverride);
	if (!dbPath) {
		throw new Error(dbNotFoundMessage());
	}
	log.step(`using ${dbPath}`);
	return dbPath;
}

export interface RebuildResult {
	/** Notes rewritten. */
	notesRebuilt: number;
	messagesSaved: number;
	/** Chats whose rewrite failed (details in the console). */
	failed: number;
	/** Requested chats with no text message in the period; their notes were left as they were. */
	missing: string[];
}

/**
 * Rewrite chat notes from scratch: every text message of the configured
 * period, rendered fresh and written over the note (text added by hand is
 * lost — the UI asks first). Picks up messages edited or deleted in WhatsApp
 * and a widened period. Works for chats outside the current selection too, and
 * leaves the global high-water mark alone. One database read for all chats.
 */
export async function rebuildChats(
	vault: Vault,
	settings: UserSettings,
	state: SyncState,
	jids: string[],
	opts: Pick<SyncHooks, "now" | "driver" | "reportProgress" | "afterChatSaved" | "renameFile"> = {},
): Promise<RebuildResult> {
	const result: RebuildResult = { notesRebuilt: 0, messagesSaved: 0, failed: 0, missing: [] };
	if (!jids.length) return result;

	const dbPath = requireDbPath(settings);
	const sinceMac = periodStartCoreDataTime(settings, (opts.now ?? Date.now)());
	const { rows, members } = await readMessages(
		dbPath,
		{
			sinceMac,
			cursors: {},
			afterPk: 0,
			includeGroupChats: true,
			includeDirectChats: true,
			chatFilterMode: "include",
			chatFilterJids: jids,
			skipArchived: false,
		},
		opts.driver,
	);
	const groups = groupByChat(rows, { includeGroupChats: true, includeDirectChats: true, chatFilterMode: "all", chosenChats: {}, excludedChats: {} });
	const found = new Set(groups.map((g) => g.jid));
	result.missing = jids.filter((jid) => !found.has(jid));

	let done = 0;
	for (const group of groups) {
		opts.reportProgress?.(++done, groups.length);
		try {
			// A rebuilt note goes to its current name and folder, moving the old
			// file (and, in Obsidian, the links to it) when they changed.
			const previous = state.chatRecords[group.jid]?.transcriptPath;
			const transcriptPath = previous
				? freeNotePath(group.name, group.kind, settings, pathTaken(vault, state, settings, previous))
				: await placeNewNote(vault, state, settings, group);
			const rendered = renderMessages(group.messages, group, settings.selfDisplayName, { lastDay: "", lastPk: 0, lastMessageAtIso: "" });
			await ensureVaultFolder(vault, parentOf(transcriptPath));
			if (previous && previous !== transcriptPath && noteExists(vault, previous)) await moveNote(vault, previous, transcriptPath, opts.renameFile);
			const participants = chatParticipants(group, members[group.jid], settings.selfDisplayName, state.chatRecords[group.jid]?.participants ?? []);
			await writeVaultFile(vault, transcriptPath, transcriptHeader(group.name, group.jid, group.kind, participants) + rendered.body);
			state.chatRecords[group.jid] = {
				jid: group.jid,
				name: group.name,
				kind: group.kind,
				transcriptPath,
				lastMessageZPk: rendered.maxPk,
				lastMessageAtIso: rendered.lastMessageAtIso,
				lastDayHeading: rendered.lastDay,
				messageTotal: group.messages.length,
				coveredSinceMac: sinceMac,
				participants,
			};
			result.notesRebuilt++;
			result.messagesSaved += group.messages.length;
			await opts.afterChatSaved?.();
		} catch (e) {
			result.failed++;
			log.warning(`failed to rebuild chat "${group.name}" (${group.jid}): ${messageOf(e)}`);
		}
		await yieldToUi();
	}

	if (result.notesRebuilt) await writeVaultFile(vault, indexPath(settings), renderIndex(Object.values(state.chatRecords), INDEX_NOTE_NAME));
	return result;
}

/**
 * Insert, at the top of each note, the messages between the widened period's
 * start and the note's current start. Returns how many were inserted.
 */
async function backfillOlder(
	vault: Vault,
	settings: UserSettings,
	state: SyncState,
	dbPath: string,
	sinceMac: number,
	chats: ChatSyncRecord[],
	touched: Set<string>,
	opts: SyncHooks,
): Promise<number> {
	const { rows } = await readMessages(
		dbPath,
		{
			sinceMac,
			cursors: {},
			afterPk: 0,
			includeGroupChats: true,
			includeDirectChats: true,
			chatFilterMode: "include",
			chatFilterJids: chats.map((c) => c.jid),
			skipArchived: false,
		},
		opts.driver,
	);
	const groups = new Map(
		groupByChat(rows, { includeGroupChats: true, includeDirectChats: true, chatFilterMode: "all", chosenChats: {}, excludedChats: {} }).map((g) => [g.jid, g]),
	);
	let inserted = 0;
	for (const prior of chats) {
		if (opts.isCancelled()) break;
		const group = groups.get(prior.jid);
		const older = group ? olderMessages(group, prior) : [];
		if (group && older.length) {
			const rendered = renderMessages(older, group, settings.selfDisplayName, { lastDay: "", lastPk: 0, lastMessageAtIso: "" });
			const written = await transformNote(vault, prior.transcriptPath, (c) => insertOlderMessages(c, rendered.body, rendered.lastDay));
			if (!written) continue; // note deleted: leave its state alone
			log.step(`"${prior.name}" — +${older.length} older message(s)`);
			inserted += older.length;
			touched.add(prior.jid);
			state.chatRecords[prior.jid] = { ...prior, messageTotal: prior.messageTotal + older.length, coveredSinceMac: sinceMac };
		} else {
			state.chatRecords[prior.jid] = { ...prior, coveredSinceMac: sinceMac };
		}
		await opts.afterChatSaved?.();
	}
	return inserted;
}

export async function runIncrementalSync(vault: Vault, settings: UserSettings, state: SyncState, opts: SyncHooks): Promise<SyncReport> {
	const summary: SyncReport = { chatsUpdated: 0, messagesSaved: 0, failedChats: 0 };

	const dbPath = requireDbPath(settings);
	const sinceMac = periodStartCoreDataTime(settings, (opts.now ?? Date.now)());
	const touched = new Set<string>();

	// The period was widened: insert the older messages at the top of the
	// notes that start later than it, before appending anything new.
	const widened = chatsToBackfill(state, settings, sinceMac);
	if (widened.length) {
		try {
			summary.messagesSaved += await backfillOlder(vault, settings, state, dbPath, sinceMac, widened, touched, opts);
		} catch (e) {
			summary.failedChats++;
			log.warning(`could not add older messages: ${messageOf(e)}`);
		}
	}

	// Only rows above the global high-water mark (same scope as last time),
	// above each chat's cursor and in scope are read: an incremental sync with
	// nothing new reads nothing.
	const { rows, maxPk, members } = await readMessages(
		dbPath,
		{
			sinceMac,
			cursors: cursorsOf(state.chatRecords),
			afterPk: readFloor(state, settings),
			includeGroupChats: settings.includeGroupChats,
			includeDirectChats: settings.includeDirectChats,
			chatFilterMode: settings.chatFilterMode,
			chatFilterJids: Object.keys(listFor(settings, settings.chatFilterMode)),
			skipArchived: settings.skipArchived,
		},
		opts.driver,
	);
	if (opts.isCancelled()) {
		log.step("stopped by the user before writing");
		return summary;
	}

	const groups = groupByChat(rows, settings);

	await ensureVaultFolder(vault, targetRoot(settings));

	const total = groups.length;
	log.step(`${total} chat(s) have messages in the period`);

	let done = 0;
	let cancelled = false;
	for (const g of groups) {
		done++;
		if (opts.isCancelled()) {
			log.step(`stopped by the user after ${done - 1} of ${total} chat(s)`);
			cancelled = true;
			break;
		}
		opts.reportProgress?.(done, total);

		try {
			const prior = state.chatRecords[g.jid];
			const fresh = freshMessages(g, prior);
			log.detail(`chat ${done}/${total}: "${g.name}" — ${fresh.length} new of ${g.messages.length}`);
			if (!fresh.length) continue;

			log.step(`chat ${done}/${total}: "${g.name}" — +${fresh.length} message(s)`);

			const transcriptPath = prior?.transcriptPath ?? (await placeNewNote(vault, state, settings, g));
			// A note that has to be (re)created starts without any day header,
			// whatever the stored state says.
			const exists = noteExists(vault, transcriptPath);
			const rendered = renderMessages(fresh, g, settings.selfDisplayName, {
				lastDay: exists ? (prior?.lastDayHeading ?? "") : "",
				lastPk: prior?.lastMessageZPk ?? 0,
				lastMessageAtIso: prior?.lastMessageAtIso ?? "",
			});

			const participants = chatParticipants(g, members[g.jid], settings.selfDisplayName, prior?.participants ?? []);
			await ensureVaultFolder(vault, parentOf(transcriptPath));
			await appendToTranscript(vault, transcriptPath, transcriptHeader(g.name, g.jid, g.kind, participants), rendered.body);
			// An existing note keeps its frontmatter; refresh only the people list.
			if (exists && !sameParticipants(prior?.participants, participants)) {
				await transformNote(vault, transcriptPath, (c) => setFrontmatterList(c, "participants", participants));
			}

			const chat: ChatSyncRecord = {
				jid: g.jid,
				name: g.name,
				kind: g.kind,
				transcriptPath,
				lastMessageZPk: rendered.maxPk,
				lastMessageAtIso: rendered.lastMessageAtIso,
				lastDayHeading: rendered.lastDay,
				messageTotal: (prior?.messageTotal ?? 0) + fresh.length,
				coveredSinceMac: prior ? prior.coveredSinceMac : sinceMac,
				participants,
			};
			state.chatRecords[g.jid] = chat;
			touched.add(g.jid);
			summary.messagesSaved += fresh.length;
			await opts.afterChatSaved?.();
		} catch (e) {
			summary.failedChats++;
			log.warning(`failed to write chat "${g.name}" (${g.jid}): ${messageOf(e)}`);
		}
		await yieldToUi();
	}

	summary.chatsUpdated = touched.size;

	// Advance the high-water mark only after a complete, error-free run, so
	// chats skipped by a cancel or a failed write are retried next time.
	if (!cancelled && summary.failedChats === 0) {
		state.highWater = maxPk;
		state.scopeKey = scopeKey(settings);
		await opts.afterChatSaved?.();
	}

	// Rewrite the index only when something changed, or when it is missing.
	try {
		const index = indexPath(settings);
		if (summary.chatsUpdated > 0 || !noteExists(vault, index)) {
			await writeVaultFile(vault, index, renderIndex(Object.values(state.chatRecords), INDEX_NOTE_NAME));
		}
	} catch (e) {
		log.warning(`could not regenerate index: ${messageOf(e)}`);
	}

	log.step(
		`finished: ${summary.messagesSaved} message(s) saved in ${summary.chatsUpdated} chat(s), ${summary.failedChats} failed`,
	);
	return summary;
}
