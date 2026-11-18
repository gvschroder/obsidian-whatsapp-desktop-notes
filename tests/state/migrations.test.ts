import { afterEach, describe, expect, it } from "vitest";

import { initialSettings, migrate, NewerSchemaError } from "../../src/state/migrations";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import { setLocale } from "../../src/core/i18n";

const chat = {
	jid: "g@g.us",
	name: "G",
	kind: "group",
	grouping: "month",
	transcriptPath: "WhatsApp/Groups/G h.md",
	lastMessageZPk: 42,
	lastMessageAtIso: "2026-03-10T12:00:00.000Z",
	lastDayHeading: "2026-03-10",
	messageTotal: 7,
	coveredSinceMac: 790000000,
	participants: ["Ana", "Bia"],
};

const EMPTY_STATE = { chatRecords: {}, lastSync: null, highWater: null, scopeKey: null };

afterEach(() => setLocale("en"));

describe("migrate", () => {
	it("starts fresh when there is no data.json", () => {
		for (const raw of [null, undefined, "lixo", 3, []]) {
			expect(migrate(raw)).toEqual({ schemaVersion: 1, settings: initialSettings(), state: EMPTY_STATE });
		}
	});

	it("first-install folder names and 'me' label follow the interface language", () => {
		expect(initialSettings()).toMatchObject({ groupNotesFolder: "Groups", directNotesFolder: "Personal", selfDisplayName: "Me", onboarded: false });
		setLocale("pt");
		expect(initialSettings()).toMatchObject({ groupNotesFolder: "Grupos", directNotesFolder: "Pessoais", selfDisplayName: "Eu" });
		expect(migrate(null).settings.notesRootFolder).toBe("WhatsApp");
	});

	it("new installs split notes by month; files from before the setting keep one note per chat", () => {
		expect(initialSettings().noteGrouping).toBe("month");
		const { grouping: _, ...old } = chat;
		const data = migrate({ schemaVersion: 1, settings: { notesRootFolder: "W" }, state: { chatRecords: { [chat.jid]: old } } });
		expect(data.settings.noteGrouping).toBe("single");
		expect(data.state.chatRecords[chat.jid]?.grouping).toBe("single");
		expect(migrate({ settings: { noteGrouping: "fortnight" } }).settings.noteGrouping).toBe("single");
		expect(migrate({ settings: { noteGrouping: "week" } }).settings.noteGrouping).toBe("week");
	});

	it("loads a saved file as-is", () => {
		const saved = {
			schemaVersion: 1,
			settings: { ...DEFAULT_SETTINGS, includeGroupChats: false, onboarded: true },
			state: { chatRecords: { "g@g.us": chat }, lastSync: null, highWater: 64, scopeKey: '[true,true,30,""]' },
		};
		expect(migrate(saved)).toEqual(saved);
	});

	it("fills missing parts with defaults", () => {
		expect(migrate({ schemaVersion: 1 })).toEqual({ schemaVersion: 1, settings: DEFAULT_SETTINGS, state: EMPTY_STATE });
		expect(migrate({ settings: { notesRootFolder: "X" } }).settings.notesRootFolder).toBe("X");
	});

	it("drops unknown keys, wrongly-typed values and malformed chat entries", () => {
		const data = migrate({
			schemaVersion: 1,
			settings: { periodDays: "30", includeGroupChats: "yes", selfDisplayName: 5, unknownOption: true, notesRootFolder: "OK" },
			state: { chatRecords: { good: chat, bad: { jid: 1 }, worse: null }, lastSync: 123, highWater: Infinity },
		});
		expect(data.settings).toEqual({ ...DEFAULT_SETTINGS, notesRootFolder: "OK" });
		expect(data.state).toEqual({ ...EMPTY_STATE, chatRecords: { good: chat } });
	});

	it("keeps a valid chat selection and drops malformed entries and modes", () => {
		const data = migrate({
			schemaVersion: 1,
			settings: {
				chatFilterMode: "include",
				chosenChats: { "g@g.us": { name: "G", kind: "group" }, bad: { name: 1, kind: "group" }, worse: { name: "W", kind: "robot" } },
				excludedChats: { "x@g.us": { name: "X", kind: "group" } },
				skipArchived: true,
			},
		});
		expect(data.settings.chatFilterMode).toBe("include");
		expect(data.settings.chosenChats).toEqual({ "g@g.us": { name: "G", kind: "group" } });
		expect(data.settings.excludedChats).toEqual({ "x@g.us": { name: "X", kind: "group" } });
		expect(data.settings.skipArchived).toBe(true);
		expect(migrate({ settings: { chatFilterMode: "some", chosenChats: null } }).settings).toMatchObject({
			chatFilterMode: "all",
			chosenChats: {},
			excludedChats: {},
		});
	});

	it("keeps a valid language preference and defaults anything else to auto", () => {
		const lang = (v: unknown): unknown => migrate({ settings: { language: v } }).settings.language;
		expect(lang("pt")).toBe("pt");
		expect(lang("en")).toBe("en");
		expect(lang("fr")).toBe("auto");
		expect(lang(undefined)).toBe("auto");
	});

	it("marks the covered period as unknown and the participants as empty when missing", () => {
		const { coveredSinceMac: _c, participants: _p, ...older } = chat;
		expect(migrate({ state: { chatRecords: { g: older } } }).state.chatRecords.g).toMatchObject({ coveredSinceMac: null, participants: [] });
	});

	it("refuses data written by a newer schema instead of overwriting it", () => {
		expect(() => migrate({ schemaVersion: 2, settings: {}, state: {} })).toThrow(NewerSchemaError);
	});
});
