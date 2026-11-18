// Reads data.json into the current schema. Pure.
//
// Schema 1: { schemaVersion: 1, settings, state }.
//
// Loading sanitizes: unknown keys are dropped and values of the wrong type
// fall back to their defaults, so a hand-edited data.json cannot put the
// plugin in an impossible state. A data.json written by a newer version is
// refused rather than overwritten.

import {
	DEFAULT_SETTINGS,
	SCHEMA_VERSION,
	emptyState,
	type ChatFilterEntry,
	type ChatSyncRecord,
	type PersistedData,
	type SyncState,
	type UserSettings,
} from "../core/types";
import { NOTICE_PREFIX, t } from "../core/i18n";

export class NewerSchemaError extends Error {
	constructor(readonly found: number) {
		super(`${NOTICE_PREFIX}${t().errors.newerSchema(found, SCHEMA_VERSION)}`);
		this.name = "NewerSchemaError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Settings for a first install. Folder names and the "me" label follow the
 * interface language detected at load.
 */
export function initialSettings(): UserSettings {
	const d = t().defaults;
	return {
		...DEFAULT_SETTINGS,
		chosenChats: {},
		excludedChats: {},
		groupNotesFolder: d.groupNotesFolder,
		directNotesFolder: d.directNotesFolder,
		selfDisplayName: d.selfDisplayName,
	};
}

function sanitizeChatFilter(raw: unknown): Record<string, ChatFilterEntry> {
	const out: Record<string, ChatFilterEntry> = {};
	if (!isRecord(raw)) return out;
	for (const [jid, entry] of Object.entries(raw)) {
		if (isRecord(entry) && typeof entry.name === "string" && (entry.kind === "group" || entry.kind === "personal")) {
			out[jid] = { name: entry.name, kind: entry.kind };
		}
	}
	return out;
}

/** Keep only known settings keys whose value has the default's type. */
function sanitizeSettings(raw: unknown): UserSettings {
	const out: UserSettings = { ...DEFAULT_SETTINGS, chosenChats: {}, excludedChats: {} };
	if (!isRecord(raw)) return out;
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[]) {
		const value = raw[key];
		if (typeof value === typeof DEFAULT_SETTINGS[key] && value !== null && !Array.isArray(value)) {
			(out as unknown as Record<string, unknown>)[key] = value;
		}
	}
	// Enumerations and maps need more than a typeof check.
	out.chatFilterMode = raw.chatFilterMode === "include" || raw.chatFilterMode === "exclude" ? raw.chatFilterMode : "all";
	out.chosenChats = sanitizeChatFilter(raw.chosenChats);
	out.excludedChats = sanitizeChatFilter(raw.excludedChats);
	out.language = raw.language === "en" || raw.language === "pt" ? raw.language : "auto";
	return out;
}

function isChatState(value: unknown): value is Omit<ChatSyncRecord, "participants" | "coveredSinceMac"> {
	return (
		isRecord(value) &&
		typeof value.jid === "string" &&
		typeof value.transcriptPath === "string" &&
		typeof value.lastMessageZPk === "number" &&
		(value.kind === "group" || value.kind === "personal")
	);
}

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function sanitizeState(raw: unknown): SyncState {
	const state = emptyState();
	if (!isRecord(raw)) return state;
	if (isRecord(raw.chatRecords)) {
		for (const [jid, chat] of Object.entries(raw.chatRecords)) {
			if (isChatState(chat)) {
				const covered = (chat as { coveredSinceMac?: unknown }).coveredSinceMac;
				state.chatRecords[jid] = {
					...chat,
					coveredSinceMac: typeof covered === "number" && Number.isFinite(covered) ? covered : null,
					participants: stringList((chat as { participants?: unknown }).participants),
				};
			}
		}
	}
	state.lastSync = typeof raw.lastSync === "string" ? raw.lastSync : null;
	state.highWater = typeof raw.highWater === "number" && Number.isFinite(raw.highWater) ? raw.highWater : null;
	state.scopeKey = typeof raw.scopeKey === "string" ? raw.scopeKey : null;
	return state;
}

/** Turn whatever `Plugin.loadData()` returned into the current schema. */
export function migrate(raw: unknown): PersistedData {
	if (!isRecord(raw)) {
		// First run (no data.json) or unreadable content: start fresh.
		return { schemaVersion: SCHEMA_VERSION, settings: initialSettings(), state: emptyState() };
	}
	const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : SCHEMA_VERSION;
	if (version > SCHEMA_VERSION) throw new NewerSchemaError(version);
	return { schemaVersion: SCHEMA_VERSION, settings: sanitizeSettings(raw.settings), state: sanitizeState(raw.state) };
}
