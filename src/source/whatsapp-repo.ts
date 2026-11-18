// Queries against the WhatsApp store: connection probe and the incremental
// message read. Read-only, through a SqliteDriver (see driver.ts).

import type { ChatFilterMode, ChatStorageMessage } from "../core/types";
import { chatDisplayName, classifyChat } from "../core/jid";
import { MEDIA_TYPES, mediaKindOf, type MediaInfo } from "../core/media";
import { t } from "../core/i18n";
import type { ChatListing } from "../core/selection";
import { log } from "../util/logger";
import { contactsStoragePath } from "./paths";
import { buildSenderDirectory, resolveSenderName, type SenderDirectory } from "./name-index";
import { selectDriver, nonEmptyText, type SqlConnection, type SqliteDriver } from "./driver";

export interface ChatStorageReport {
	total: number;
	/** Whether ContactsV2.sqlite could be opened beside ChatStorage. */
	hasContactsDb: boolean;
	/** Saved contact names loaded from ContactsV2. */
	contacts: number;
	/** Profile push-names loaded from ZWAPROFILEPUSHNAME. */
	pushNames: number;
	/** A few resolved recent group senders, for a sanity check. */
	samples: string[];
}

/** What to read. Everything here is pushed down into the SQL. */
export interface MessageQuery {
	/** Lower time bound (Mac absolute time); 0 = all history. */
	sinceMac: number;
	/**
	 * Highest Z_PK already written, per chat JID. Only rows above a chat's
	 * cursor are returned, so an incremental sync reads just the new messages
	 * instead of the whole window.
	 */
	cursors: Record<string, number>;
	/** Global floor: only rows with Z_PK above it (0 = no floor). */
	afterPk: number;
	includeGroupChats: boolean;
	includeDirectChats: boolean;
	/** Selective sync: chats to keep ("include") or drop ("exclude"). */
	chatFilterMode: ChatFilterMode;
	chatFilterJids: string[];
	/** Drop chats WhatsApp marks as archived (ignored if the store lacks the flag). */
	skipArchived: boolean;
}

export interface MessageRead {
	rows: ChatStorageMessage[];
	/** MAX(Z_PK) when the read started — the next high-water mark. */
	maxPk: number;
	/** Current members of the group chats in `rows`, names resolved (may be empty for a chat). */
	members: Record<string, string[]>;
}

interface Stores {
	chat: SqlConnection;
	/** ContactsV2.sqlite, or null when it is absent or unreadable. */
	contacts: SqlConnection | null;
	close(): void;
}

async function openStores(dbPath: string, driver?: SqliteDriver): Promise<Stores> {
	const d = driver ?? (await selectDriver());
	const chat = await d.open(dbPath);
	let contacts: SqlConnection | null = null;
	try {
		contacts = await d.open(contactsStoragePath(dbPath));
	} catch {
		log.detail(`ContactsV2.sqlite missing or unreadable next to ${dbPath}`);
	}
	return {
		chat,
		contacts,
		close() {
			chat.close();
			contacts?.close();
		},
	};
}

/**
 * Validate connectivity without writing anything, build the name index, and
 * resolve a few recent group senders so the user can confirm names come out
 * readable. Throws the SQLite error if the core tables/columns are missing.
 */
export async function inspectChatStorage(dbPath: string, driver?: SqliteDriver): Promise<ChatStorageReport> {
	const stores = await openStores(dbPath, driver);
	try {
		const index = buildSenderDirectory(stores.chat, stores.contacts);
		const total = Number(stores.chat.all("SELECT COUNT(*) AS n FROM ZWAMESSAGE WHERE ZTEXT IS NOT NULL")[0]?.n ?? 0);

		const rows = stores.chat.all(`
			SELECT member.ZMEMBERJID AS sender_member_jid, msg.ZFROMJID AS sender_jid
			FROM ZWAMESSAGE AS msg
			JOIN ZWACHATSESSION AS chat ON chat.Z_PK = msg.ZCHATSESSION
			LEFT JOIN ZWAGROUPMEMBER AS member ON member.Z_PK = msg.ZGROUPMEMBER
			WHERE msg.ZTEXT IS NOT NULL AND chat.ZCONTACTJID LIKE '%@g.us'
			ORDER BY msg.ZMESSAGEDATE DESC, msg.Z_PK DESC
			LIMIT 8
		`);
		const samples = rows.map((r) => {
			const who = resolveSenderName(r.sender_member_jid, r.sender_jid, index);
			// Show only the resolved label and the KIND of identifier — never the
			// raw JID (a phone number or LID) nor any message text.
			const jid = nonEmptyText(r.sender_member_jid) ?? "";
			const m = t().probe;
			const kind = jid.endsWith("@lid") ? "@lid" : jid.endsWith("@s.whatsapp.net") ? m.kindPhone : m.kindNone;
			return `${JSON.stringify(who ?? m.you)} ← ${kind}`;
		});

		log.step(`access test: ${total} text messages ${index.contacts} contacts, ${index.pushNames} profile names`);
		samples.forEach((line) => log.detail(`sample sender: ${line}`));

		return {
			total,
			hasContactsDb: !!stores.contacts,
			contacts: index.contacts,
			pushNames: index.pushNames,
			samples,
		};
	} finally {
		stores.close();
	}
}

