// Plugin lifecycle and the actions the UI triggers. Sync logic lives in
// sync-service.ts; everything it decides is in core/.

import { Notice, Platform, Plugin, debounce, type TAbstractFile } from "obsidian";

import { SCHEMA_VERSION, type ChatKind, type SyncState, type UserSettings } from "./core/types";
import { applyScopeChoice, scopeChoice, usesChatList } from "./core/choices";
import { pickerStart, storeList, type ChatListing, type SelectionChange } from "./core/selection";
import { NOTICE_PREFIX, setLocale, t } from "./core/i18n";
import { dbNotFoundMessage, userMessage } from "./core/errors";
import { setMacOS } from "./core/platform";
import { rebuildChats, reorganizeNotes, runIncrementalSync } from "./sync-service";
import { findChatStorage } from "./source/paths";
import { listChats } from "./source/whatsapp-repo";
import { StateStore } from "./state/store";
import { WhatsAppDesktopSettingsTab } from "./ui/settings-tab";
import { SyncStatusBar } from "./ui/status-bar";
import { registerCommands } from "./ui/commands";
import { ChatPickerModal } from "./ui/chat-picker-modal";
import { SetupModal } from "./ui/setup-modal";
import { detectLocale } from "./util/locale";
import { log } from "./util/logger";

const PREFIX = NOTICE_PREFIX;

export default class WhatsAppDesktopPlugin extends Plugin {
	/** Obsidian 1.13+ reads plugin settings from `this.settings`; this types it. */
	declare settings: UserSettings;
	state!: SyncState;

	private store!: StateStore;
	private statusBar!: SyncStatusBar;
	private busy = false;
	private stopRequested = false;
	private autoSyncTimer: number | null = null;

	/** Renames notes through Obsidian, which updates every link to them. */
	private readonly renameFile = (file: TAbstractFile, newPath: string): Promise<void> => this.app.fileManager.renameFile(file, newPath);

	/** Discards notes through Obsidian, which follows the user's "deleted files" setting. */
	private readonly trashFile = (file: TAbstractFile): Promise<void> => this.app.fileManager.trashFile(file);

	/** Save after typing pauses, so text fields don't rewrite data.json per keystroke. */
	readonly persistSoon = debounce(() => void this.persist(), 500, true);

	override async onload(): Promise<void> {
		// First, so every string below (including load errors) is localized;
		// refined once the settings (with the language preference) are read.
		setLocale(detectLocale());
		setMacOS(Platform.isMacOS);
		this.store = new StateStore(this);
		const data = await this.store.load();
		this.settings = data.settings;
		this.state = data.state;
		setLocale(detectLocale(this.settings.language));
		log.setVerbose(this.settings.verboseLogging);

		// Off macOS there is no official WhatsApp Desktop database to read: only
		// the settings tab is added, and it says so.
		this.addSettingTab(new WhatsAppDesktopSettingsTab(this.app, this));
		if (!Platform.isMacOS) return;

		this.statusBar = new SyncStatusBar(this.addStatusBarItem(), () => void this.syncNow());
		this.statusBar.idle(this.state.lastSync);

		registerCommands(this);
		this.scheduleAutoSync();

		const { workspace } = this.app;
		workspace.onLayoutReady(() => {
			// Nothing is written to the vault before the user has seen the setup.
			if (!this.settings.onboarded) this.openSetup();
			else if (this.settings.syncOnLaunch) void this.syncNow();
		});
	}

	override onunload(): void {
		if (!Platform.isMacOS) return; // nothing was started
		this.cancelAutoSync();
		// A sync still running would keep writing after the plugin is disabled.
		if (this.busy) this.stopRequested = true;
	}

	/** True while a sync or a rebuild is running. */
	get isSyncing(): boolean {
		return this.busy;
	}

	async persist(): Promise<void> {
		await this.store.save({ schemaVersion: SCHEMA_VERSION, settings: this.settings, state: this.state });
	}

	// --- Setup ---------------------------------------------------------------

	openSetup(): void {
		new SetupModal(this.app, this).open();
	}

	/** Called when the assistant closes, whichever button closed it. */
	async finishSetup(syncNow: boolean): Promise<void> {
		this.settings.onboarded = true;
		await this.persist();
		this.scheduleAutoSync();
		if (syncNow) void this.syncNow();
	}

	// --- Chat selection ------------------------------------------------------

	/** Every chat in the WhatsApp database, for the picker and quick-add. */
	async listChats(): Promise<ChatListing[]> {
		const dbPath = findChatStorage(this.settings.chatStoragePathOverride);
		if (!dbPath) throw new Error(dbNotFoundMessage());
		try {
			return await listChats(dbPath);
		} catch (e) {
			throw new Error(userMessage(e));
		}
	}

	/**
	 * Open the chat picker. When the current choice does not use a list (all
	 * chats, groups only…), picking chats switches to "only chosen chats".
	 */
	openChatPicker(onSaved?: () => void): void {
		const choice = scopeChoice(this.settings);
		const { mode, checked } = pickerStart(this.settings);
		new ChatPickerModal(
			this.app,
			mode,
			checked,
			() => this.listChats(),
			async (filter) => {
				Object.assign(this.settings, storeList(mode, filter));
				if (!usesChatList(choice) && Object.keys(filter).length) Object.assign(this.settings, applyScopeChoice("include"));
				await this.persist();
				onSaved?.();
			},
		).open();
	}

