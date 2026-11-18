import { describe, expect, it } from "vitest";

import {
	applyPeriodChoice,
	applyScopeChoice,
	intervalOptions,
	periodChoice,
	scopeChoice,
	usesChatList,
	type ScopeChoice,
} from "../../src/core/choices";
import { classifyError, dbNotFoundMessage, userMessage } from "../../src/core/errors";
import { setMacOS } from "../../src/core/platform";

describe("scope choice", () => {
	it("round-trips every choice", () => {
		for (const c of ["all", "groups", "personal", "include", "exclude"] as ScopeChoice[]) {
			expect(scopeChoice(applyScopeChoice(c))).toBe(c);
		}
	});

	it("list-based choices always cover both kinds", () => {
		expect(applyScopeChoice("include")).toEqual({ includeGroupChats: true, includeDirectChats: true, chatFilterMode: "include" });
		expect(applyScopeChoice("exclude")).toEqual({ includeGroupChats: true, includeDirectChats: true, chatFilterMode: "exclude" });
	});

	it("reads hand-edited combinations sensibly", () => {
		expect(scopeChoice({ includeGroupChats: false, includeDirectChats: false, chatFilterMode: "all" })).toBe("all");
		expect(scopeChoice({ includeGroupChats: false, includeDirectChats: true, chatFilterMode: "include" })).toBe("include");
	});

	it("knows which choices use the chat list", () => {
		expect(["all", "groups", "personal", "include", "exclude"].filter((c) => usesChatList(c as ScopeChoice))).toEqual([
			"include",
			"exclude",
		]);
	});
});

describe("period choice", () => {
	it("maps presets and all history", () => {
		expect(periodChoice({ periodDays: 30 })).toBe("30");
		expect(periodChoice({ periodDays: 365 })).toBe("365");
		expect(periodChoice({ periodDays: 0 })).toBe("all");
	});

	it("reports anything else as custom", () => {
		expect(periodChoice({ periodDays: 45 })).toBe("custom");
	});

	it("applies each choice", () => {
		expect(applyPeriodChoice("90")).toEqual({ periodDays: 90 });
		expect(applyPeriodChoice("all")).toEqual({ periodDays: 0 });
	});
});

describe("interval options", () => {
	it("offers the presets, plus a hand-edited value in order", () => {
		expect(intervalOptions(30)).toEqual([0, 15, 30, 60, 120, 240]);
		expect(intervalOptions(45)).toEqual([0, 15, 30, 45, 60, 120, 240]);
	});
});

describe("errors", () => {
	it("recognizes missing Full Disk Access", () => {
		for (const m of ["EPERM: operation not permitted, open '…'", "unable to open database file", "SQLITE_CANTOPEN", "EACCES"]) {
			expect(classifyError(m)).toBe("noAccess");
		}
		expect(classifyError("disk I/O error")).toBe("other");
	});

	it("explains access errors and passes other messages through", () => {
		expect(userMessage(new Error("EPERM: operation not permitted"))).toMatch(/Full Disk Access/);
		expect(userMessage("boom")).toBe("boom");
	});

	it("tells users of an Obsidian build without node:sqlite to update the installer", () => {
		const error = Object.assign(new Error("node:sqlite unavailable"), { name: "SqliteUnavailableError" });
		expect(userMessage(error)).toMatch(/lacks the built-in SQLite.*obsidian\.md/);
	});

	it("off macOS, explains that the system is not supported", () => {
		try {
			setMacOS(false);
			expect(dbNotFoundMessage()).toMatch(/works only on macOS/);
			setMacOS(true);
			expect(dbNotFoundMessage()).toMatch(/Open WhatsApp Desktop at least once/);
		} finally {
			setMacOS(true);
		}
	});
});
