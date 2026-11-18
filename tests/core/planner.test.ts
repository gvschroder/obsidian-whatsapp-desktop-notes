import { describe, expect, it } from "vitest";

import {
	retentionCutoffDay,
	chatParticipants,
	cursorsOf,
	freeNotePath,
	freshMessages,
	groupByChat,
	indexPath,
	INDEX_NOTE_NAME,
	readFloor,
	sameParticipants,
	scopeKey,
	targetRoot,
	periodStartCoreDataTime,
	type ChatGroup,
} from "../../src/core/planner";
import { dateToCoreDataTime } from "../../src/core/mactime";
import { DEFAULT_SETTINGS, type ChatSyncRecord, type ChatStorageMessage } from "../../src/core/types";

const NOW = Date.parse("2026-03-11T12:00:00Z");

function msg(zPk: number, jid: string, chatTitle = "Chat"): ChatStorageMessage {
	return { zPk, jid, chatTitle, sender: null, text: `m${zPk}`, coreDataTime: 0, isFromMe: false };
}

function chatState(overrides: Partial<ChatSyncRecord> = {}): ChatSyncRecord {
	return {
		jid: "a@s.whatsapp.net",
		name: "A",
		kind: "personal",
		grouping: "single",
		transcriptPath: "X/Personal/A abc.md",
		lastMessageZPk: 0,
		lastMessageAtIso: "",
		lastDayHeading: "",
		messageTotal: 0,
		coveredSinceMac: null,
		participants: [],
		...overrides,
	};
}

describe("periodStartCoreDataTime", () => {
	it("is 0 (all history) when the period is 0", () => {
		expect(periodStartCoreDataTime({ periodDays: 0, retentionDays: 0 }, NOW)).toBe(0);
	});

	it("uses now − N days", () => {
		expect(periodStartCoreDataTime({ periodDays: 1, retentionDays: 0 }, NOW)).toBe(dateToCoreDataTime(new Date("2026-03-10T12:00:00Z")));
	});

	it("never reaches before the TTL's first day (local midnight)", () => {
		const ttlStart = dateToCoreDataTime(new Date(2026, 2, 9)); // NOW − 2 days, at 00:00 local
		expect(periodStartCoreDataTime({ periodDays: 0, retentionDays: 2 }, NOW)).toBe(ttlStart);
		expect(periodStartCoreDataTime({ periodDays: 30, retentionDays: 2 }, NOW)).toBe(ttlStart);
		expect(periodStartCoreDataTime({ periodDays: 1, retentionDays: 30 }, NOW)).toBe(dateToCoreDataTime(new Date("2026-03-10T12:00:00Z")));
	});
});

describe("retentionCutoffDay", () => {
	it("is the first local day the TTL keeps, or nothing when it is off", () => {
		expect(retentionCutoffDay({ retentionDays: 0 }, NOW)).toBe("");
		expect(retentionCutoffDay({ retentionDays: 2 }, NOW)).toBe("2026-03-09");
		expect(retentionCutoffDay({ retentionDays: 30 }, NOW)).toBe("2026-02-09");
	});
});


describe("cursorsOf", () => {
	it("maps each chat JID to its last written Z_PK", () => {
		expect(cursorsOf({ a: chatState({ jid: "a", lastMessageZPk: 3 }), b: chatState({ jid: "b", lastMessageZPk: 9 }) })).toEqual({ a: 3, b: 9 });
		expect(cursorsOf({})).toEqual({});
	});
});

describe("scopeKey / readFloor", () => {
	const scope = {
		includeGroupChats: true,
		includeDirectChats: true,
		periodDays: 30,
		chatFilterMode: "all" as const,
		chosenChats: {}, excludedChats: {},
		skipArchived: false,
	};

	it("uses the high-water mark only when the scope is unchanged", () => {
		const state = { highWater: 500, scopeKey: scopeKey(scope) };
		expect(readFloor(state, scope)).toBe(500);
		expect(readFloor(state, { ...scope, includeGroupChats: false })).toBe(0);
		expect(readFloor(state, { ...scope, periodDays: 60 })).toBe(0);
		expect(readFloor({ highWater: null, scopeKey: null }, scope)).toBe(0);
	});

	it("a selection change (mode, chats or archived) invalidates the mark; chat names do not", () => {
		const include = { ...scope, chatFilterMode: "include" as const, excludedChats: {}, chosenChats: { a: { name: "A", kind: "group" as const } } };
		const state = { highWater: 500, scopeKey: scopeKey(include) };
		expect(readFloor(state, include)).toBe(500);
		expect(readFloor(state, { ...include, chosenChats: { a: { name: "Renamed", kind: "group" as const } } })).toBe(500);
		expect(readFloor(state, { ...include, chosenChats: { ...include.chosenChats, b: { name: "B", kind: "personal" as const } } })).toBe(0);
		expect(readFloor(state, { ...include, chatFilterMode: "exclude" })).toBe(0);
		expect(readFloor(state, { ...include, skipArchived: true })).toBe(0);
		// In "all" mode the (unused) list does not matter.
		expect(scopeKey({ ...scope, chosenChats: {}, excludedChats: { a: { name: "A", kind: "group" as const } } })).toBe(scopeKey(scope));
	});
});

