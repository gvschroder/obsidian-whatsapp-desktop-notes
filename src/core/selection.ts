// Selective sync rules: which chats are in scope, how "start/stop syncing this
// chat" changes the selection, and how the chat picker filters its list. Pure.

import type { ChatFilterEntry, ChatKind, UserSettings } from "./types";
import type { ScopeChoice } from "./choices";
import { t } from "./i18n";

export type ChatList = Record<string, ChatFilterEntry>;
type ListSettings = Pick<UserSettings, "chatFilterMode" | "chosenChats" | "excludedChats">;
export type SelectionSettings = Pick<UserSettings, "includeGroupChats" | "includeDirectChats"> & ListSettings;

/** The list a mode uses: chosen chats for "include", excluded chats for "exclude", none for "all". */
export function listFor(s: Pick<UserSettings, "chosenChats" | "excludedChats">, mode: UserSettings["chatFilterMode"]): ChatList {
	if (mode === "include") return s.chosenChats;
	if (mode === "exclude") return s.excludedChats;
	return {};
}

/** The settings fields that store `list` as the list of `mode`. */
export function storeList(mode: "include" | "exclude", list: ChatList): Partial<ListSettings> {
	return mode === "include" ? { chosenChats: list } : { excludedChats: list };
}

/**
 * What the chat picker opens with: the list of the current mode, as a copy.
 * Outside the list modes it edits the chosen-chats list, so exclusions never
 * show up as checked.
 */
export function pickerStart(s: ListSettings): { mode: "include" | "exclude"; checked: ChatList } {
	const mode = s.chatFilterMode === "exclude" ? "exclude" : "include";
	return { mode, checked: { ...listFor(s, mode) } };
}

/** A chat as listed by the picker (see source/whatsapp-repo#listChats). */
export interface ChatListing {
	jid: string;
	name: string;
	kind: ChatKind;
	/** Mac absolute time of the newest text message, or null. */
	lastMessageMac: number | null;
	/** Number of text messages. */
	messageTotal: number;
	archived: boolean;
	/** Checked but not found in WhatsApp's database (deleted chat, or a stale entry). */
	missing?: boolean;
}

/**
 * The picker's rows: every chat WhatsApp lists, plus checked chats it does not
 * list, so nothing counted as checked is ever hidden from the user.
 */
export function withCheckedMissing(chats: ChatListing[], checked: ChatList): ChatListing[] {
	const known = new Set(chats.map((c) => c.jid));
	const missing = Object.entries(checked)
		.filter(([jid]) => !known.has(jid))
		.map(([jid, entry]): ChatListing => ({
			jid,
			name: typeof entry?.name === "string" && entry.name ? entry.name : jid,
			kind: entry?.kind === "group" ? "group" : "personal",
			lastMessageMac: null,
			messageTotal: 0,
			archived: false,
			missing: true,
		}));
	return [...chats, ...missing];
}

/** Whether a chat is mirrored, given the kind toggles and the chat filter. */
export function chatInScope(jid: string, kind: ChatKind, s: SelectionSettings): boolean {
	if (kind === "group" && !s.includeGroupChats) return false;
	if (kind === "personal" && !s.includeDirectChats) return false;
	const picked = Object.prototype.hasOwnProperty.call(listFor(s, s.chatFilterMode), jid);
	if (s.chatFilterMode === "include") return picked;
	if (s.chatFilterMode === "exclude") return !picked;
	return true;
}

export interface SelectionSummary {
	total: number;
	groups: number;
	personal: number;
}

export function selectionSummary(filter: Record<string, ChatFilterEntry>): SelectionSummary {
	const entries = Object.values(filter);
	const groups = entries.filter((e) => e.kind === "group").length;
	return { total: entries.length, groups, personal: entries.length - groups };
}

/** What the current choice copies, in one sentence (settings and setup assistant). */
export function describeScope(choice: ScopeChoice, filter: Record<string, ChatFilterEntry>): string {
	const m = t().scope;
	const { total, groups, personal } = selectionSummary(filter);
	const counts = m.counts(total, groups, personal);
	switch (choice) {
		case "groups":
			return m.describeGroups;
		case "personal":
			return m.describePersonal;
		case "include":
			return total ? m.describeInclude(counts) : m.describeIncludeNone;
		case "exclude":
			return total ? m.describeExclude(counts) : m.describeExcludeNone;
		default:
			return m.describeAll;
	}
}

