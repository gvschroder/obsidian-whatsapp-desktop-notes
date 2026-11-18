// Which note of a chat a day belongs to, and the note's path. Pure.
//
// A period is always made of whole days, so a day — and its "## YYYY-MM-DD"
// header — never spans two notes. Period keys say which days they cover
// without any calendar knowledge, and sort chronologically as text:
//   year "2026" · month "2026-03" · week "2026-03-09--2026-03-15" · day "2026-03-10"
// A week runs Monday to Sunday; its key is an ISO 8601 interval ("start--end").

import type { NoteGrouping } from "./types";

const DAY_MS = 86_400_000;

function utc(day: string): number {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return Date.UTC(y, m - 1, d);
}

function isoDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday-to-Sunday week of a YYYY-MM-DD day: "2026-03-09--2026-03-15". */
export function weekOf(day: string): string {
	const date = utc(day);
	const monday = date - ((new Date(date).getUTCDay() + 6) % 7) * DAY_MS;
	return `${isoDay(monday)}--${isoDay(monday + 6 * DAY_MS)}`;
}

/** The period a YYYY-MM-DD day falls in ("" for one note per chat). */
export function periodKey(day: string, grouping: NoteGrouping): string {
	switch (grouping) {
		case "single":
			return "";
		case "year":
			return day.slice(0, 4);
		case "month":
			return day.slice(0, 7);
		case "week":
			return weekOf(day);
		case "day":
			return day;
	}
}

/** What a period key covers: its kind and first and last days (YYYY-MM-DD). */
export interface Period {
	type: Exclude<NoteGrouping, "single">;
	start: string;
	end: string;
}

/** The period a key names (keys of each kind have a distinct shape). */
export function periodOf(key: string): Period {
	if (key.includes("--")) {
		const [start, end] = key.split("--") as [string, string];
		return { type: "week", start, end };
	}
	if (key.length === 4) return { type: "year", start: `${key}-01-01`, end: `${key}-12-31` };
	if (key.length === 7) {
		const [y, m] = key.split("-").map(Number) as [number, number];
		return { type: "month", start: `${key}-01`, end: isoDay(Date.UTC(y, m, 0)) };
	}
	return { type: "day", start: key, end: key };
}

const KEY_SHAPE = /^\d{4}(-\d{2}(-\d{2}(--\d{4}-\d{2}-\d{2})?)?)?$/;

/**
 * Whether a note's file name (without ".md") is the name `grouping` gives a
 * period — e.g. not a week named the old "2026-W47" way, or a month note left
 * in a folder now split by week.
 */
export function isPeriodNoteName(name: string, grouping: NoteGrouping): boolean {
	if (grouping === "single" || !KEY_SHAPE.test(name)) return false;
	const { type, start } = periodOf(name);
	return type === grouping && isoDay(utc(start)) === start && periodKey(start, grouping) === name;
}

/**
 * Where a chat's notes live. `base` is the note without ".md" for one note per
 * chat, or the chat's folder for a period layout.
 */
export interface ChatLayout {
	grouping: NoteGrouping;
	base: string;
}

/** The note holding a period ("" for one note per chat). */
export function notePath(layout: ChatLayout, key: string): string {
	return layout.grouping === "single" ? `${layout.base}.md` : `${layout.base}/${key}.md`;
}

/** The layout a stored chat is in, from its note path. */
export function layoutOf(chat: { grouping: NoteGrouping; transcriptPath: string }): ChatLayout {
	const base =
		chat.grouping === "single" ? chat.transcriptPath.replace(/\.md$/, "") : chat.transcriptPath.split("/").slice(0, -1).join("/");
	return { grouping: chat.grouping, base };
}

/** Consecutive runs of items in the same period, in their original order. */
export function runsByPeriod<T>(items: T[], dayOf: (item: T) => string, grouping: NoteGrouping): { key: string; items: T[] }[] {
	const runs: { key: string; items: T[] }[] = [];
	for (const item of items) {
		const key = periodKey(dayOf(item), grouping);
		const last = runs[runs.length - 1];
		if (last && last.key === key) last.items.push(item);
		else runs.push({ key, items: [item] });
	}
	return runs;
}

/** Calendar parts of a YYYY-MM-DD day: month 1–12, weekday 0 = Sunday. */
export function dayParts(day: string): { year: number; month: number; day: number; weekday: number } {
	const [year, month, d] = day.split("-").map(Number) as [number, number, number];
	return { year, month, day: d, weekday: new Date(utc(day)).getUTCDay() };
}
