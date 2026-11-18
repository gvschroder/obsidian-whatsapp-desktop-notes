// Who sent a message. WhatsApp Desktop keeps people's names in two places:
//   - ZWAPROFILEPUSHNAME (ChatStorage): the name each person set in their own
//     profile, keyed by @lid or phone JID;
//   - ZWAADDRESSBOOKCONTACT (ContactsV2): the names you saved, keyed by both
//     the @lid and the phone JID, with the phone number.
// (ZWAGROUPMEMBER's own name columns are empty in current builds.)

import { isChatOnlyJid, jidFallbackLabel, isOpaqueToken } from "../core/jid";
import { log } from "../util/logger";
import { nonEmptyText, type SqlConnection, type SqlValue } from "./driver";

export interface SenderDirectory {
	/** Display name per JID: a saved contact wins over a profile name. */
	names: Map<string, string>;
	/** "+<number>" per JID, from saved contacts (links an @lid to a phone). */
	phones: Map<string, string>;
	/** Saved contacts with a usable name. */
	contacts: number;
	/** Profile names with a usable value. */
	pushNames: number;
}

function reason(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function asPhoneLabel(raw: string | null): string | null {
	if (!raw) return null;
	return raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
}

/** Read both name sources once per sync; tolerant of builds that lack either. */
export function buildSenderDirectory(chatDb: SqlConnection, contactsDb: SqlConnection | null): SenderDirectory {
	const directory: SenderDirectory = { names: new Map(), phones: new Map(), contacts: 0, pushNames: 0 };

	try {
		const profiles = chatDb.all(
			"SELECT ZJID AS jid, ZPUSHNAME AS push_name FROM ZWAPROFILEPUSHNAME WHERE ZJID IS NOT NULL AND ZPUSHNAME IS NOT NULL",
		);
		for (const { jid, push_name } of profiles) {
			const id = nonEmptyText(jid);
			const name = nonEmptyText(push_name);
			if (!id || !name || isOpaqueToken(name)) continue;
			directory.names.set(id, name);
			directory.pushNames++;
		}
	} catch (e) {
		log.detail(`profile names unavailable in this build (${reason(e)})`);
	}

	if (!contactsDb) return directory;
	try {
		const saved = contactsDb.all(
			"SELECT ZLID AS lid, ZWHATSAPPID AS phone_jid, ZPHONENUMBER AS number, COALESCE(ZFULLNAME, ZGIVENNAME, ZBUSINESSNAME) AS saved_name FROM ZWAADDRESSBOOKCONTACT",
		);
		for (const contact of saved) {
			const ids = [nonEmptyText(contact.lid), nonEmptyText(contact.phone_jid)].filter((id): id is string => id !== null);
			const name = nonEmptyText(contact.saved_name);
			const usableName = name && !isOpaqueToken(name) ? name : null;
			const phone = asPhoneLabel(nonEmptyText(contact.number));
			if (usableName && ids.length) directory.contacts++;
			for (const id of ids) {
				if (usableName) directory.names.set(id, usableName);
				if (phone) directory.phones.set(id, phone);
			}
		}
	} catch (e) {
		log.detail(`address book unavailable in this build (${reason(e)})`);
	}
	return directory;
}

/**
 * The sender's name, best source first: saved contact or profile name, then
 * the phone number (from the address book or a phone JID), then a stable
 * "Member-<hash>". Null when the row carries no person JID at all (one-to-one
 * chats and your own messages — the caller labels those).
 */
export function resolveSenderName(memberJid: SqlValue | undefined, fromJid: SqlValue | undefined, directory: SenderDirectory): string | null {
	// A group row's ZFROMJID is the group itself, never the sender.
	const people = [nonEmptyText(memberJid), nonEmptyText(fromJid)].filter((id): id is string => id !== null && !isChatOnlyJid(id));
	const firstOf = (pick: (id: string) => string | null | undefined): string | null => {
		for (const id of people) {
			const found = pick(id);
			if (found) return found;
		}
		return null;
	};
	return (
		firstOf((id) => directory.names.get(id)) ??
		firstOf((id) => directory.phones.get(id)) ??
		firstOf((id) => {
			const label = jidFallbackLabel(id);
			return label?.startsWith("+") ? label : null;
		}) ??
		firstOf((id) => jidFallbackLabel(id))
	);
}
