// Loads and saves the plugin's data.json in the current schema.

import type { Plugin } from "obsidian";

import type { PersistedData } from "../core/types";
import { migrate } from "./migrations";

export class StateStore {
	constructor(private readonly plugin: Plugin) {}

	async load(): Promise<PersistedData> {
		return migrate(await this.plugin.loadData());
	}

	async save(data: PersistedData): Promise<void> {
		await this.plugin.saveData(data);
	}
}