	/** Apply a one-chat change (from a command) and save. */
	async applySelection(change: SelectionChange): Promise<void> {
		if (change.changed) {
			this.settings.chatFilterMode = change.mode;
			if (change.mode !== "all") Object.assign(this.settings, storeList(change.mode, change.filter));
			if (change.mode !== "all") {
				// A list-based choice always covers both kinds.
				this.settings.includeGroupChats = true;
				this.settings.includeDirectChats = true;
			}
			await this.persist();
		}
		new Notice(PREFIX + change.message);
	}

	/** The chat whose note is open, from its frontmatter. */
	currentChat(): { jid: string; name: string; kind: ChatKind } | null {
		const file = this.app.workspace.getActiveFile();
		if (!file) return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm || fm.source !== "whatsapp-desktop" || typeof fm.whatsapp_jid !== "string") return null;
		const kind: ChatKind = fm.chat_type === "group" ? "group" : "personal";
		return { jid: fm.whatsapp_jid, name: typeof fm.whatsapp_chat === "string" ? fm.whatsapp_chat : fm.whatsapp_jid, kind };
	}

	// --- Sync and rebuild ----------------------------------------------------

	applyVerboseLogging(): void {
		log.setVerbose(this.settings.verboseLogging);
	}

	stopSync(): void {
		if (this.busy) {
			this.stopRequested = true;
			new Notice(PREFIX + t().notices.stopping);
		}
	}

	scheduleAutoSync(): void {
		this.cancelAutoSync();
		const minutes = this.settings.autoSyncIntervalMinutes;
		if (this.settings.onboarded && minutes > 0) {
			this.autoSyncTimer = window.setInterval(() => {
				// A background tick never interrupts or queues behind a running sync.
				if (!this.busy) void this.syncNow();
			}, minutes * 60_000);
			this.registerInterval(this.autoSyncTimer);
		}
	}

	private cancelAutoSync(): void {
		if (this.autoSyncTimer !== null) {
			window.clearInterval(this.autoSyncTimer);
			this.autoSyncTimer = null;
		}
	}

	/** Run one exclusive job (sync or rebuild) with status bar and error handling. */
	private async exclusive(job: () => Promise<void>): Promise<void> {
		if (this.busy) {
			new Notice(PREFIX + t().notices.alreadyRunning);
			return;
		}
		this.busy = true;
		this.stopRequested = false;
		this.statusBar.syncing();
		try {
			await job();
			this.statusBar.idle(this.state.lastSync);
		} catch (e) {
			log.failure("job failed", e instanceof Error ? e : new Error(String(e)));
			this.statusBar.error();
			new Notice(PREFIX + userMessage(e), 10_000);
		} finally {
			this.busy = false;
			this.stopRequested = false;
		}
	}

	async syncNow(): Promise<void> {
		await this.exclusive(async () => {
			const summary = await runIncrementalSync(this.app.vault, this.settings, this.state, {
				isCancelled: () => this.stopRequested,
				reportProgress: (done, total) => this.statusBar.progress(done, total),
				// Save each chat's cursor as soon as its note is written.
				afterChatSaved: () => this.persist(),
				renameFile: this.renameFile,
				trashFile: this.trashFile,
			});
			this.state.lastSync = new Date().toISOString();
			await this.persist();
			new Notice(PREFIX + t().notices.syncResult(summary.messagesSaved, summary.chatsUpdated, summary.failedChats));
		});
	}

	/** Rewrite one chat's note (the caller has already asked for confirmation). */
	async rebuildNote(jid: string): Promise<void> {
		await this.exclusive(async () => {
			const result = await rebuildChats(this.app.vault, this.settings, this.state, [jid], {
				renameFile: this.renameFile,
				trashFile: this.trashFile,
			});
			await this.persist();
			if (result.missing.includes(jid)) new Notice(PREFIX + t().errors.emptyWindow);
			else if (result.failed) throw new Error(t().errors.writeNoteFailed(this.state.chatRecords[jid]?.transcriptPath ?? jid));
			else new Notice(PREFIX + t().notices.rebuilt(result.messagesSaved));
		});
	}

	/** Rewrite every chat note the plugin has created (the caller has already asked). */
	async rebuildAllNotes(): Promise<void> {
		await this.exclusive(async () => {
			const result = await rebuildChats(this.app.vault, this.settings, this.state, Object.keys(this.state.chatRecords), {
				reportProgress: (done, total) => this.statusBar.progress(done, total),
				afterChatSaved: () => this.persist(),
				renameFile: this.renameFile,
				trashFile: this.trashFile,
			});
			await this.persist();
			new Notice(PREFIX + t().notices.rebuiltAll(result.notesRebuilt, result.failed));
		});
	}

	/** Regroup existing notes into the configured layout (the caller has already asked). */
	async reorganizeNotes(): Promise<void> {
		await this.exclusive(async () => {
			const result = await reorganizeNotes(this.app.vault, this.settings, this.state, {
				reportProgress: (done, total) => this.statusBar.progress(done, total),
				afterChatSaved: () => this.persist(),
				trashFile: this.trashFile,
			});
			await this.persist();
			new Notice(PREFIX + t().notices.reorganized(result.chats, result.failed));
		});
	}
}
