// Settings tab, declared with Obsidian's settings definitions (1.13+), so every
// setting shows up in Obsidian's settings search. Ordered by how often each
// decision comes up: sync, chats, period, notes, automatic sync, access, then
// everything rarely needed under "Advanced".
//
// Values are read and written here (getControlValue/setControlValue) rather
// than by Obsidian's default, because the plugin stores settings together with
// its sync state and some controls stand for several fields ("scope",
// "period").

import { App, Notice, PluginSettingTab, type Setting, type SettingDefinitionItem } from "obsidian";

import type WhatsAppDesktopPlugin from "../main";
import { NOTE_GROUPINGS, type LanguagePreference, type NoteGrouping, type UserSettings } from "../core/types";
import {
	applyPeriodChoice,
	applyScopeChoice,
	intervalOptions,
	periodChoice,
	scopeChoice,
	type PeriodChoice,
	type ScopeChoice,
} from "../core/choices";
import { describeScope, listFor } from "../core/selection";
import { INDEX_NOTE_NAME } from "../core/planner";
import { NOTICE_PREFIX, setLocale, t } from "../core/i18n";
import { validateVaultFolder } from "../core/validation";
import { defaultChatStoragePaths, findChatStorage } from "../source/paths";
import { isMacOS } from "../core/platform";
import { detectLocale } from "../util/locale";
import { testAccess } from "./access";
import { ConfirmModal } from "./small-modals";
import { retentionDays } from "../state/migrations";

/** Controls that stand for one or more settings fields. */
type BooleanKey = "skipArchived" | "syncOnLaunch" | "verboseLogging";
type FolderKey = "notesRootFolder" | "groupNotesFolder" | "directNotesFolder";
type ControlKey =
	| "noteGrouping"
	| "scope"
	| "period"
	| "autoSyncIntervalMinutes"
	| "language"
	| "chatStoragePathOverride"
	| "selfDisplayName"
	| BooleanKey
	| FolderKey;

const FOLDER_KEYS: readonly string[] = ["notesRootFolder", "groupNotesFolder", "directNotesFolder"] satisfies FolderKey[];
const BOOLEAN_KEYS: readonly string[] = ["skipArchived", "syncOnLaunch", "verboseLogging"] satisfies BooleanKey[];

function intervalLabel(minutes: number): string {
	const m = t().interval;
	if (minutes === 0) return m.off;
	return minutes % 60 === 0 ? m.hours(minutes / 60) : m.minutes(minutes);
}

/** Inline error for a folder field, or nothing when the value is valid. */
function folderError(value: string): string | undefined {
	const result = validateVaultFolder(value);
	return result.ok ? undefined : result.error;
}

