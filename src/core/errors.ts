// Turns low-level failures into messages the user can act on. Pure.

import { t } from "./i18n";
import { isMacOS } from "./platform";

/** Kinds of failure with a specific remedy. */
export type ErrorKind = "noAccess" | "other";

/**
 * A database that cannot be opened: SQLite answers "unable to open" both when
 * the file is missing and when macOS refuses it (Obsidian lacks Full Disk
 * Access); the message covers both.
 */
export function classifyError(message: string): ErrorKind {
	return /EPERM|EACCES|operation not permitted|permission denied|not authori[sz]ed|unable to open|SQLITE_CANTOPEN/i.test(message)
		? "noAccess"
		: "other";
}

/** "Database not found" — or, off macOS, that the system is not supported. */
export function dbNotFoundMessage(): string {
	return isMacOS() ? t().errors.dbNotFound : t().errors.unsupportedOs;
}

/** The message to show for a thrown value. */
export function userMessage(e: unknown): string {
	// Raised by source/driver when node:sqlite is missing (matched by name: this module stays pure).
	if (e instanceof Error && e.name === "SqliteUnavailableError") return t().errors.noSqlite;
	const message = e instanceof Error ? e.message : String(e);
	return classifyError(message) === "noAccess" ? t().errors.noAccess : message;
}
