// Setup assistant: opens on first run (and from a command or the settings
// tab). Checks access to WhatsApp, then asks what to sync, how far back and
// where to write. Nothing syncs on its own until it has been closed once.

import { App, Modal, Setting } from "obsidian";

import type WhatsAppDesktopPlugin from "../main";
import { t } from "../core/i18n";
import { addFolderSetting, addPeriodSettings, addScopeSettings } from "./controls";
import { openFullDiskAccessSettings, testAccess, type AccessResult } from "./access";

export class SetupModal extends Modal {
	private access: AccessResult | null = null;
	private syncOnClose = false;

	constructor(
		app: App,
		private readonly plugin: WhatsAppDesktopPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t().setup.title);
		this.render();
		void this.checkAccess();
	}

	onClose(): void {
		this.contentEl.empty();
		void this.plugin.finishSetup(this.syncOnClose);
	}

	private async checkAccess(): Promise<void> {
		this.access = null;
		this.render();
		this.access = await testAccess(this.plugin.settings.chatStoragePathOverride);
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const m = t().setup;
		contentEl.empty();
		contentEl.createEl("p", { text: m.intro });

		// 1. Access
		new Setting(contentEl).setName(m.accessStep).setHeading();
		const status = new Setting(contentEl);
		if (!this.access) {
			status.setDesc(m.checking);
		} else if (this.access.ok) {
			status.setName(`✓ ${m.accessOk}`).setDesc(this.access.lines[0] ?? "");
		} else {
			status.setName("✗").setDesc(this.access.message);
			status.addButton((b) => b.setButtonText(m.openPrivacy).onClick(() => openFullDiskAccessSettings()));
			status.addButton((b) => b.setButtonText(m.retry).onClick(() => void this.checkAccess()));
		}

		// 2. Chats
		new Setting(contentEl).setName(m.chatsStep).setHeading();
		addScopeSettings(contentEl, this.plugin, { rerender: () => this.render() });

		// 3. Period
		new Setting(contentEl).setName(m.periodStep).setHeading();
		addPeriodSettings(contentEl, this.plugin, () => this.render());

		// 4. Folder
		new Setting(contentEl).setName(m.folderStep).setHeading();
		addFolderSetting(contentEl, this.plugin);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText(m.later).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(m.finish)
					.setCta()
					.setDisabled(!this.access?.ok)
					.onClick(() => {
						this.syncOnClose = true;
						this.close();
					}),
			);
	}
}
