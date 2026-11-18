// Decides WHAT a sync writes: the SQL time window, which chats are in scope,
// which rows are new, and where each chat's note lives. Pure — the caller
// passes the clock and does all I/O.

import { chatDisplayName, classifyChat, hasChatTitle } from "./jid";
import { chatInScope, listFor, type SelectionSettings } from "./selection";
import { toSafeFileName } from "./markdown";
import { dateToCoreDataTime } from "./mactime";
import { DEFAULT_NOTES_ROOT, type ChatKind, type ChatSyncRecord, type ChatStorageMessage, type SyncState, type UserSettings } from "./types";

const DAY_MS = 86_400_000;

/** A chat with the rows read for it in this run. */
export interface ChatGroup {
	jid: string;
	kind: ChatKind;
	/** Display name: WhatsApp's title, or the phone number for untitled chats. */
	name: string;
	/** Whether WhatsApp has a title for the chat (false: `name` is derived from the JID). */
	named: boolean;
	messages: ChatStorageMessage[];
}

/** Lower bound (Mac absolute time) for this run's SQL window; 0 means "all history". */
export function periodStartCoreDataTime(settings: Pick<UserSettings, "periodDays">, nowMs: number): number {
	return settings.periodDays > 0 ? dateToCoreDataTime(new Date(nowMs - settings.periodDays * DAY_MS)) : 0;
}

/**
 * Identifies which messages are in scope. When it changes (kinds toggled,
 * window widened, chats picked) older rows may newly qualify, so the global
 * high-water mark no longer applies and the next sync rescans the window.
 */
export type ScopeSettings = Pick<
	UserSettings,
	"includeGroupChats" | "includeDirectChats" | "periodDays" | "chatFilterMode" | "chosenChats" | "excludedChats" | "skipArchived"
>;

export function scopeKey(settings: ScopeSettings): string {
	return JSON.stringify([
		settings.includeGroupChats,
		settings.includeDirectChats,
		settings.periodDays,
		settings.chatFilterMode,
		Object.keys(listFor(settings, settings.chatFilterMode)).sort(),
		settings.skipArchived,
	]);
}

/**
 * Lowest Z_PK worth reading: the high-water mark of the last complete sync
 * when the scope is unchanged, else 0 (rescan the window; per-chat cursors
 * still prevent duplicates).
 */
export function readFloor(state: Pick<SyncState, "highWater" | "scopeKey">, settings: ScopeSettings): number {
	return state.highWater !== null && state.scopeKey === scopeKey(settings) ? state.highWater : 0;
}

/** Per-chat incremental cursors (highest Z_PK written), keyed by chat JID. */
export function cursorsOf(chats: Record<string, ChatSyncRecord>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [jid, chat] of Object.entries(chats)) out[jid] = chat.lastMessageZPk;
	return out;
}

/**
 * Group rows by chat, dropping status/broadcast pseudo-chats and chats out of
 * scope (disabled kinds, selective-sync filter). Chats keep the order of their
 * first row; each chat's name is taken from its first row.
 */
export function groupByChat(
	rows: ChatStorageMessage[],
	settings: SelectionSettings,
): ChatGroup[] {
	const groups = new Map<string, ChatGroup>();
	for (const message of rows) {
		const { jid, chatTitle } = message;
		const kind = classifyChat(jid);
		if (!kind || !chatInScope(jid, kind, settings)) continue;
		const group = groups.get(jid) ?? { jid, kind, name: chatDisplayName(chatTitle, jid), named: hasChatTitle(chatTitle, jid), messages: [] };
		group.messages.push(message);
		groups.set(jid, group);
	}
	return [...groups.values()];
}

/**
 * Rows newer than the chat's cursor — exact dedup, even for same-second
 * messages. The SQL query already applies the cursors; this keeps the planner
 * correct on its own.
 */