export class WhatsAppDesktopSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: WhatsAppDesktopPlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
		const m = t().settings;
		if (!isMacOS()) return [{ name: m.unsupported, desc: t().errors.unsupportedOs }];

		const plugin = this.plugin;
		const s = plugin.settings;
		const sc = t().scope;
		const p = t().period;
		const periodOptions: Record<string, string> = { "7": p.days(7), "30": p.days(30), "90": p.days(90), "365": p.year, all: p.all };
		if (periodChoice(s) === "custom") periodOptions.custom = p.days(s.periodDays);
		const intervals: Record<string, string> = {};
		for (const minutes of intervalOptions(s.autoSyncIntervalMinutes)) intervals[String(minutes)] = intervalLabel(minutes);
		const lastSync = plugin.state.lastSync;
		const dbPath = findChatStorage(s.chatStoragePathOverride);

		return [
			{
				type: "group",
				items: [
					{
						name: m.syncNow,
						desc: lastSync ? m.lastSync(new Date(lastSync).toLocaleString()) : m.neverSynced,
						render: (setting) => this.renderSyncButton(setting),
					},
				],
			},
			{
				type: "group",
				heading: m.chatsHeading,
				items: [
					{
						name: m.scope,
						desc: describeScope(scopeChoice(s), listFor(s, s.chatFilterMode)),
						control: {
							type: "dropdown",
							key: "scope",
							options: { all: sc.all, groups: sc.groups, personal: sc.personal, include: sc.include, exclude: sc.exclude },
						},
					},
					{
						name: m.choose,
						desc: m.chooseDesc,
						render: (setting) => {
							setting.addButton((b) => b.setButtonText(m.chooseButton).onClick(() => plugin.openChatPicker(() => this.update())));
						},
					},
					{ name: m.skipArchived, desc: m.skipArchivedDesc, control: { type: "toggle", key: "skipArchived" } },
				],
			},
			{
				type: "group",
				heading: m.periodHeading,
				items: [
					{ name: m.period, desc: m.periodDesc, control: { type: "dropdown", key: "period", options: periodOptions } },
					{ name: m.retention, desc: m.retentionDesc, render: (setting) => this.renderRetention(setting) },
				],
			},
			{
				type: "group",
				heading: m.notesHeading,
				items: [
					{
						name: m.folder,
						desc: m.folderDesc(INDEX_NOTE_NAME),
						control: { type: "text", key: "notesRootFolder", validate: folderError },
					},
					{
						name: m.grouping,
						desc: m.groupingDesc,
						control: { type: "dropdown", key: "noteGrouping", options: m.groupingOptions },
					},
				],
			},
			{
				type: "group",
				heading: m.autoHeading,
				items: [
					{ name: m.interval, desc: m.intervalDesc, control: { type: "dropdown", key: "autoSyncIntervalMinutes", options: intervals } },
					{ name: m.onStartup, desc: m.onStartupDesc, control: { type: "toggle", key: "syncOnLaunch" } },
				],
			},
			{
				type: "group",
				heading: m.accessHeading,
				items: [
					{
						name: m.db,
						desc: dbPath ? m.dbFound(dbPath) : m.dbNotFound,
						render: (setting) => {
							setting.addButton((b) =>
								b.setButtonText(m.testButton).onClick(async () => {
									new Notice(NOTICE_PREFIX + t().notices.testing);
									const result = await testAccess(s.chatStoragePathOverride);
									new Notice(NOTICE_PREFIX + (result.ok ? result.lines.join("\n") : result.message), result.ok ? 15_000 : 10_000);
								}),
							);
						},
					},
					{
						name: m.setup,
						desc: m.setupDesc,
						render: (setting) => {
							setting.addButton((b) => b.setButtonText(m.setupButton).onClick(() => plugin.openSetup()));
						},
					},
				],
			},
			{
				type: "group",
				heading: m.advancedHeading,
				items: [
					{
						name: m.language,
						desc: m.languageDesc,
						control: { type: "dropdown", key: "language", options: { auto: m.languageAuto, en: "English", pt: "Português" } },
					},
					{
						name: m.dbPath,
						desc: m.dbPathDesc,
						control: { type: "text", key: "chatStoragePathOverride", placeholder: defaultChatStoragePaths()[0] ?? "ChatStorage.sqlite" },
					},
					{
						name: m.groupNotesFolder,
						desc: m.subfolderDesc,
						control: { type: "text", key: "groupNotesFolder", validate: folderError },
					},
					{
						name: m.directNotesFolder,
						desc: m.subfolderDesc,
						control: { type: "text", key: "directNotesFolder", validate: folderError },
					},
					{
						name: m.selfDisplayName,
						desc: m.ownNameDesc,
						control: { type: "text", key: "selfDisplayName", placeholder: t().defaults.selfDisplayName },
					},
					{ name: m.debug, desc: m.debugDesc, control: { type: "toggle", key: "verboseLogging" } },
					{
						name: m.rebuildAll,
						desc: m.rebuildAllDesc,
						render: (setting) => this.renderRebuildAllButton(setting),
					},
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		switch (key as ControlKey) {
			case "scope":
				return scopeChoice(s);
			case "period":
				return periodChoice(s);
			case "autoSyncIntervalMinutes":
				return String(s.autoSyncIntervalMinutes);
			default:
				return s[key as keyof UserSettings];
		}
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const plugin = this.plugin;
		const s = plugin.settings;
		const k = key as ControlKey;
		const text = typeof value === "string" ? value : "";

		if (BOOLEAN_KEYS.includes(k)) {
			s[k as BooleanKey] = value === true;
			if (k === "verboseLogging") plugin.applyVerboseLogging();
			await plugin.persist();
			return;
		}
		if (FOLDER_KEYS.includes(k)) {
			const result = validateVaultFolder(text);
			if (!result.ok) return; // the inline error stays; the last valid value is kept
			s[k as FolderKey] = result.value;
			plugin.persistSoon();
			return;
		}
		switch (k) {
			case "scope":
				Object.assign(s, applyScopeChoice(text as ScopeChoice));
				await plugin.persist();
				this.update(); // the description and the chat picker's mode depend on it
				return;
			case "period":
				if (text === "custom") return;
				Object.assign(s, applyPeriodChoice(text as Exclude<PeriodChoice, "custom">));
				await plugin.persist();
				this.update(); // drops the "custom" option once a preset is picked
				return;
			case "autoSyncIntervalMinutes":
				s.autoSyncIntervalMinutes = Number(text);
				plugin.scheduleAutoSync();
				await plugin.persist();
				return;
			case "language":
				s.language = text as LanguagePreference;
				setLocale(detectLocale(s.language));
				await plugin.persist();
				this.update(); // every label changes language
				return;
			case "chatStoragePathOverride":
				s.chatStoragePathOverride = text.trim();
				plugin.persistSoon();
				return;
			case "selfDisplayName":
				s.selfDisplayName = text.trim() || t().defaults.selfDisplayName;
				plugin.persistSoon();
				return;
			case "noteGrouping":
				this.changeGrouping(NOTE_GROUPINGS.find((g) => g === text) ?? s.noteGrouping);
				return;
		}
	}

	/**
	 * Switch the note layout. When chats already have notes, ask first and
	 * reorganize them right away; cancelling keeps the previous layout.
	 */
	private changeGrouping(next: NoteGrouping): void {
		const plugin = this.plugin;
		const s = plugin.settings;
		const pending = Object.values(plugin.state.chatRecords).filter((c) => c.grouping !== next).length;
		if (!pending) {
			s.noteGrouping = next;
			void plugin.persist();
			return;
		}
		const d = t().modals;
		new ConfirmModal(
			this.app,
			d.reorganizeTitle,
			d.reorganizeBody(pending, t().settings.groupingOptions[next]),
			d.reorganizeConfirm,
			() => {
				s.noteGrouping = next;
				void plugin.reorganizeNotes().then(() => this.update());
			},
			() => this.update(), // shows the previous layout again
		).open();
	}

	/** "Sync now", or "Stop" while a sync runs. */
	private renderSyncButton(setting: Setting): void {
		const m = t().settings;
		const plugin = this.plugin;
		setting.addButton((b) =>
			plugin.isSyncing
				? b.setButtonText(m.stopButton).onClick(() => plugin.stopSync())
				: b
						.setButtonText(m.syncButton)
						.setCta()
						.onClick(async () => {
							await plugin.syncNow();
							this.update();
						}),
		);
	}

	/** The TTL in days (empty = forever), and a button to apply it now. */
	private renderRetention(setting: Setting): void {
		const m = t().settings;
		const plugin = this.plugin;
		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "0";
			text.inputEl.step = "1";
			text
				.setPlaceholder(m.retentionPlaceholder)
				.setValue(plugin.settings.retentionDays ? String(plugin.settings.retentionDays) : "")
				.onChange((value) => {
					plugin.settings.retentionDays = retentionDays(Number(value.trim() || "0"));
					plugin.persistSoon();
				});
		});
		setting.addButton((b) =>
			b
				.setDestructive()
				.setButtonText(m.retentionButton)
				.setDisabled(plugin.isSyncing || !Object.keys(plugin.state.chatRecords).length)
				.onClick(() => plugin.confirmExpire(() => this.update())),
		);
	}

	/** Rewrite every note, after confirmation. */
	private renderRebuildAllButton(setting: Setting): void {
		const m = t().settings;
		const plugin = this.plugin;
		setting.addButton((b) =>
			b
				.setDestructive()
				.setButtonText(m.rebuildAllButton)
				.setDisabled(plugin.isSyncing || !Object.keys(plugin.state.chatRecords).length)
				.onClick(() => {
					const d = t().modals;
					new ConfirmModal(this.app, d.rebuildAllTitle, d.rebuildAllBody, d.rebuildConfirm, () => {
						void plugin.rebuildAllNotes().then(() => this.update());
					}).open();
				}),
		);
	}
}
