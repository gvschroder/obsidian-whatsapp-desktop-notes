// SQLite access through node:sqlite, the engine built into Node 22.13+ and
// therefore into current Obsidian desktop builds (Electron's Node). Loaded
// lazily; returns null when the module is missing.
//
// The module is described by the small interfaces below instead of Node's
// type declarations, so the code stays fully typed wherever it is checked.

import type { Params, Row, SqlConnection, SqliteDriver } from "./driver";

interface Statement {
	all(params: Params): Row[];
	run(params: Params): unknown;
}

interface Database {
	prepare(sql: string): Statement;
	close(): void;
}

interface NodeSqlite {
	DatabaseSync: new (path: string, options: { readOnly: boolean }) => Database;
}

class NativeConnection implements SqlConnection {
	constructor(private readonly db: Database) {}

	all(sql: string, params: Params = {}): Row[] {
		return this.db.prepare(sql).all(params);
	}

	run(sql: string, params: Params = {}): void {
		this.db.prepare(sql).run(params);
	}

	close(): void {
		this.db.close();
	}
}

async function loadModule(): Promise<NodeSqlite | null> {
	try {
		const mod = (await import("node:sqlite")) as unknown as Partial<NodeSqlite>;
		return typeof mod.DatabaseSync === "function" ? (mod as NodeSqlite) : null;
	} catch {
		return null;
	}
}

export async function loadNativeDriver(): Promise<SqliteDriver | null> {
	const mod = await loadModule();
	if (!mod) return null;
	const { DatabaseSync } = mod;
	return {
		open: (path: string) => {
			// readOnly: SQLite refuses every write to the WhatsApp files. The
			// TEMP schema used for cursors is separate and stays writable.
			const db = new DatabaseSync(path, { readOnly: true });
			return Promise.resolve(new NativeConnection(db));
		},
	};
}
