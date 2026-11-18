// Small dialogs: quick chat search (command palette style) and a confirmation.

import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";

import type { ChatListing } from "../core/selection";
import { t } from "../core/i18n";

/** Fuzzy-search a chat by name and hand it to `onChoose`. */
export class ChatSuggestModal extends FuzzySuggestModal<ChatListing> {
	constructor(
		app: App,
		private readonly chats: ChatListing[],
		private readonly onChoose: (chat: ChatListing) => void,
	) {
		super(app);
		this.setPlaceholder(t().modals.suggestPlaceholder);
	}

	getItems(): ChatListing[] {
		return this.chats;
	}

	getItemText(chat: ChatListing): string {
		const m = t().modals;
		return `${chat.name} (${chat.kind === "group" ? m.suggestGroup : m.suggestPersonal})`;
	}

	onChooseItem(chat: ChatListing): void {
		this.onChoose(chat);
	}
}

/** Ask before a destructive action. `onCancel` runs when it is closed without confirming. */
export class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly title: string,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly onConfirm: () => void,
		private readonly onCancel?: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.title);
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t().modals.cancel).onClick(() => this.close()))
			.addButton((b) =>
				b.setDestructive()
					.setButtonText(this.confirmLabel)
					.onClick(() => {
						this.confirmed = true;
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.confirmed) this.onCancel?.();
	}
}
