// Orchestrates one sync: read the WhatsApp store (source/), decide what to
// write (core/planner + core/render) and write it (vault/). Per-chat writes are
// isolated so one bad chat cannot abort the whole run.

import type { Vault } from "obsidian";

import type { ChatStorageMessage, ChatSyncRecord, NoteGrouping, SyncState, UserSettings } from "./core/types";
import {
	chatParticipants,
	chatsToBackfill,
	cursorsOf,
	freshMessages,
	groupByChat,
	indexPath,
	INDEX_NOTE_NAME,
	candidateBase,
	freeBase,
	olderMessages,
	readFloor,
	sameParticipants,
	scopeKey,
	targetRoot,
	periodStartCoreDataTime,
	type PathTaken,
} from "./core/planner";
import {
	formatLocalDate,
	insertOlderMessages,
	joinSections,
	transcriptHeader,
	renderIndex,
	renderMessages,
	splitNote,
	type DaySection,
} from "./core/render";
import { isPeriodNoteName, layoutOf, notePath, periodKey, runsByPeriod, type ChatLayout } from "./core/periods";
import { coreDataTimeToDate } from "./core/mactime";
import { toYamlString } from "./core/markdown";
import { setFrontmatterList } from "./core/frontmatter";
import type { ChatGroup } from "./core/planner";
import { dbNotFoundMessage } from "./core/errors";
import { listFor } from "./core/selection";
import { findChatStorage } from "./source/paths";
import { readMessages } from "./source/whatsapp-repo";
import type { SqliteDriver } from "./source/driver";
import {
	appendToTranscript,
	ensureVaultFolder,
	folderExists,
	moveNote,
	noteExists,
	notesIn,
	readNote,
	transformNote,
	trashFolderIfEmpty,
	trashNote,
	writeVaultFile,
	type RenameFile,
	type TrashFile,
} from "./vault/notes-writer";
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
	/** How reorganizing discards the old notes; Obsidian's FileManager follows the trash setting. */
	trashFile: TrashFile;
}

/** Give the event loop a turn (input, repaint) between chats. */
function yieldToUi(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/**
 * Bases (see core/periods#ChatLayout) already used by other chats, the index,
 * or an existing note or folder. Case-insensitive, like the default macOS file
 * system. `own` is the base of the chat being placed, which does not count.
 */
export function baseTaken(vault: Vault, state: SyncState, settings: UserSettings, own?: string): PathTaken {
	const ownKey = own?.toLowerCase();
	return (base) => {
		const key = base.toLowerCase();
		if (key === ownKey) return false;
		const used = [indexPath(settings).replace(/\.md$/, ""), ...Object.values(state.chatRecords).map((c) => layoutOf(c).base)];
		return used.some((p) => p.toLowerCase() === key) || noteExists(vault, `${base}.md`) || folderExists(vault, base);
	};
}

/** The line every note of a chat carries in its frontmatter. */
function jidMarker(jid: string): string {
	return `\nwhatsapp_jid: ${toYamlString(jid)}\n`;
}

/**
 * The notes of a chat under a layout — its note, or the period notes in its
 * folder — that carry its ID. A note without it (the user's own) is never
 * taken for the chat's.
 */
async function chatNotes(vault: Vault, layout: ChatLayout, jid: string): Promise<string[]> {
	const candidates = layout.grouping === "single" ? [notePath(layout, "")] : notesIn(vault, layout.base);
	const marker = jidMarker(jid);
	const own: string[] = [];
	for (const path of candidates) if ((await readNote(vault, path))?.includes(marker)) own.push(path);
	return own;
}

/** A note's file name without its folder and ".md". */
function noteName(path: string): string {
	return (path.split("/").pop() ?? "").replace(/\.md$/, "");
}

/**
 * Whether a chat's notes are not all in `target`'s layout: stored in another
 * one, or holding a note of its own whose name is not a `target` period (named
 * by an older version, say). Notes without the chat's ID do not count.
 */
async function needsRegrouping(vault: Vault, chat: ChatSyncRecord, target: NoteGrouping): Promise<boolean> {
	if (chat.grouping !== target) return true;
	if (target === "single") return false;
	const marker = jidMarker(chat.jid);
	for (const path of notesIn(vault, layoutOf(chat).base)) {
		if (!isPeriodNoteName(noteName(path), target) && (await readNote(vault, path))?.includes(marker)) return true;
	}
	return false;
}

/**
 * Where to write a chat that has no stored note, in the configured layout: the
 * existing note or folder of this same chat (its notes' frontmatter
 * `whatsapp_jid` matches — e.g. after data.json was lost), otherwise the first
 * free name. The chat ID in the note, not its file name, identifies the chat.
 */
async function placeNewChat(vault: Vault, state: SyncState, settings: UserSettings, group: ChatGroup): Promise<ChatLayout> {
	const grouping = settings.noteGrouping;
	for (let n = 1; ; n++) {
		const base = candidateBase(group.name, group.kind, settings, n);
		if (!noteExists(vault, `${base}.md`) && !folderExists(vault, base)) break;
		if ((await chatNotes(vault, { grouping, base }, group.jid)).length) return { grouping, base };
	}
	return { grouping, base: freeBase(group.name, group.kind, settings, baseTaken(vault, state, settings)) };
}

/** Local day (YYYY-MM-DD) a message was sent. */
function dayOf(message: ChatStorageMessage): string {
	return formatLocalDate(coreDataTimeToDate(message.coreDataTime));
}

/** Items grouped by period, oldest period first (unlike runsByPeriod, a period appears once). */
function byPeriod<T>(items: T[], day: (item: T) => string, grouping: NoteGrouping): { key: string; items: T[] }[] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = periodKey(day(item), grouping);
		const list = groups.get(key);
		if (list) list.push(item);
		else groups.set(key, [item]);
	}
	return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => ({ key, items: list }));
}

