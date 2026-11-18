// The settings screen shows one control per decision; the stored settings
// keep the finer-grained fields the sync engine reads. These pure functions
// translate between the two, so the UI can never produce a contradictory
// combination (for example "only chosen chats" with groups switched off).

import type { ChatFilterMode, UserSettings } from "./types";

/** Which chats to sync, as one choice. */
export type ScopeChoice = "all" | "groups" | "personal" | "include" | "exclude";

type ScopeFields = Pick<UserSettings, "includeGroupChats" | "includeDirectChats" | "chatFilterMode">;

export function scopeChoice(s: ScopeFields): ScopeChoice {
	if (s.chatFilterMode !== "all") return s.chatFilterMode;
	if (s.includeGroupChats && !s.includeDirectChats) return "groups";
	if (!s.includeGroupChats && s.includeDirectChats) return "personal";
	return "all";
}

export function applyScopeChoice(choice: ScopeChoice): ScopeFields {
	const both = (chatFilterMode: ChatFilterMode): ScopeFields => ({ includeGroupChats: true, includeDirectChats: true, chatFilterMode });
	if (choice === "groups") return { includeGroupChats: true, includeDirectChats: false, chatFilterMode: "all" };
	if (choice === "personal") return { includeGroupChats: false, includeDirectChats: true, chatFilterMode: "all" };
	return both(choice === "all" ? "all" : choice);
}

/** True when the choice syncs a hand-picked list of chats. */
export function usesChatList(choice: ScopeChoice): choice is "include" | "exclude" {
	return choice === "include" || choice === "exclude";
}

/** How far back to read, as one choice. */
export type PeriodChoice = "7" | "30" | "90" | "365" | "all" | "custom";

export const PERIOD_PRESETS = [7, 30, 90, 365] as const;

type PeriodFields = Pick<UserSettings, "periodDays">;

export function periodChoice(s: PeriodFields): PeriodChoice {
	if (s.periodDays === 0) return "all";
	return (PERIOD_PRESETS as readonly number[]).includes(s.periodDays) ? (String(s.periodDays) as PeriodChoice) : "custom";
}

export function applyPeriodChoice(choice: Exclude<PeriodChoice, "custom">): PeriodFields {
	return { periodDays: choice === "all" ? 0 : Number(choice) };
}

/** Auto-sync frequencies offered, in minutes (0 = off). */
export const INTERVAL_PRESETS = [0, 15, 30, 60, 120, 240] as const;

/** The presets plus the current value when it is not one of them. */
export function intervalOptions(current: number): number[] {
	const presets: number[] = [...INTERVAL_PRESETS];
	return presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
}