export function freshMessages(group: ChatGroup, prior: ChatSyncRecord | undefined): ChatStorageMessage[] {
	const lastPk = prior?.lastMessageZPk ?? 0;
	return group.messages.filter((m) => m.zPk > lastPk);
}

/**
 * Chats whose note starts later than the current period: the period was
 * widened since they were written, so older messages are missing at the top.
 */
export function chatsToBackfill(state: Pick<SyncState, "chatRecords">, settings: ScopeSettings, sinceMac: number): ChatSyncRecord[] {
	return Object.values(state.chatRecords).filter(
		(c) => c.coveredSinceMac !== null && sinceMac < c.coveredSinceMac && chatInScope(c.jid, c.kind, settings),
	);
}

/**
 * The messages a backfill inserts: in the widened period, not after the
 * note's start, and not newer than its cursor (those are appended as usual).
 */
export function olderMessages(group: ChatGroup, prior: ChatSyncRecord): ChatStorageMessage[] {
	const covered = prior.coveredSinceMac ?? -Infinity;
	return group.messages.filter((m) => m.coreDataTime <= covered && m.zPk <= prior.lastMessageZPk);
}

/** Names without duplicates, in alphabetical order. */
function uniqueSorted(names: string[]): string[] {
	return [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * The people of a chat, for the note's `participants` property:
 *   personal  the other person and you
 *   group     the members WhatsApp records; when it records none, everyone
 *             who has written so far (previous list plus this batch's senders)
 */
export function chatParticipants(group: ChatGroup, members: string[] | undefined, selfDisplayName: string, previous: string[]): string[] {
	if (group.kind === "personal") return uniqueSorted([group.name, selfDisplayName]);
	if (members?.length) return uniqueSorted(members);
	const senders = group.messages.map((m) => (m.isFromMe ? selfDisplayName : (m.sender ?? "")));
	return uniqueSorted([...previous, ...senders]);
}

/** True when two participant lists hold the same names in the same order. */
export function sameParticipants(a: string[] | undefined, b: string[]): boolean {
	return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Root folder for all notes (falls back to the default when blank). */
export function targetRoot(settings: Pick<UserSettings, "notesRootFolder">): string {
	return settings.notesRootFolder.trim() || DEFAULT_NOTES_ROOT;
}

/** Whether a note path is already used (by another chat, the index or a file). */
export type PathTaken = (path: string) => boolean;

type FolderSettings = Pick<UserSettings, "notesRootFolder" | "groupNotesFolder" | "directNotesFolder">;

/**
 * A note path named after the chat — "<root>/<subfolder>/<name>.md" — or
 * "<name> (2).md", "(3)"… when that one is taken.
 */
export function freeNotePath(name: string, kind: ChatKind, settings: FolderSettings, isTaken: PathTaken): string {
	for (let n = 1; ; n++) {
		const path = candidateNotePath(name, kind, settings, n);
		if (!isTaken(path)) return path;
	}
}

/** The n-th name tried for a chat's note: "<name>.md", then "<name> (n).md". */
export function candidateNotePath(name: string, kind: ChatKind, settings: FolderSettings, n: number): string {
	const subfolder = kind === "group" ? settings.groupNotesFolder : settings.directNotesFolder;
	const base = `${[targetRoot(settings), subfolder].filter(Boolean).join("/")}/${toSafeFileName(name)}`;
	return n === 1 ? `${base}.md` : `${base} (${n}).md`;
}



/**
 * Path of the regenerated conversation index: a note named after the root
 * folder, inside it ("WhatsApp/WhatsApp.md"), so its name does not depend on
 * the interface language.
 */
export function indexPath(settings: Pick<UserSettings, "notesRootFolder">): string {
	return `${targetRoot(settings)}/${INDEX_NOTE_NAME}.md`;
}

/** Name (and title) of the index note: fixed, whatever the folder or the language. */
export const INDEX_NOTE_NAME = "WhatsApp Index";