// Groups always count; other JIDs are dropped when they look like status /
// broadcast pseudo-chats (LIKE is case-insensitive, as classifyChat is).
const REAL_CHAT = "(chat.ZCONTACTJID LIKE '%@g.us' OR (chat.ZCONTACTJID NOT LIKE '%status%' AND chat.ZCONTACTJID NOT LIKE '%broadcast%'))";

/**
 * Members of the group chats present in `rows`, with names resolved like
 * senders (contact → profile name → phone → placeholder). Tolerates builds
 * whose ZWAGROUPMEMBER lacks the expected columns: no members, no error.
 */
function readGroupMembers(conn: SqlConnection, rows: ChatStorageMessage[], index: SenderDirectory): Record<string, string[]> {
	const members: Record<string, string[]> = {};
	const groups = [...new Set(rows.map((r) => r.jid).filter((j) => j.endsWith("@g.us")))];
	if (!groups.length) return members;
	try {
		const cols = columnsOf(conn, "ZWAGROUPMEMBER");
		if (!cols.has("ZCHATSESSION") || !cols.has("ZMEMBERJID")) {
			log.detail("db: ZWAGROUPMEMBER has no ZCHATSESSION/ZMEMBERJID — group members unavailable");
			return members;
		}
		const active = cols.has("ZISACTIVE") ? "AND COALESCE(member.ZISACTIVE, 1) = 1" : "";
		const found = conn.all(
			`
			SELECT chat.ZCONTACTJID AS chat_jid, member.ZMEMBERJID AS sender_member_jid
			FROM ZWAGROUPMEMBER AS member
			JOIN ZWACHATSESSION AS chat ON chat.Z_PK = member.ZCHATSESSION
			WHERE chat.ZCONTACTJID IN (SELECT value FROM json_each($jids)) ${active}
		`,
			{ jids: JSON.stringify(groups) },
		);
		for (const r of found) {
			const chat = nonEmptyText(r.chat_jid);
			const name = resolveSenderName(r.sender_member_jid, null, index);
			if (chat && name) (members[chat] ??= []).push(name);
		}
	} catch (e) {
		log.detail(`db: could not read group members: ${e instanceof Error ? e.message : String(e)}`);
	}
	return members;
}

/**
 * SQL pieces for media messages, adapted to the columns this WhatsApp build
 * has. Without ZWAMEDIAITEM (or ZMESSAGETYPE) only text messages are read.
 */
function mediaColumns(conn: SqlConnection): { select: string; join: string; filter: string } {
	const msg = columnsOf(conn, "ZWAMESSAGE");
	const item = columnsOf(conn, "ZWAMEDIAITEM");
	if (!msg.has("ZMESSAGETYPE") || !msg.has("ZMEDIAITEM") || !item.size) {
		log.detail("db: no media columns in this WhatsApp build — only text messages are read");
		return { select: "NULL AS type", join: "", filter: "msg.ZTEXT IS NOT NULL" };
	}
	const col = (name: string, alias: string): string => (item.has(name) ? `media.${name} AS ${alias}` : `NULL AS ${alias}`);
	return {
		select: [
			"msg.ZMESSAGETYPE AS type",
			col("ZTITLE", "media_title"),
			col("ZMOVIEDURATION", "media_duration"),
			col("ZVCARDNAME", "media_vcard"),
			col("ZLATITUDE", "media_lat"),
			col("ZLONGITUDE", "media_lon"),
			col("ZMEDIALOCALPATH", "media_path"),
		].join(", "),
		join: "LEFT JOIN ZWAMEDIAITEM AS media ON media.Z_PK = msg.ZMEDIAITEM",
		filter: `(msg.ZTEXT IS NOT NULL OR msg.ZMESSAGETYPE IN (${MEDIA_TYPES.join(", ")}))`,
	};
}

