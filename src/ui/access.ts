// "Test access": find the WhatsApp database and run the read-only probe.
// Shared by the settings tab and the setup assistant.

import { t } from "../core/i18n";
import { dbNotFoundMessage, userMessage } from "../core/errors";
import { findChatStorage } from "../source/paths";
import { inspectChatStorage } from "../source/whatsapp-repo";

export type AccessResult = { ok: true; lines: string[] } | { ok: false; message: string };

export async function testAccess(chatStoragePathOverride: string): Promise<AccessResult> {
	const path = findChatStorage(chatStoragePathOverride);
	if (!path) return { ok: false, message: dbNotFoundMessage() };
	try {
		const r = await inspectChatStorage(path);
		const m = t().probe;
		const lines = [m.ok(r.total), m.names(r.contacts, r.pushNames)];
		if (!r.hasContactsDb) lines.push(m.contactsMissing);
		if (r.samples.length) lines.push(m.samples, ...r.samples);
		return { ok: true, lines };
	} catch (e) {
		return { ok: false, message: userMessage(e) };
	}
}

/** macOS System Settings › Privacy & Security › Full Disk Access. */
export function openFullDiskAccessSettings(): void {
	window.open("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
}
