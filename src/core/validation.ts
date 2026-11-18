// Settings input validation. Pure. Each validator returns
// the cleaned value to store, or an error message to show next to the field.

import { t } from "./i18n";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const ILLEGAL_PATH_CHARS = /[:*?"<>|]/;

/**
 * A folder path inside the vault. Separators are normalized and leading /
 * trailing slashes dropped; "." / ".." segments and characters that are
 * illegal in file names are rejected, so a setting can never point outside
 * the vault or produce an unusable path. Empty is allowed (caller decides what
 * it means: default root, or "directly under the root").
 */
export function validateVaultFolder(input: string): Validated<string> {
	const value = input.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
	if (value === "") return { ok: true, value };
	const segments = value.split("/");
	if (segments.some((s) => s === "." || s === "..")) {
		return { ok: false, error: t().validation.dotSegments };
	}
	if (segments.some((s) => s.trim() === "")) {
		return { ok: false, error: t().validation.blankSegment };
	}
	if (ILLEGAL_PATH_CHARS.test(value)) {
		return { ok: false, error: t().validation.illegalChars };
	}
	return { ok: true, value };
}
