// SQLite access behind one small interface, implemented with node:sqlite (the
// SQLite built into Node/Electron). It opens the LIVE database read-only:
// SQLite's own locking gives a consistent snapshot, the write-ahead log is
// read (newest messages appear immediately), nothing is copied and only the
// rows a query returns are held in memory. Only SELECTs run, plus a TEMP table
// for the per-chat cursors.

import { log } from "../util/logger";

export type SqlValue = string | number | bigint | Uint8Array | null;
export type Row = Record<string, SqlValue>;
/** Named parameters, without the "$" prefix used in the SQL text. */
export type Params = Record<string, SqlValue>;

export interface SqlConnection {
	/** Run a query and return every row as a column → value object. */
	all(sql: string, params?: Params): Row[];
	/** Run a statement that returns no rows (TEMP table setup). */
	run(sql: string, params?: Params): void;
	close(): void;
}

export interface SqliteDriver {
	/** Open a database file read-only. */
	open(path: string): Promise<SqlConnection>;
}

let cached: Promise<SqliteDriver> | null = null;

/** Thrown when this Obsidian build has no node:sqlite (an old installer). */
export class SqliteUnavailableError extends Error {
	constructor() {
		super("node:sqlite unavailable");
		this.name = "SqliteUnavailableError";
	}
}

/** The SQLite driver, resolved once per session. */
export function selectDriver(): Promise<SqliteDriver> {
	cached ??= (async () => {
		const { loadNativeDriver } = await import("./node-sqlite-driver");
		const native = await loadNativeDriver();
		if (!native) {
			cached = null; // retry on the next call (e.g. after an update)
			throw new SqliteUnavailableError();
		}
		log.detail("db: using node:sqlite");
		return native;
	})();
	return cached;
}

/** A trimmed, non-empty string value, else null. */
export function nonEmptyText(v: SqlValue | undefined): string | null {
	if (typeof v !== "string") return null;
	const trimmed = v.trim();
	return trimmed === "" ? null : trimmed;
}