export interface SelectionChange {
	mode: UserSettings["chatFilterMode"];
	/** The new list of `mode` (ignored for "all"). */
	filter: ChatList;
	/** What happened, for a notice. */
	message: string;
	changed: boolean;
}

type ChatRef = { jid: string } & ChatFilterEntry;

function withEntry(filter: Record<string, ChatFilterEntry>, chat: ChatRef): Record<string, ChatFilterEntry> {
	return { ...filter, [chat.jid]: { name: chat.name, kind: chat.kind } };
}

function withoutEntry(filter: Record<string, ChatFilterEntry>, jid: string): Record<string, ChatFilterEntry> {
	const next = { ...filter };
	delete next[jid];
	return next;
}

/** "Start syncing this chat" in each mode. Never changes the mode. */
export function startSyncing(s: ListSettings, chat: ChatRef): SelectionChange {
	const list = listFor(s, s.chatFilterMode);
	const picked = Object.prototype.hasOwnProperty.call(list, chat.jid);
	const m = t().selection;
	if (s.chatFilterMode === "include") {
		if (picked) return { mode: "include", filter: list, message: m.alreadySynced(chat.name), changed: false };
		return { mode: "include", filter: withEntry(list, chat), message: m.nowSyncing(chat.name), changed: true };
	}
	if (s.chatFilterMode === "exclude" && picked) {
		return { mode: "exclude", filter: withoutEntry(list, chat.jid), message: m.nowSyncing(chat.name), changed: true };
	}
	return { mode: s.chatFilterMode, filter: list, message: m.alreadySynced(chat.name), changed: false };
}

/**
 * "Stop syncing this chat". In "all" mode this switches to "exclude" with just
 * that chat, which is what the user means. The note itself is kept.
 */
export function stopSyncing(s: ListSettings, chat: ChatRef): SelectionChange {
	const list = listFor(s, s.chatFilterMode);
	const picked = Object.prototype.hasOwnProperty.call(list, chat.jid);
	const m = t().selection;
	const done = m.stopped(chat.name);
	if (s.chatFilterMode === "include") {
		if (!picked) return { mode: "include", filter: list, message: m.notSynced(chat.name), changed: false };
		return { mode: "include", filter: withoutEntry(list, chat.jid), message: done, changed: true };
	}
	if (s.chatFilterMode === "exclude") {
		if (picked) return { mode: "exclude", filter: list, message: m.notSynced(chat.name), changed: false };
		return { mode: "exclude", filter: withEntry(list, chat), message: done, changed: true };
	}
	return { mode: "exclude", filter: { [chat.jid]: { name: chat.name, kind: chat.kind } }, message: done, changed: true };
}

/** Picker filter: every chat, one kind, or only the checked ones. */
export type KindFilter = "all" | ChatKind | "checked";

/**
 * The picker's visible rows: case/accent-insensitive name search, kind filter,
 * archived chats hidden unless asked for (or checked, under "checked").
 * `pinned` chats (those checked when the picker opened) come first, so a saved
 * selection is visible without scrolling; then most recent activity first.
 */
export function filterListing(
	list: ChatListing[],
	opts: { query: string; kind: KindFilter; showArchived: boolean; checked?: ReadonlySet<string>; pinned?: ReadonlySet<string> },
): ChatListing[] {
	const fold = (v: string): string => v.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	const q = fold(opts.query.trim());
	const onlyChecked = opts.kind === "checked";
	const pinned = (c: ChatListing): number => (opts.pinned?.has(c.jid) ? 0 : 1);
	return list
		.filter((c) => (onlyChecked ? (opts.checked?.has(c.jid) ?? false) : opts.kind === "all" || c.kind === opts.kind))
		.filter((c) => onlyChecked || opts.showArchived || !c.archived)
		.filter((c) => !q || fold(c.name).includes(q))
		.sort(
			(a, b) =>
				pinned(a) - pinned(b) ||
				(b.lastMessageMac ?? -Infinity) - (a.lastMessageMac ?? -Infinity) ||
				a.name.localeCompare(b.name),
		);
}
