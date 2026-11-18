import { describe, expect, it } from "vitest";

import {
	chatInScope,
	describeScope,
	filterListing,
	listFor,
	pickerStart,
	withCheckedMissing,
	selectionSummary,
	startSyncing,
	stopSyncing,
	storeList,
	type ChatListing,
} from "../../src/core/selection";
import type { ChatFilterEntry, ChatFilterMode } from "../../src/core/types";
import { applyScopeChoice } from "../../src/core/choices";

const G = { jid: "g@g.us", name: "Grupo", kind: "group" as const };
const P = { jid: "p@s.whatsapp.net", name: "Pessoa", kind: "personal" as const };
const entry = (c: typeof G | typeof P): Record<string, ChatFilterEntry> => ({ [c.jid]: { name: c.name, kind: c.kind } });

describe("chatInScope", () => {
	const base = { includeGroupChats: true, includeDirectChats: true, chatFilterMode: "all" as const, chosenChats: {}, excludedChats: {} };

	it("'all' keeps every chat of the enabled kinds", () => {
		expect(chatInScope(G.jid, "group", base)).toBe(true);
		expect(chatInScope(P.jid, "personal", base)).toBe(true);
		expect(chatInScope(G.jid, "group", { ...base, includeGroupChats: false })).toBe(false);
		expect(chatInScope(P.jid, "personal", { ...base, includeDirectChats: false })).toBe(false);
	});

	it("'include' keeps only chosen chats", () => {
		const s = { ...base, chatFilterMode: "include" as const, excludedChats: {}, chosenChats: entry(G) };
		expect(chatInScope(G.jid, "group", s)).toBe(true);
		expect(chatInScope(P.jid, "personal", s)).toBe(false);
	});

	it("'exclude' drops chosen chats", () => {
		const s = { ...base, chatFilterMode: "exclude" as const, chosenChats: {}, excludedChats: entry(G) };
		expect(chatInScope(G.jid, "group", s)).toBe(false);
		expect(chatInScope(P.jid, "personal", s)).toBe(true);
	});

	it("kind toggles win over the filter", () => {
		expect(chatInScope(G.jid, "group", { ...base, includeGroupChats: false, chatFilterMode: "include", excludedChats: {}, chosenChats: entry(G) })).toBe(false);
	});

	it("is not fooled by inherited object keys", () => {
		expect(chatInScope("toString", "personal", { ...base, chatFilterMode: "include", excludedChats: {}, chosenChats: {} })).toBe(false);
	});
});

describe("selectionSummary / describeScope", () => {
	const both = { ...entry(G), ...entry(P) };

	it("counts by kind", () => {
		expect(selectionSummary(both)).toEqual({ total: 2, groups: 1, personal: 1 });
	});

	it("describes each choice, including the empty lists", () => {
		expect(describeScope("all", both)).toBe("Every chat is copied to the vault.");
		expect(describeScope("groups", both)).toBe("Only group chats are copied.");
		expect(describeScope("personal", both)).toBe("Only one-to-one chats are copied.");
		expect(describeScope("include", both)).toBe("Only the chosen chats are copied: 2 chats (1 group, 1 personal).");
		expect(describeScope("include", {})).toBe("No chat chosen yet — nothing will be copied.");
		expect(describeScope("exclude", entry(G))).toBe("Every chat is copied except the chosen ones: 1 chat (1 group, 0 personal).");
		expect(describeScope("exclude", {})).toBe("No exceptions — every chat is copied.");
	});
});

describe("startSyncing / stopSyncing", () => {
	it("include: adds and removes the chat", () => {
		const added = startSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: {} }, G);
		expect(added).toMatchObject({ mode: "include", filter: entry(G), changed: true });
		expect(startSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: entry(G) }, G).changed).toBe(false);
		expect(stopSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: entry(G) }, G)).toMatchObject({ filter: {}, changed: true });
		expect(stopSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: {} }, G).changed).toBe(false);
	});

	it("exclude: removing from / adding to the exclusions", () => {
		expect(startSyncing({ chatFilterMode: "exclude", chosenChats: {}, excludedChats: entry(G) }, G)).toMatchObject({ filter: {}, changed: true });
		expect(startSyncing({ chatFilterMode: "exclude", chosenChats: {}, excludedChats: {} }, G).changed).toBe(false);
		expect(stopSyncing({ chatFilterMode: "exclude", chosenChats: {}, excludedChats: {} }, G)).toMatchObject({ mode: "exclude", filter: entry(G), changed: true });
		expect(stopSyncing({ chatFilterMode: "exclude", chosenChats: {}, excludedChats: entry(G) }, G).changed).toBe(false);
	});

	it("all: stopping a chat switches to 'exclude' with just that chat; starting is a no-op", () => {
		expect(stopSyncing({ chatFilterMode: "all", chosenChats: {}, excludedChats: entry(P) }, G)).toMatchObject({ mode: "exclude", filter: entry(G), changed: true });
		expect(startSyncing({ chatFilterMode: "all", chosenChats: {}, excludedChats: {} }, G).changed).toBe(false);
	});

	it("never mutates the input filter", () => {
		const filter = entry(G);
		stopSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: filter }, G);
		startSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: filter }, P);
		expect(filter).toEqual(entry(G));
	});
});

