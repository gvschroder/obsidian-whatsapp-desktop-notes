// Chat picker: search, kind filter, archived toggle, one checkbox per chat,
// most recent first. Built with Obsidian's DOM helpers only (no innerHTML —
// chat names are third-party text).

import { App, Modal, Notice, Setting, type ButtonComponent } from "obsidian";

import type { ChatFilterEntry } from "../core/types";
import { filterListing, withCheckedMissing, type ChatListing, type KindFilter } from "../core/selection";
import { coreDataTimeToDate } from "../core/mactime";
import { NOTICE_PREFIX, t } from "../core/i18n";

/** Rows rendered at once; refine the search to reach the rest. */
const MAX_ROWS = 300;

export class ChatPickerModal extends Modal {
	private chats: ChatListing[] = [];
	/**
	 * Chats checked in this dialog. Not named `selection`: Obsidian's Modal uses
	 * that field internally (focus to restore on close) and overwrites it on open.
	 */
	private checkedChats: Record<string, ChatFilterEntry>;
	/** Chats checked when the picker opened: listed first. */
	private readonly pinned: ReadonlySet<string>;
	private query = "";
	private kind: KindFilter = "all";
	private showArchived = false;
	private listEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private saveButton!: ButtonComponent;

	constructor(
		app: App,
		private readonly mode: "include" | "exclude",
		initial: Record<string, ChatFilterEntry>,
		private readonly loadChats: () => Promise<ChatListing[]>,
		private readonly onSave: (filter: Record<string, ChatFilterEntry>) => Promise<void>,
	) {
		super(app);
		this.checkedChats = { ...initial };
		this.pinned = new Set(Object.keys(initial));
	}

	async onOpen(): Promise<void> {
		const m = t().picker;
		// Flex layout: the list scrolls, the Save/Cancel footer stays visible.
		this.modalEl.addClass("wa-desktop-notes-picker-modal");
		this.titleEl.setText(this.mode === "include" ? m.titleInclude : m.titleExclude);
		const loading = this.contentEl.createEl("p", { text: m.loading });
		try {
			this.chats = withCheckedMissing(await this.loadChats(), this.checkedChats);
		} catch (e) {
			loading.setText(m.loadFailed(e instanceof Error ? e.message : String(e)));
			return;
		}
		loading.remove();
		this.build();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private build(): void {
		const { contentEl } = this;
		const m = t().picker;

		contentEl.createEl("p", { cls: "setting-item-description", text: this.mode === "include" ? m.hintInclude : m.hintExclude });

		new Setting(contentEl)
			.addSearch((s) =>
				s.setPlaceholder(m.searchPlaceholder).onChange((v) => {
					this.query = v;
					this.renderList();
				}),
			)
			.addDropdown((d) =>
				d
					.addOptions({ all: m.showAll, group: m.showGroups, personal: m.showPersonal, checked: m.showChecked })
					.setValue(this.kind)
					.onChange((v) => {
						this.kind = v as KindFilter;
						this.renderList();
					}),
			);

		new Setting(contentEl).setName(m.showArchived).addToggle((tg) =>
			tg.setValue(this.showArchived).onChange((v) => {
				this.showArchived = v;
				this.renderList();
			}),
		);

		const actions = new Setting(contentEl);
		this.summaryEl = actions.nameEl;
		actions
			.addButton((b) =>
				b.setButtonText(m.checkShown).onClick(() => {
					for (const c of this.visible()) this.checkedChats[c.jid] = { name: c.name, kind: c.kind };
					this.renderList();
				}),
			)
			.addButton((b) =>
				b.setButtonText(m.uncheckAll).onClick(() => {
					this.checkedChats = {};
					this.renderList();
				}),
			);

		this.listEl = contentEl.createDiv({ cls: "wa-desktop-notes-picker-list" });

		const footer = new Setting(contentEl)
			.addButton((b) => b.setButtonText(m.cancel).onClick(() => this.close()))
			.addButton((b) => {
				this.saveButton = b.setCta().onClick(() => void this.save());
			});
		footer.settingEl.addClass("wa-desktop-notes-picker-footer");

		this.renderList();
	}

	/** Save, then close — even if saving fails, so the dialog never gets stuck. */
	private async save(): Promise<void> {
		try {
			await this.onSave(this.checkedChats);
		} catch (e) {
			new Notice(`${NOTICE_PREFIX}${t().picker.saveFailed(e instanceof Error ? e.message : String(e))}`);
		} finally {
			this.close();
		}
	}

	private visible(): ChatListing[] {
		return filterListing(this.chats, {
			query: this.query,
			kind: this.kind,
			showArchived: this.showArchived,
			checked: new Set(Object.keys(this.checkedChats)),
			pinned: this.pinned,
		});
	}

	private updateSummary(shown: number): void {
		const checked = Object.keys(this.checkedChats).length;
		this.summaryEl.setText(t().picker.summary(checked, shown));
		this.saveButton.setButtonText(t().picker.save(checked));
	}

	private renderList(): void {
		const m = t().picker;
		const rows = this.visible();
		this.updateSummary(rows.length);

		this.listEl.empty();
		if (!rows.length) {
			this.listEl.createEl("p", { cls: "wa-desktop-notes-picker-empty", text: m.noMatches });
			return;
		}
		for (const chat of rows.slice(0, MAX_ROWS)) {
			const row = this.listEl.createEl("label", { cls: "wa-desktop-notes-picker-row" });
			const box = row.createEl("input", { type: "checkbox" });
			box.checked = Object.prototype.hasOwnProperty.call(this.checkedChats, chat.jid);
			box.addEventListener("change", () => {
				if (box.checked) this.checkedChats[chat.jid] = { name: chat.name, kind: chat.kind };
				else delete this.checkedChats[chat.jid];
				this.updateSummary(rows.length);
			});
			row.createSpan({ cls: "wa-desktop-notes-picker-name", text: chat.name });
			const last = chat.lastMessageMac === null ? m.noMessages : coreDataTimeToDate(chat.lastMessageMac).toLocaleDateString();
			const meta = chat.missing ? [m.missing] : [chat.kind === "group" ? m.kindGroup : m.kindPersonal, m.messages(chat.messageTotal), last];
			if (chat.archived) meta.push(m.archived);
			row.createSpan({ cls: "wa-desktop-notes-picker-meta", text: meta.join(" · ") });
		}
		if (rows.length > MAX_ROWS) {
			this.listEl.createEl("p", { cls: "wa-desktop-notes-picker-empty", text: m.truncated(MAX_ROWS, rows.length) });
		}
	}
}