/** The later of two notes of one chat (period notes are named so that text order is time order). */
function later(a: string, b: string): string {
	return !a || b > a ? b : a;
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
	opts: Pick<SyncHooks, "now" | "driver" | "reportProgress" | "afterChatSaved" | "renameFile" | "trashFile">,
): Promise<RebuildResult> {
	const result: RebuildResult = { notesRebuilt: 0, messagesSaved: 0, failed: 0, missing: [] };
	if (!jids.length) return result;
	// Notes still in another layout are first regrouped, so the rewrite below
	// replaces them instead of leaving the old files next to the new ones.
	await reorganizeNotes(vault, settings, state, { trashFile: opts.trashFile, afterChatSaved: opts.afterChatSaved }, jids);

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
			// A rebuilt chat goes to its current name and folder, moving the old
			// note or folder (and, in Obsidian, the links to it) when they changed.
			const prior = state.chatRecords[group.jid];
			const grouping = settings.noteGrouping;
			if (prior && prior.grouping !== grouping) throw new Error("its notes could not be reorganized");
			const previous = prior ? layoutOf(prior) : null;
			const layout: ChatLayout = previous
				? { grouping, base: freeBase(group.name, group.kind, settings, baseTaken(vault, state, settings, previous.base)) }
				: await placeNewChat(vault, state, settings, group);
			if (previous && previous.base !== layout.base) {
				const [from, to] = grouping === "single" ? [`${previous.base}.md`, `${layout.base}.md`] : [previous.base, layout.base];
				await ensureVaultFolder(vault, parentOf(to));
				await moveNote(vault, from, to, opts.renameFile);
			}
			const participants = chatParticipants(group, members[group.jid], settings.selfDisplayName, prior?.participants ?? []);
			// One note per period with messages; notes of periods that no longer
			// have any (older than the configured period) are kept as they are.
			let rendered = { body: "", lastDay: "", maxPk: 0, lastMessageAtIso: "" };
			let transcriptPath = "";
			for (const period of byPeriod(group.messages, dayOf, grouping)) {
				rendered = renderMessages(period.items, group, settings.selfDisplayName, {
					lastDay: "",
					lastPk: rendered.maxPk,
					lastMessageAtIso: rendered.lastMessageAtIso,
				});
				const path = notePath(layout, period.key);
				await ensureVaultFolder(vault, parentOf(path));
				await writeVaultFile(vault, path, transcriptHeader(group.name, group.jid, group.kind, participants, period.key) + rendered.body);
				transcriptPath = later(transcriptPath, path);
			}
			state.chatRecords[group.jid] = {
				jid: group.jid,
				name: group.name,
				kind: group.kind,
				grouping,
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
			const layout = layoutOf(prior);
			if (layout.grouping === "single" && !noteExists(vault, prior.transcriptPath)) continue; // note deleted: leave its state alone
			// Each period's messages go at the top of its note, or start a new
			// (earlier) note of the chat.
			for (const run of runsByPeriod(older, dayOf, layout.grouping)) {
				const rendered = renderMessages(run.items, group, settings.selfDisplayName, { lastDay: "", lastPk: 0, lastMessageAtIso: "" });
				const path = notePath(layout, run.key);
				const written = await transformNote(vault, path, (c) => insertOlderMessages(c, rendered.body, rendered.lastDay));
				if (!written) {
					await ensureVaultFolder(vault, parentOf(path));
					await writeVaultFile(vault, path, transcriptHeader(group.name, group.jid, group.kind, prior.participants, run.key) + rendered.body);
				}
			}
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

	// Notes left in another layout (the setting changed, or reorganizing was
	// interrupted) are regrouped before anything is appended to them.
	await reorganizeNotes(vault, settings, state, opts);

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

			const layout = prior ? layoutOf(prior) : await placeNewChat(vault, state, settings, g);
			const participants = chatParticipants(g, members[g.jid], settings.selfDisplayName, prior?.participants ?? []);
			let rendered = {
				body: "",
				lastDay: prior?.lastDayHeading ?? "",
				maxPk: prior?.lastMessageZPk ?? 0,
				lastMessageAtIso: prior?.lastMessageAtIso ?? "",
			};
			let transcriptPath = prior?.transcriptPath ?? "";
			for (const run of runsByPeriod(fresh, dayOf, layout.grouping)) {
				const path = notePath(layout, run.key);
				// A note that has to be (re)created, or that holds another period,
				// starts without a day header, whatever the stored state says.
				const exists = noteExists(vault, path);
				const continues = exists && periodKey(rendered.lastDay, layout.grouping) === run.key;
				rendered = renderMessages(run.items, g, settings.selfDisplayName, {
					lastDay: continues ? rendered.lastDay : "",
					lastPk: rendered.maxPk,
					lastMessageAtIso: rendered.lastMessageAtIso,
				});
				await ensureVaultFolder(vault, parentOf(path));
				await appendToTranscript(vault, path, transcriptHeader(g.name, g.jid, g.kind, participants, run.key), rendered.body);
				// An existing note keeps its frontmatter; refresh only the people list.
				if (exists && !sameParticipants(prior?.participants, participants)) {
					await transformNote(vault, path, (c) => setFrontmatterList(c, "participants", participants));
				}
				transcriptPath = later(transcriptPath, path);
			}

			const chat: ChatSyncRecord = {
				jid: g.jid,
				name: g.name,
				kind: g.kind,
				grouping: layout.grouping,
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

export interface ReorganizeResult {
	/** Chats whose notes were regrouped. */
	chats: number;
	/** Chats whose regrouping failed (details in the console); their notes are untouched. */
	failed: number;
}

/**
 * Regroup chats' notes into the layout in the settings — one note per chat,
 * or one per period in a folder per chat — without reading WhatsApp: the day
 * sections of the current notes are moved as they are, so nothing older than
 * the configured period is lost, and neither is text added by hand inside a
 * day. The new notes are written before the old ones go to the trash. Only
 * frontmatter properties added by hand are not carried over.
 */
export async function reorganizeNotes(
	vault: Vault,
	settings: UserSettings,
	state: SyncState,
	opts: Pick<SyncHooks, "afterChatSaved" | "trashFile" | "reportProgress">,
	jids?: string[],
): Promise<ReorganizeResult> {
	const result: ReorganizeResult = { chats: 0, failed: 0 };
	const target = settings.noteGrouping;
	const chats: ChatSyncRecord[] = [];
	for (const chat of Object.values(state.chatRecords)) {
		if ((!jids || jids.includes(chat.jid)) && (await needsRegrouping(vault, chat, target))) chats.push(chat);
	}
	let done = 0;
	for (const chat of chats) {
		opts.reportProgress?.(++done, chats.length);
		try {
			state.chatRecords[chat.jid] = await regroupChat(vault, settings, state, chat, target, opts.trashFile);
			result.chats++;
			await opts.afterChatSaved?.();
		} catch (e) {
			result.failed++;
			log.warning(`failed to reorganize chat "${chat.name}" (${chat.jid}): ${messageOf(e)}`);
		}
		await yieldToUi();
	}
	if (result.chats) {
		try {
			await writeVaultFile(vault, indexPath(settings), renderIndex(Object.values(state.chatRecords), INDEX_NOTE_NAME));
		} catch (e) {
			log.warning(`could not regenerate index: ${messageOf(e)}`);
		}
	}
	return result;
}

/** Move one chat's notes to `target`; returns its updated record. */
async function regroupChat(
	vault: Vault,
	settings: UserSettings,
	state: SyncState,
	chat: ChatSyncRecord,
	target: NoteGrouping,
	trash: TrashFile,
): Promise<ChatSyncRecord> {
	const from = layoutOf(chat);
	const sources = await chatNotes(vault, from, chat.jid);

	// Every day of every note, oldest first. Text the user wrote above a
	// note's first day stays above that day; a note without days keeps its
	// text at the top of the first new note.
	const sections: DaySection[] = [];
	let loose = "";
	// A day already in a note named as `target` names it — the one later syncs
	// appended to — wins over the same day in a misnamed copy (an older
	// version's file left next to the current ones). The copy goes to the trash.
	const current = from.grouping === target ? sources.filter((p) => isPeriodNoteName(noteName(p), target)) : [];
	const notes = await Promise.all(sources.map(async (path) => ({ path, note: splitNote((await readNote(vault, path)) ?? "") })));
	const kept = new Set(notes.filter((n) => current.includes(n.path)).flatMap((n) => n.note.sections.map((s) => s.day)));
	for (const { path, note } of notes) {
		const days = current.includes(path) ? note.sections : note.sections.filter((s) => !kept.has(s.day));
		const [first, ...rest] = days;
		if (first) sections.push({ day: first.day, text: note.preamble + first.text }, ...rest);
		else if (days.length === note.sections.length) loose += note.preamble;
	}
	sections.sort((a, b) => a.day.localeCompare(b.day)); // stable: same-day sections keep their order

	let to: ChatLayout = { grouping: target, base: from.base };
	const periods = target === "single" ? [{ key: "", items: sections }] : byPeriod(sections, (s) => s.day, target);
	// A file that is not this chat's (made by the user, say) is never overwritten: use another name.
	if (periods.some((p) => noteExists(vault, notePath(to, p.key)) && !sources.includes(notePath(to, p.key)))) {
		to = { grouping: target, base: freeBase(chat.name, chat.kind, settings, baseTaken(vault, state, settings)) };
	}

	const written: string[] = [];
	for (const [i, period] of periods.entries()) {
		const preamble = i === 0 && loose.trim() ? loose : "";
		if (!period.items.length && !preamble) continue;
		const path = notePath(to, period.key);
		await ensureVaultFolder(vault, parentOf(path));
		await writeVaultFile(vault, path, transcriptHeader(chat.name, chat.jid, chat.kind, chat.participants, period.key) + joinSections(preamble, period.items));
		written.push(path);
	}
	for (const path of sources) if (!written.includes(path)) await trashNote(vault, path, trash);
	if (from.grouping !== "single") await trashFolderIfEmpty(vault, from.base, trash);

	return {
		...chat,
		grouping: target,
		transcriptPath: written.reduce(later, "") || notePath(to, periodKey(chat.lastDayHeading, target)),
	};
}