function numberOrNull(value: unknown): number | null {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(n) ? n : null;
}

/** The media details of a row, or null for a text message. */
function mediaInfo(row: Record<string, unknown>): MediaInfo | null {
	const kind = typeof row.type === "number" || typeof row.type === "bigint" ? mediaKindOf(Number(row.type)) : null;
	if (!kind) return null;
	const path = nonEmptyText(row.media_path as never);
	const fileName = path ? (path.split("/").pop() ?? null) : null;
	const duration = numberOrNull(row.media_duration);
	return {
		kind,
		durationSec: duration && duration > 0 ? duration : null,
		name:
			kind === "document"
				? (nonEmptyText(row.text as never) ?? nonEmptyText(row.media_title as never) ?? fileName)
				: kind === "contact"
					? nonEmptyText(row.media_vcard as never)
					: null,
		latitude: kind === "location" ? numberOrNull(row.media_lat) : null,
		longitude: kind === "location" ? numberOrNull(row.media_lon) : null,
	};
}

/** Column names of a table — WhatsApp's schema varies between builds. */
function columnsOf(conn: SqlConnection, table: string): Set<string> {
	return new Set(conn.all(`PRAGMA table_info(${table})`).map((r) => String(r.name)));
}

/** The chat-scope filter, mirroring core/selection.ts#chatInScope in SQL. */
function scopeFilter(q: MessageQuery, sessionColumns: Set<string>): string {
	const parts = [REAL_CHAT];
	if (!q.includeGroupChats) parts.push("chat.ZCONTACTJID NOT LIKE '%@g.us'");
	if (!q.includeDirectChats) parts.push("chat.ZCONTACTJID LIKE '%@g.us'");
	if (q.chatFilterMode === "include") parts.push("chat.ZCONTACTJID IN (SELECT jid FROM temp.wa_filter)");
	if (q.chatFilterMode === "exclude") parts.push("chat.ZCONTACTJID NOT IN (SELECT jid FROM temp.wa_filter)");
	if (q.skipArchived) {
		if (sessionColumns.has("ZARCHIVED")) parts.push("COALESCE(chat.ZARCHIVED, 0) = 0");
		else log.detail("db: ZWACHATSESSION has no ZARCHIVED column — 'Skip archived chats' has no effect");
	}
	return parts.join(" AND ");
}

/**
 * Every real chat (no status/broadcast) with its newest text message and text
 * message count, for the chat picker. One aggregate pass over ZWAMESSAGE.
 */
export async function listChats(dbPath: string, driver?: SqliteDriver): Promise<ChatListing[]> {
	const stores = await openStores(dbPath, driver);
	try {
		const cols = columnsOf(stores.chat, "ZWACHATSESSION");
		const archived = cols.has("ZARCHIVED") ? "COALESCE(chat.ZARCHIVED, 0)" : "0";
		const removed = cols.has("ZREMOVED") ? "AND COALESCE(chat.ZREMOVED, 0) = 0" : "";
		const rows = stores.chat.all(`
			SELECT
				chat.ZCONTACTJID AS jid,
				COALESCE(chat.ZPARTNERNAME, chat.ZCONTACTJID) AS name,
				${archived} AS archived,
				agg.last AS last,
				COALESCE(agg.n, 0) AS n
			FROM ZWACHATSESSION AS chat
			LEFT JOIN (
				SELECT ZCHATSESSION AS session, COUNT(*) AS n, MAX(ZMESSAGEDATE) AS last
				FROM ZWAMESSAGE WHERE ZTEXT IS NOT NULL GROUP BY ZCHATSESSION
			) agg ON agg.session = chat.Z_PK
			WHERE chat.ZCONTACTJID IS NOT NULL AND ${REAL_CHAT} ${removed}
		`);
		const out: ChatListing[] = [];
		for (const r of rows) {
			const jid = nonEmptyText(r.jid);
			const kind = jid ? classifyChat(jid) : null;
			if (!jid || !kind) continue;
			out.push({
				jid,
				name: chatDisplayName(nonEmptyText(r.name), jid),
				kind,
				lastMessageMac: r.last === null || r.last === undefined ? null : Number(r.last),
				messageTotal: Number(r.n ?? 0),
				archived: Number(r.archived ?? 0) === 1,
			});
		}
		return out;
	} finally {
		stores.close();
	}
}

/**
 * Read the text messages a sync needs: inside the time window, above each
 * chat's cursor and in scope — oldest first (Z_PK breaks same-second ties) so
 * callers can append them chronologically.
 */
