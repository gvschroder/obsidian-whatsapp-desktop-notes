// Setting rows of the setup assistant (the settings tab declares the same
// choices through Obsidian's settings definitions, see settings-tab.ts).

import { Setting } from "obsidian";

import type WhatsAppDesktopPlugin from "../main";
import { t } from "../core/i18n";
import {
	applyPeriodChoice,
	applyScopeChoice,
	periodChoice,
	scopeChoice,
	usesChatList,
	type PeriodChoice,
	type ScopeChoice,
} from "../core/choices";
import { describeScope, listFor } from "../core/selection";
import { INDEX_NOTE_NAME } from "../core/planner";
import { validateVaultFolder, type Validated } from "../core/validation";

const INVALID_CLASS = "wa-desktop-notes-invalid";

/**
 * A text setting whose value is only stored when it validates. While the input
 * is invalid the field is marked and the description shows the error; the
 * last valid value stays in effect. Saves are debounced.
 */
export function validatedText<T>(
	plugin: WhatsAppDesktopPlugin,
	setting: Setting,
	opts: { value: string; placeholder?: string; desc?: () => string; validate: (v: string) => Validated<T>; apply: (v: T) => void },
): Setting {
	const desc = (): string => opts.desc?.() ?? "";
	setting.setDesc(desc());
	return setting.addText((text) => {
		if (opts.placeholder) text.setPlaceholder(opts.placeholder);
		text.setValue(opts.value).onChange((input) => {
			const result = opts.validate(input);
			text.inputEl.toggleClass(INVALID_CLASS, !result.ok);
			if (!result.ok) {
				setting.setDesc(result.error);
				return;
			}
			opts.apply(result.value);
			setting.setDesc(desc());
			plugin.persistSoon();
		});
	});
}

/** "Chats to sync" dropdown, plus the "Choose chats" row when a list is in use. */
export function addScopeSettings(
	container: HTMLElement,
	plugin: WhatsAppDesktopPlugin,
	opts: { rerender: () => void },
): void {
	const s = plugin.settings;
	const m = t().settings;
	const sc = t().scope;
	const choice = scopeChoice(s);

	new Setting(container)
		.setName(m.scope)
		.setDesc(describeScope(choice, listFor(s, s.chatFilterMode)))
		.addDropdown((d) =>
			d
				.addOptions({ all: sc.all, groups: sc.groups, personal: sc.personal, include: sc.include, exclude: sc.exclude })
				.setValue(choice)
				.onChange(async (v) => {
					Object.assign(s, applyScopeChoice(v as ScopeChoice));
					await plugin.persist();
					opts.rerender();
				}),
		);

	if (usesChatList(choice)) {
		new Setting(container)
			.setName(m.choose)
			.setDesc(m.chooseDesc)
			.addButton((b) => b.setButtonText(m.chooseButton).onClick(() => plugin.openChatPicker(opts.rerender)));
	}
}

/** "Copy messages from" dropdown. */
export function addPeriodSettings(container: HTMLElement, plugin: WhatsAppDesktopPlugin, rerender: () => void): void {
	const s = plugin.settings;
	const m = t().settings;
	const p = t().period;
	const choice = periodChoice(s);
	const options: Record<string, string> = { "7": p.days(7), "30": p.days(30), "90": p.days(90), "365": p.year, all: p.all };
	if (choice === "custom") options.custom = p.days(s.periodDays);

	new Setting(container)
		.setName(m.period)
		.setDesc(m.periodDesc)
		.addDropdown((d) =>
			d
				.addOptions(options)
				.setValue(choice)
				.onChange(async (v) => {
					if (v === "custom") return;
					Object.assign(s, applyPeriodChoice(v as Exclude<PeriodChoice, "custom">));
					await plugin.persist();
					rerender();
				}),
		);
}

/** "Vault folder" text field. */
export function addFolderSetting(container: HTMLElement, plugin: WhatsAppDesktopPlugin): void {
	const s = plugin.settings;
	const m = t().settings;
	validatedText(plugin, new Setting(container).setName(m.folder), {
		value: s.notesRootFolder,
		desc: () => m.folderDesc(INDEX_NOTE_NAME),
		validate: validateVaultFolder,
		apply: (v) => {
			s.notesRootFolder = v;
		},
	});
}
