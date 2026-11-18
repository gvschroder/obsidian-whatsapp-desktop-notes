import { describe, expect, it } from "vitest";

import { validateVaultFolder } from "../../src/core/validation";

describe("validateVaultFolder", () => {
	it.each([
		["WhatsApp", "WhatsApp"],
		["  /Arquivo//WhatsApp/ ", "Arquivo/WhatsApp"],
		["a\\b", "a/b"],
		["", ""],
		["Conversas 2026", "Conversas 2026"],
	])("accepts %j as %j", (input, value) => {
		expect(validateVaultFolder(input)).toEqual({ ok: true, value });
	});

	it.each(["..", "../fora", "a/../b", "./a", "a/ /b", "a:b", "a*b", 'a"b', "a|b", "a<b>"])("rejects %j", (input) => {
		expect(validateVaultFolder(input).ok).toBe(false);
	});
});
