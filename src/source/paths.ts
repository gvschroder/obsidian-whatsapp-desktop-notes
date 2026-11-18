// Where WhatsApp Desktop keeps its databases. macOS only: the plugin is
// inactive on other systems. Nothing here touches the disk — the files are
// only ever opened read-only by SQLite (see driver.ts), and a missing or
// protected file surfaces as an "unable to open" error with a clear message.

import * as nodeOs from "os";

import { isMacOS } from "../core/platform";

/** The one Node API needed here, typed explicitly. */
const os = nodeOs as unknown as { homedir(): string };

const CONTAINER = "Library/Group Containers/group.net.whatsapp.WhatsApp.shared";

/** Where WhatsApp Desktop for macOS keeps ChatStorage.sqlite (none on other systems). */
export function defaultChatStoragePaths(): string[] {
	if (!isMacOS()) return [];
	return [`${os.homedir()}/${CONTAINER}/ChatStorage.sqlite`];
}

/** The database to read: the explicit override, else the macOS default. Null off macOS without an override. */
export function findChatStorage(override: string): string | null {
	const manual = override.trim();
	return manual || (defaultChatStoragePaths()[0] ?? null);
}

/**
 * ContactsV2.sqlite — WhatsApp's saved-address-book store, beside
 * ChatStorage.sqlite in the same container. It holds the display names you
 * saved plus the @lid → phone-number bridge. Opening it may fail (absent or
 * unreadable); names then fall back to profile push-names and phone numbers.
 */
export function contactsStoragePath(chatStoragePath: string): string {
	const slash = chatStoragePath.lastIndexOf("/");
	return `${slash === -1 ? "." : chatStoragePath.slice(0, slash)}/ContactsV2.sqlite`;
}
