// Writable SQLite files for tests, through node:sqlite (Node 22.13+), the same
// engine the plugin reads with.

import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export class TestDb {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		this.db = new DatabaseSync(path);
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	run(sql: string, params: SQLInputValue[] = []): void {
		this.db.prepare(sql).run(...params);
	}

	close(): void {
		this.db.close();
	}
}
