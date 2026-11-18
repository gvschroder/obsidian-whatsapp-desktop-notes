// Shared types and defaults. Pure: no Obsidian, Node or SQLite imports.

import type { MediaInfo } from "./media";

export type ChatKind = "group" | "personal";

/**
 * Which chats a sync mirrors:
 *   all      every chat of the enabled kinds (default)
 *   include  only the chats in `chosenChats`
 *   exclude  every chat except those in `excludedChats`
 */
export type ChatFilterMode = "all" | "include" | "exclude";

/** Interface language: follow Obsidian/the OS, or force one. */
export type LanguagePreference = "auto" | "en" | "pt";

/** A chat picked in the selector. Keyed by JID; the name is only for display. */
export interface ChatFilterEntry {
	name: string;
	kind: ChatKind;
}

/** What the user configures in the settings tab. */
export interface UserSettings {
	// --- Database ---
	/**
	 * Absolute path to WhatsApp's `ChatStorage.sqlite`. Empty = auto-detect the
	 * macOS group-container default.
	 */
	chatStoragePathOverride: string;

	// --- Vault layout ---
	/** Root vault folder for all WhatsApp notes, e.g. "WhatsApp". */
	notesRootFolder: string;
	/** Subfolder (under notesRootFolder) for group-chat transcripts. */
	groupNotesFolder: string;
	/** Subfolder (under notesRootFolder) for personal (1:1) chat transcripts. */
	directNotesFolder: string;

	// --- What to sync ---
	includeGroupChats: boolean;
	includeDirectChats: boolean;
	/**
	 * Only mirror messages from the last N days (0 = all history). Bounds the
	 * SQL window; per-chat dedup by row id handles incremental appends.
	 */
	periodDays: number;
	/** Label used for messages you sent (WhatsApp stores no name for "me"). */
	selfDisplayName: string;
	/** Selective sync: which list applies (see ChatFilterMode). */
	chatFilterMode: ChatFilterMode;
	/** Chats synced in "include" mode, keyed by JID (stable across renames). */
	chosenChats: Record<string, ChatFilterEntry>;
	/** Chats left out in "exclude" mode — a separate list, so switching modes never reuses the other one. */
	excludedChats: Record<string, ChatFilterEntry>;
	/** Leave out chats archived in WhatsApp (when the store records it). */
	skipArchived: boolean;

	// --- Sync behaviour ---
	/** Auto-sync interval in minutes. 0 disables the timer. */
	autoSyncIntervalMinutes: number;
	/** Run a sync when Obsidian starts. */
	syncOnLaunch: boolean;
	/** Verbose `[whatsapp]` console logging. */
	verboseLogging: boolean;

	// --- Interface ---
	/** "auto" follows Obsidian's language, or the OS when Obsidian has none set. */
	language: LanguagePreference;
	/** The setup assistant was completed or dismissed. Nothing syncs on its own before that. */
	onboarded: boolean;
}

/** Runtime bookkeeping the plugin persists between syncs (not user-editable). */
export interface SyncState {
	/** Per-conversation bookkeeping, keyed by WhatsApp JID (ZCONTACTJID). */
	chatRecords: Record<string, ChatSyncRecord>;
	/** ISO timestamp of the last successful sync. */
	lastSync: string | null;
	/**
	 * Highest ZWAMESSAGE.Z_PK that existed when the last COMPLETE sync started
	 * (no cancel, no errors). Z_PK only grows, so the next sync with the same
	 * scope only needs rows above it — an index range read.
	 */
	highWater: number | null;
	/** Scope (see core/planner#scopeKey) that `highWater` is valid for. */
	scopeKey: string | null;
}


/** Per-conversation incremental state. Message bodies live in the note file. */
export interface ChatSyncRecord {
	jid: string;
	name: string;
	kind: ChatKind;
	transcriptPath: string;
	/** Highest ZWAMESSAGE.Z_PK already written — the incremental cursor. */
	lastMessageZPk: number;
	/** ISO of the most recent message written (for index sorting). */
	lastMessageAtIso: string;
	/** YYYY-MM-DD of the last day header written into the transcript. */
	lastDayHeading: string;
	messageTotal: number;
	/**
	 * Lower bound (Mac time) of the period the note covers: it holds the chat's
	 * messages after this instant, up to `lastMessageZPk`. Widening the period below
	 * it makes the next sync insert the older messages at the top. Only ever
	 * decreases; null when unknown.
	 */
	coveredSinceMac: number | null;
	/** People in the chat, as written to the note's `participants` property. */
	participants: string[];
}

/** Current on-disk format of the plugin's data.json (see state/migrations.ts). */
export const SCHEMA_VERSION = 1;

export interface PersistedData {
	schemaVersion: typeof SCHEMA_VERSION;
	settings: UserSettings;
	state: SyncState;
}

/** A single text message read from the WhatsApp SQLite database. */
export interface ChatStorageMessage {
	/** ZWAMESSAGE.Z_PK — monotonic rowid, used as the incremental cursor. */
	zPk: number;
	/** ZWACHATSESSION.ZCONTACTJID — the stable chat identifier (e.g. "…@g.us"). */
	jid: string;
	/** Display name of the chat (partner name or JID fallback). */
	chatTitle: string;
	/**
	 * Resolved sender label: saved contact name → profile push-name → +phone →
	 * stable "Member-<hash>". Null when no sender JID is present (own messages,
	 * or group rows without a member) — the renderer substitutes a label.
	 */
	sender: string | null;
	/** ZWAMESSAGE.ZTEXT — message body (rows with null text are skipped). */
	text: string;
	/** ZWAMESSAGE.ZMESSAGEDATE — Mac absolute time (seconds since 2001-01-01). */
	coreDataTime: number;
	/** ZWAMESSAGE.ZISFROMME — true when you sent it. */
	isFromMe: boolean;
	/** Set for media messages (image, audio…); `text` then holds the caption, if any. */
	media?: MediaInfo | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
	chatStoragePathOverride: "",
	notesRootFolder: "WhatsApp",
	groupNotesFolder: "Groups",
	directNotesFolder: "Personal",
	includeGroupChats: true,
	includeDirectChats: true,
	periodDays: 30,
	selfDisplayName: "Me",
	chatFilterMode: "all",
	chosenChats: {},
	excludedChats: {},
	skipArchived: false,
	autoSyncIntervalMinutes: 30,
	syncOnLaunch: false,
	verboseLogging: false,
	language: "auto",
	onboarded: false,
};

export function emptyState(): SyncState {
	return { chatRecords: {}, lastSync: null, highWater: null, scopeKey: null };
}

export const DEFAULT_NOTES_ROOT = DEFAULT_SETTINGS.notesRootFolder;
