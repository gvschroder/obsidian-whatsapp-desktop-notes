// Interface language. Pure: the caller (main.ts) reads Obsidian's language
// once at load and calls setLocale; everything else reads strings via t().
// Obsidian restarts when its language changes, so no live switching is needed.

import { en, type Messages } from "./en";
import { pt } from "./pt";

/** Prefix of every notice the plugin shows: its name. */
export const NOTICE_PREFIX = "WhatsApp Desktop (macOS): ";

export type Locale = "en" | "pt";
export type { Messages };

const DICTIONARIES: Record<Locale, Messages> = { en, pt };

let current: Locale = "en";

/** Map an Obsidian language code ("en", "pt", "pt-BR", "zh-TW"…) to a supported locale. */
export function localeFromLanguage(code: string | null | undefined): Locale {
	return (code ?? "").toLowerCase().startsWith("pt") ? "pt" : "en";
}

export function setLocale(locale: Locale): void {
	current = locale;
}

/** The strings for the current locale. */
export function t(): Messages {
	return DICTIONARIES[current];
}
