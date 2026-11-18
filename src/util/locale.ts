// Picks the interface language.
//
// 1. An explicit choice in the plugin settings wins.
// 2. Otherwise Obsidian's language (getLanguage()), when it is not English.
// 3. Otherwise the OS language. getLanguage() also answers "en" when no
//    language was ever chosen — Obsidian does not follow the system — so a
//    Portuguese macOS with an untouched Obsidian still gets Portuguese. Anyone
//    who wants English there picks it in the plugin settings.

import { getLanguage } from "obsidian";

import { localeFromLanguage, type Locale } from "../core/i18n";
import type { LanguagePreference } from "../core/types";

export function detectLocale(preference: LanguagePreference = "auto"): Locale {
	if (preference !== "auto") return preference;
	const obsidian = getLanguage();
	return obsidian.toLowerCase().startsWith("en") ? localeFromLanguage(systemLanguage()) : localeFromLanguage(obsidian);
}

function systemLanguage(): string | null {
	try {
		return window.navigator.languages?.[0] ?? window.navigator.language ?? null;
	} catch {
		return null;
	}
}
