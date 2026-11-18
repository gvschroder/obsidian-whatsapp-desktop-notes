// WhatsApp JIDs ("Jabber IDs": user@server). Pure.
//
//   …@g.us             group chat
//   …@s.whatsapp.net   a person, by phone number
//   …@lid              a person, by privacy "linked ID" (no phone visible)
//   status@broadcast / …@broadcast   status updates and broadcast lists

import { fnv1aBase36 } from "./hash";
import type { ChatKind } from "./types";

const GROUP_SERVER = "@g.us";
const PHONE_SERVER = "@s.whatsapp.net";
const LINKED_ID_SERVER = "@lid";
const BROADCAST_SERVER = "@broadcast";

function userPart(jid: string): string {
	const at = jid.indexOf("@");
	return (at === -1 ? jid : jid.slice(0, at)).trim();
}

function digitsOnly(value: string): string {
	return value.replace(/\D/g, "");
}

/** Group or personal chat; null for status updates and broadcast lists. */
export function classifyChat(jid: string): ChatKind | null {
	if (jid.endsWith(GROUP_SERVER)) return "group";
	return /status|broadcast/i.test(jid) ? null : "personal";
}

/**
 * JIDs that name a chat, not a person (groups, broadcast lists). In group
 * rows ZFROMJID holds the group's JID; its digits are not a phone number.
 */
export function isChatOnlyJid(jid: string): boolean {
	return jid.endsWith(GROUP_SERVER) || jid.endsWith(BROADCAST_SERVER);
}

/**
 * Identifier-like strings that must never be shown as a person's name:
 * base64 padding, long unbroken id runs, or text without any letter.
 */
export function isOpaqueToken(value: string): boolean {
	const text = value.trim();
	const base64Padded = text.endsWith("=");
	const longIdRun = text.length >= 16 && /^[\w+/-]+$/.test(text);
	const noLetters = !/[a-z]/i.test(text);
	return text === "" || base64Padded || longIdRun || noLetters;
}

/**
 * Label for a JID without a known name: "+<digits>" for phone JIDs (and bare
 * numbers), a stable "Member-<hash>" for linked IDs — the raw id is never
 * shown. Null when there is nothing usable.
 */
export function jidFallbackLabel(jid: string | null): string | null {
	const user = jid ? userPart(jid) : "";
	if (!jid || !user) return null;
	const phone = digitsOnly(user);
	if (jid.endsWith(PHONE_SERVER)) return phone ? `+${phone}` : null;
	if (!jid.endsWith(LINKED_ID_SERVER) && /^[\d+]+$/.test(user)) return `+${phone}`;
	return `Member-${fnv1aBase36(user)}`;
}

/** Whether WhatsApp has a title for the chat (not just its JID). */
export function hasChatTitle(title: string | null, jid: string): boolean {
	const trimmed = title?.trim() ?? "";
	return trimmed !== "" && trimmed !== jid;
}

/** The chat's title, or — when it has none — its phone number or placeholder. */
export function chatDisplayName(title: string | null, jid: string): string {
	return hasChatTitle(title, jid) ? (title ?? "").trim() : (jidFallbackLabel(jid) ?? jid);
}