export async function readMessages(dbPath: string, q: MessageQuery, driver?: SqliteDriver): Promise<MessageRead> {
	const stores = await openStores(dbPath, driver);
	try {
		// Taken BEFORE the main query: a row inserted in between is then above
		// the next floor and read next time (cursors drop any overlap).
		const maxPk = Number(stores.chat.all("SELECT COALESCE(MAX(Z_PK), 0) AS n FROM ZWAMESSAGE")[0]?.n ?? 0);

		const index = buildSenderDirectory(stores.chat, stores.contacts);
		log.step(
			`sender names: ${index.contacts} contacts, ${index.pushNames} profile names` +
				(stores.contacts ? "" : " (no ContactsV2.sqlite: profile names and phone numbers only)"),
		);

		// Per-chat cursors go into an indexed TEMP table (the TEMP schema is
		// separate from the read-only WhatsApp database), filled from one JSON
		// parameter.
		stores.chat.run("CREATE TEMP TABLE IF NOT EXISTS wa_cursor (jid TEXT PRIMARY KEY, last_pk INTEGER NOT NULL)");
		stores.chat.run("DELETE FROM temp.wa_cursor");
		stores.chat.run("INSERT INTO temp.wa_cursor (jid, last_pk) SELECT key, value FROM json_each($cursors)", {
			cursors: JSON.stringify(q.cursors),
		});
		// Selective-sync JIDs, same technique.
		stores.chat.run("CREATE TEMP TABLE IF NOT EXISTS wa_filter (jid TEXT PRIMARY KEY)");
		stores.chat.run("DELETE FROM temp.wa_filter");
		stores.chat.run("INSERT OR IGNORE INTO temp.wa_filter (jid) SELECT value FROM json_each($jids)", {
			jids: JSON.stringify(q.chatFilterJids),
		});
		const sessionColumns = columnsOf(stores.chat, "ZWACHATSESSION");
		const media = mediaColumns(stores.chat);

		// Names live in ZWAPROFILEPUSHNAME / ContactsV2 (see buildSenderDirectory);
		// ZWAGROUPMEMBER only supplies the sender's @lid via ZMEMBERJID.
		const rows = stores.chat.all(
			`
			SELECT
				msg.Z_PK AS zPk,
				chat.ZCONTACTJID AS jid,
				COALESCE(chat.ZPARTNERNAME, chat.ZCONTACTJID) AS chat_title,
				member.ZMEMBERJID AS sender_member_jid,
				msg.ZFROMJID AS sender_jid,
				msg.ZTEXT AS text,
				msg.ZMESSAGEDATE AS sent_core_data,
				msg.ZISFROMME AS is_from_me,
				${media.select}
			FROM ZWAMESSAGE AS msg
			JOIN ZWACHATSESSION AS chat ON chat.Z_PK = msg.ZCHATSESSION
			LEFT JOIN ZWAGROUPMEMBER AS member ON member.Z_PK = msg.ZGROUPMEMBER
			${media.join}
			LEFT JOIN temp.wa_cursor AS cursor ON cursor.jid = chat.ZCONTACTJID
			WHERE msg.Z_PK > $afterPk
				AND ${media.filter}
				AND msg.ZMESSAGEDATE > $since
				AND msg.Z_PK > COALESCE(cursor.last_pk, 0)
				AND ${scopeFilter(q, sessionColumns)}
			ORDER BY msg.ZMESSAGEDATE ASC, msg.Z_PK ASC
		`,
			{ since: q.sinceMac, afterPk: q.afterPk },
		);

		const out: ChatStorageMessage[] = [];
		for (const record of rows) {
			const chatJid = nonEmptyText(record.jid);
			if (!chatJid) continue;
			const media = mediaInfo(record);
			const body = record.text == null ? "" : String(record.text);
			out.push({
				zPk: Number(record.zPk),
				jid: chatJid,
				chatTitle: nonEmptyText(record.chat_title) ?? chatJid,
				sender: resolveSenderName(record.sender_member_jid, record.sender_jid, index),
				// Documents keep their file name in ZTEXT; photos and videos keep the caption in ZTITLE.
				text: !media ? body : media.kind === "document" ? "" : (nonEmptyText(record.media_title) ?? body),
				coreDataTime: Number(record.sent_core_data),
				isFromMe: Number(record.is_from_me) === 1,
				media,
			});
		}
		log.step(`read ${out.length} message row(s) above Z_PK ${q.afterPk}`);
		return { rows: out, maxPk, members: readGroupMembers(stores.chat, out, index) };
	} finally {
		stores.close();
	}
}