describe("groupByChat", () => {
	const rows = [
		msg(1, "g1@g.us", "Grupo"),
		msg(2, "p1@s.whatsapp.net", "Pessoa"),
		msg(3, "status@broadcast"),
		msg(4, "g1@g.us", "Grupo renomeado"),
	];

	it("names untitled chats by phone number and trims titles", () => {
		const groups = groupByChat(
			[msg(1, "5511999990005@s.whatsapp.net", "5511999990005@s.whatsapp.net"), msg(2, "g2@g.us", "  Grupo  ")],
			{ includeGroupChats: true, includeDirectChats: true, chatFilterMode: "all", chosenChats: {}, excludedChats: {} },
		);
		expect(groups.map((g) => [g.name, g.named])).toEqual([
			["+5511999990005", false],
			["Grupo", true],
		]);
	});

	it("groups by JID in first-seen order, naming each chat from its first row", () => {
		const groups = groupByChat(rows, { includeGroupChats: true, includeDirectChats: true, chatFilterMode: "all", chosenChats: {}, excludedChats: {} });
		expect(groups.map((g) => [g.jid, g.kind, g.name, g.messages.map((m) => m.zPk)])).toEqual([
			["g1@g.us", "group", "Grupo", [1, 4]],
			["p1@s.whatsapp.net", "personal", "Pessoa", [2]],
		]);
	});

	it("applies the selective-sync filter", () => {
		const only = groupByChat(rows, { includeGroupChats: true, includeDirectChats: true, chatFilterMode: "include", excludedChats: {}, chosenChats: { "p1@s.whatsapp.net": { name: "P", kind: "personal" } } });
		expect(only.map((g) => g.jid)).toEqual(["p1@s.whatsapp.net"]);
	});

	it("drops disabled kinds", () => {
		expect(groupByChat(rows, { includeGroupChats: false, includeDirectChats: true, chatFilterMode: "all", chosenChats: {}, excludedChats: {} }).map((g) => g.jid)).toEqual(["p1@s.whatsapp.net"]);
		expect(groupByChat(rows, { includeGroupChats: true, includeDirectChats: false, chatFilterMode: "all", chosenChats: {}, excludedChats: {} }).map((g) => g.jid)).toEqual(["g1@g.us"]);
	});
});

describe("freshMessages", () => {
	const group: ChatGroup = { jid: "g@g.us", kind: "group", name: "G", named: true, messages: [msg(5, "g@g.us"), msg(6, "g@g.us"), msg(7, "g@g.us")] };

	it("returns everything for a new chat", () => {
		expect(freshMessages(group, undefined).map((m) => m.zPk)).toEqual([5, 6, 7]);
	});

	it("returns only rows above the cursor", () => {
		expect(freshMessages(group, chatState({ lastMessageZPk: 6 })).map((m) => m.zPk)).toEqual([7]);
	});
});

describe("note paths", () => {
	const settings = { notesRootFolder: "WA", groupNotesFolder: "G", directNotesFolder: "P" };
	const group: ChatGroup = { jid: "120363000000000001@g.us", kind: "group", name: 'Time: "A" #1', named: true, messages: [] };
	const free = (): boolean => false;

	it("names new notes after the chat, under the kind's subfolder", () => {
		expect(freeNotePath(group.name, "group", settings, free)).toBe("WA/G/Time A 1.md");
		expect(freeNotePath(group.name, "personal", settings, free)).toBe("WA/P/Time A 1.md");
	});

	it("adds (2), (3)… when the name is taken", () => {
		const taken = new Set(["WA/G/Time A 1.md", "WA/G/Time A 1 (2).md"]);
		expect(freeNotePath("Time A 1", "group", settings, (p) => taken.has(p))).toBe("WA/G/Time A 1 (3).md");
		expect(freeNotePath("X", "group", { ...settings, groupNotesFolder: "" }, free)).toBe("WA/X.md");
	});


	it("falls back to the default root when the target folder is blank", () => {
		expect(targetRoot({ notesRootFolder: "  " })).toBe(DEFAULT_SETTINGS.notesRootFolder);
		expect(indexPath({ notesRootFolder: "" })).toBe("WhatsApp/WhatsApp Index.md");
	});

	it("gives the index note a fixed name, whatever the folder", () => {
		expect(indexPath({ notesRootFolder: "Arquivo/Chats" })).toBe("Arquivo/Chats/WhatsApp Index.md");
		expect(INDEX_NOTE_NAME).toBe("WhatsApp Index");
	});
});

describe("chatParticipants", () => {
	const m = (zPk: number, sender: string | null, isFromMe = false): ChatStorageMessage => ({ ...msg(zPk, "g@g.us"), sender, isFromMe });
	const group: ChatGroup = { jid: "g@g.us", kind: "group", name: "G", named: true, messages: [m(1, "Bia"), m(2, null, true), m(3, "Ana")] };

	it("personal chats: the other person and you", () => {
		expect(chatParticipants({ ...group, kind: "personal", name: "Caio" }, ["x"], "Eu", [])).toEqual(["Caio", "Eu"]);
	});

	it("groups: WhatsApp's member list, deduplicated and sorted", () => {
		expect(chatParticipants(group, ["Zé", "Ana", "Zé"], "Eu", ["Antigo"])).toEqual(["Ana", "Zé"]);
	});

	it("groups without a member list: previous names plus this batch's senders", () => {
		expect(chatParticipants(group, undefined, "Eu", ["Caio"])).toEqual(["Ana", "Bia", "Caio", "Eu"]);
	});

	it("compares lists", () => {
		expect(sameParticipants(["A", "B"], ["A", "B"])).toBe(true);
		expect(sameParticipants(undefined, [])).toBe(false);
		expect(sameParticipants(["A"], ["B"])).toBe(false);
	});
});
