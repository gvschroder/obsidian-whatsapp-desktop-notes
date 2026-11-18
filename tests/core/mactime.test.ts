import { describe, expect, it } from "vitest";

import { coreDataTimeToDate, dateToCoreDataTime } from "../../src/core/mactime";

describe("Mac absolute time", () => {
	it("0 is 2001-01-01T00:00:00Z", () => {
		expect(coreDataTimeToDate(0).toISOString()).toBe("2001-01-01T00:00:00.000Z");
	});

	it("converts a known instant", () => {
		expect(dateToCoreDataTime(new Date("2026-03-10T12:00:00Z"))).toBe(794836800);
	});

	it("round-trips, including fractional seconds", () => {
		const d = new Date("2026-11-17T19:33:12.250Z");
		expect(coreDataTimeToDate(dateToCoreDataTime(d)).getTime()).toBe(d.getTime());
	});

	it("handles instants before the Mac epoch", () => {
		expect(coreDataTimeToDate(-86_400).toISOString()).toBe("2000-12-31T00:00:00.000Z");
	});
});
