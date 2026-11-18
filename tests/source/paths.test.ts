import { afterEach, describe, expect, it } from "vitest";

import { contactsStoragePath, defaultChatStoragePaths, findChatStorage } from "../../src/source/paths";
import { setMacOS } from "../../src/core/platform";

afterEach(() => setMacOS(true));

describe("database path resolution", () => {
	it("defaults to WhatsApp's macOS group container, and nothing on other systems", () => {
		expect(defaultChatStoragePaths()).toEqual([expect.stringMatching(/\/Library\/Group Containers\/group\.net\.whatsapp\.WhatsApp\.shared\/ChatStorage\.sqlite$/)]);
		setMacOS(false);
		expect(defaultChatStoragePaths()).toEqual([]);
		expect(findChatStorage("")).toBeNull();
	});

	it("an explicit override wins, trimmed, on any system", () => {
		expect(findChatStorage("  /data/ChatStorage.sqlite  ")).toBe("/data/ChatStorage.sqlite");
		setMacOS(false);
		expect(findChatStorage("/data/ChatStorage.sqlite")).toBe("/data/ChatStorage.sqlite");
	});

	it("uses the default location when there is no override", () => {
		expect(findChatStorage("   ")).toBe(defaultChatStoragePaths()[0]);
	});

	it("looks for ContactsV2.sqlite beside ChatStorage.sqlite", () => {
		expect(contactsStoragePath("/a/b/ChatStorage.sqlite")).toBe("/a/b/ContactsV2.sqlite");
		expect(contactsStoragePath("ChatStorage.sqlite")).toBe("./ContactsV2.sqlite");
	});
});
