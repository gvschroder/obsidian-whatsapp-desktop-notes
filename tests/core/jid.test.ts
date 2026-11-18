import { describe, expect, it } from "vitest";

import { classifyChat, isChatOnlyJid, jidFallbackLabel, isOpaqueToken } from "../../src/core/jid";

describe("jidFallbackLabel", () => {
	it("turns a phone-number JID into +digits", () => {
		expect(jidFallbackLabel("5511988887777@s.whatsapp.net")).toBe("+5511988887777");
	});

	it("never exposes a raw @lid; uses a stable Member-<hash> instead", () => {
		const a = jidFallbackLabel("333333333333333@lid");
		expect(a).toBe("Member-1uyzqlg");
		expect(jidFallbackLabel("333333333333333@lid")).toBe(a);
		expect(a).not.toContain("333333333333333");
	});

	it("treats an unknown suffix with a bare number as a phone", () => {
		expect(jidFallbackLabel("5511912345678@c.us")).toBe("+5511912345678");
	});

	it("hashes an unknown non-numeric local part", () => {
		expect(jidFallbackLabel("abc@example")).toMatch(/^Member-[0-9a-z]+$/);
	});

	it("returns null for empty / missing input", () => {
		expect(jidFallbackLabel(null)).toBeNull();
		expect(jidFallbackLabel("")).toBeNull();
		expect(jidFallbackLabel("@lid")).toBeNull();
	});
});

describe("isOpaqueToken", () => {
	it.each([
		["QUJDREVGR0hJSktMTU5PUA==", true], // base64 padding
		["abc=", true],
		["AbCdEfGhIjKlMnOpQr", true], // long space-free run
		["5511999990001", true], // no letters
		["", true],
		["   ", true],
		["Carla ⚡", false],
		["Bruno Lima", false],
		["Ana", false],
	])("isOpaqueToken(%j) === %s", (value, expected) => {
		expect(isOpaqueToken(value)).toBe(expected);
	});
});

describe("classifyChat / isChatOnlyJid", () => {
	it.each([
		["120363000000000001@g.us", "group"],
		["5511999990001@s.whatsapp.net", "personal"],
		["111111111111111@lid", "personal"],
		["status@broadcast", null],
		["1234@broadcast", null],
	])("classifyChat(%j) === %j", (jid, expected) => {
		expect(classifyChat(jid)).toBe(expected);
	});

	it("flags group and broadcast JIDs as chat-only (never a sender)", () => {
		expect(isChatOnlyJid("120363000000000001@g.us")).toBe(true);
		expect(isChatOnlyJid("status@broadcast")).toBe(true);
		expect(isChatOnlyJid("5511999990001@s.whatsapp.net")).toBe(false);
		expect(isChatOnlyJid("111111111111111@lid")).toBe(false);
	});
});