describe("filterListing", () => {
	const chat = (o: Partial<ChatListing>): ChatListing => ({
		jid: "x",
		name: "X",
		kind: "personal",
		lastMessageMac: 1,
		messageTotal: 1,
		archived: false,
		...o,
	});
	const list = [
		chat({ jid: "a", name: "Família Silva", kind: "group", lastMessageMac: 10 }),
		chat({ jid: "b", name: "João", lastMessageMac: 30 }),
		chat({ jid: "c", name: "Antigo", lastMessageMac: 20, archived: true }),
		chat({ jid: "d", name: "Sem mensagens", lastMessageMac: null }),
	];

	it("sorts by most recent activity and hides archived chats by default", () => {
		expect(filterListing(list, { query: "", kind: "all", showArchived: false }).map((c) => c.jid)).toEqual(["b", "a", "d"]);
		expect(filterListing(list, { query: "", kind: "all", showArchived: true }).map((c) => c.jid)).toEqual(["b", "c", "a", "d"]);
	});

	it("searches names ignoring case and accents", () => {
		expect(filterListing(list, { query: "familia", kind: "all", showArchived: false }).map((c) => c.jid)).toEqual(["a"]);
		expect(filterListing(list, { query: "JOAO", kind: "all", showArchived: false }).map((c) => c.jid)).toEqual(["b"]);
	});

	it("lists the chats checked at open first", () => {
		expect(filterListing(list, { query: "", kind: "all", showArchived: false, pinned: new Set(["d", "a"]) }).map((c) => c.jid)).toEqual(["a", "d", "b"]);
	});

	it("'checked' shows only checked chats, archived included", () => {
		expect(filterListing(list, { query: "", kind: "checked", showArchived: false, checked: new Set(["c", "a"]) }).map((c) => c.jid)).toEqual(["c", "a"]);
		expect(filterListing(list, { query: "", kind: "checked", showArchived: false }).map((c) => c.jid)).toEqual([]);
	});

	it("adds checked chats WhatsApp does not list, so they can be seen and unchecked", () => {
		const rows = withCheckedMissing(list, { a: { name: "Família Silva", kind: "group" }, z: { name: "Apagada", kind: "group" } });
		expect(rows.map((c) => c.jid)).toEqual(["a", "b", "c", "d", "z"]);
		expect(rows.at(-1)).toMatchObject({ name: "Apagada", kind: "group", missing: true });
		expect(filterListing(rows, { query: "", kind: "checked", showArchived: false, checked: new Set(["a", "z"]) }).map((c) => c.jid)).toEqual(["a", "z"]);
		expect(withCheckedMissing([], { q: {} as ChatFilterEntry })[0]).toMatchObject({ name: "q", kind: "personal" });
	});

	it("filters by kind", () => {
		expect(filterListing(list, { query: "", kind: "group", showArchived: true }).map((c) => c.jid)).toEqual(["a"]);
	});
});

describe("separate chosen and excluded lists", () => {
	it("switching modes never shows the other mode's chats as selected", () => {
		const s = { includeGroupChats: true, includeDirectChats: true, chatFilterMode: "all" as ChatFilterMode, chosenChats: {}, excludedChats: {} };
		// "Stop syncing this chat" while syncing everything → excluded list [G].
		const stop = stopSyncing(s, G);
		s.chatFilterMode = stop.mode;
		Object.assign(s, storeList("exclude", stop.filter));
		expect(listFor(s, "exclude")).toEqual(entry(G));

		// Switching to "Only chosen chats": nothing is pre-selected.
		Object.assign(s, applyScopeChoice("include"));
		expect(listFor(s, s.chatFilterMode)).toEqual({});
		expect(chatInScope(G.jid, "group", s)).toBe(false);

		// Choosing P there does not touch the exclusions, which come back intact.
		Object.assign(s, storeList("include", entry(P)));
		Object.assign(s, applyScopeChoice("exclude"));
		expect(listFor(s, s.chatFilterMode)).toEqual(entry(G));
		expect(chatInScope(P.jid, "personal", s)).toBe(true);
	});

	it("the picker opens with only the current mode's chats checked", () => {
		const lists = { chosenChats: entry(P), excludedChats: entry(G) };
		// Syncing everything (or groups/personal only): edits the chosen list, exclusions stay unchecked.
		expect(pickerStart({ ...lists, chatFilterMode: "all" })).toEqual({ mode: "include", checked: entry(P) });
		expect(pickerStart({ chosenChats: {}, excludedChats: entry(G), chatFilterMode: "all" })).toEqual({ mode: "include", checked: {} });
		expect(pickerStart({ ...lists, chatFilterMode: "include" })).toEqual({ mode: "include", checked: entry(P) });
		expect(pickerStart({ ...lists, chatFilterMode: "exclude" })).toEqual({ mode: "exclude", checked: entry(G) });
	});

	it("unchecking in the picker does not change the saved list until Save", () => {
		const s = { chosenChats: entry(P), excludedChats: {}, chatFilterMode: "include" as ChatFilterMode };
		const { checked } = pickerStart(s);
		delete checked[P.jid];
		expect(s.chosenChats).toEqual(entry(P));
	});

	it("'all' uses no list", () => {
		expect(listFor({ chosenChats: entry(G), excludedChats: entry(P) }, "all")).toEqual({});
	});
});
