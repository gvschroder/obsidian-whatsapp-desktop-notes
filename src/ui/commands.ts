// Ribbon icon and command-palette commands. No default hotkeys (plugin
// guidelines › Commands).

import { Notice } from "obsidian";

import type WhatsAppDesktopPlugin from "../main";
import { listFor, startSyncing, stopSyncing } from "../core/selection";
import { NOTICE_PREFIX, t } from "../core/i18n";
import { ChatSuggestModal, ConfirmModal } from "./small-modals";

export function registerCommands(plugin: WhatsAppDesktopPlugin): void {
	const m = t().commands;

	plugin.addRibbonIcon("message-circle", m.ribbon, () => {
		void plugin.syncNow();
	});

	plugin.addCommand({
		id: "sync-whatsapp-now",
		name: m.syncNow,
		callback: () => {
			void plugin.syncNow();
		},
	});

	// Only offered while a sync is running.
	plugin.addCommand({
		id: "cancel-running-sync",
		name: m.stopSync,
		checkCallback: (checking) => {
			if (!plugin.isSyncing) return false;
			if (!checking) plugin.stopSync();
			return true;
		},
	});

	plugin.addCommand({
		id: "choose-chats",
		name: m.chooseChats,
		callback: () => plugin.openChatPicker(),
	});

	// Quick add: only meaningful when a hand-picked list is in use.
	plugin.addCommand({
		id: "add-chat",
		name: m.addChat,
		checkCallback: (checking) => {
			if (plugin.settings.chatFilterMode === "all") return false;
			if (!checking) void openAddChat(plugin);
			return true;
		},
	});

	// Act on the chat whose note is open.
	plugin.addCommand({
		id: "stop-syncing-current-chat",
		name: m.stopSyncingCurrent,
		checkCallback: (checking) => {
			const chat = plugin.currentChat();
			if (!chat) return false;
			if (!checking) void plugin.applySelection(stopSyncing(plugin.settings, chat));
			return true;
		},
	});

	plugin.addCommand({
		id: "rebuild-current-chat",
		name: m.rebuildCurrent,
		checkCallback: (checking) => {
			const chat = plugin.currentChat();
			if (!chat || plugin.isSyncing) return false;
			if (!checking) {
				const d = t().modals;
				new ConfirmModal(plugin.app, d.rebuildTitle, d.rebuildBody(chat.name), d.rebuildConfirm, () => {
					void plugin.rebuildNote(chat.jid);
				}).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "open-setup",
		name: m.openSetup,
		callback: () => plugin.openSetup(),
	});
}

async function openAddChat(plugin: WhatsAppDesktopPlugin): Promise<void> {
	let chats;
	try {
		chats = await plugin.listChats();
	} catch (e) {
		new Notice(`${NOTICE_PREFIX}${e instanceof Error ? e.message : String(e)}`);
		return;
	}
	const mode = plugin.settings.chatFilterMode;
	const filter = listFor(plugin.settings, mode);
	// Chats not synced yet: absent from an include list, present in an exclude list.
	const candidates = chats.filter((c) => Object.prototype.hasOwnProperty.call(filter, c.jid) === (mode === "exclude"));
	if (!candidates.length) {
		new Notice(`${NOTICE_PREFIX}${t().notices.listComplete}`);
		return;
	}
	new ChatSuggestModal(plugin.app, candidates, (chat) => {
		void plugin.applySelection(startSyncing(plugin.settings, chat));
	}).open();
}
