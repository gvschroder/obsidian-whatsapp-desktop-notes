import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __mock } from "../mocks/obsidian";
import { detectLocale } from "../../src/util/locale";

/** Obsidian's language (getLanguage(); "en" when never chosen) and the OS languages. */
function env(obsidian: string, osLanguages: string[]): void {
	__mock.language = obsidian;
	vi.stubGlobal("navigator", { languages: osLanguages, language: osLanguages[0] });
}

beforeEach(() => env("en", ["en-US"]));
afterEach(() => {
	vi.unstubAllGlobals();
	__mock.language = "en";
});

describe("detectLocale", () => {
	it("follows the OS when Obsidian is in English (its default when nothing was chosen)", () => {
		env("en", ["pt-BR", "en-US"]);
		expect(detectLocale()).toBe("pt");
		env("en", ["de-DE"]);
		expect(detectLocale()).toBe("en");
	});

	it("a non-English Obsidian language wins over the OS", () => {
		env("pt-BR", ["en-US"]);
		expect(detectLocale()).toBe("pt");
		env("zh-TW", ["pt-BR"]);
		expect(detectLocale()).toBe("en");
	});

	it("the plugin setting overrides everything", () => {
		env("en", ["pt-BR"]);
		expect(detectLocale("en")).toBe("en");
		env("pt", ["en-US"]);
		expect(detectLocale("pt")).toBe("pt");
		expect(detectLocale("en")).toBe("en");
	});

	it("falls back to English when the OS language is unreadable", () => {
		vi.stubGlobal("navigator", { languages: [], language: undefined });
		expect(detectLocale()).toBe("en");
	});
});
