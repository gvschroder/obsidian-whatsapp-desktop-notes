import { describe, expect, it } from "vitest";

import { isPeriodNoteName, layoutOf, notePath, periodKey, periodOf, runsByPeriod, weekOf } from "../../src/core/periods";

describe("periodKey", () => {
	it("maps a day to its year, month, week or itself; one note per chat has no period", () => {
		expect(periodKey("2026-11-18", "single")).toBe("");
		expect(periodKey("2026-11-18", "year")).toBe("2026");
		expect(periodKey("2026-11-18", "month")).toBe("2026-11");
		expect(periodKey("2026-11-18", "week")).toBe("2026-11-16--2026-11-22");
		expect(periodKey("2026-11-18", "day")).toBe("2026-11-18");
	});

	it("weeks run Monday to Sunday, across months and years", () => {
		expect(weekOf("2026-11-16")).toBe("2026-11-16--2026-11-22"); // Monday
		expect(weekOf("2026-11-22")).toBe("2026-11-16--2026-11-22"); // Sunday
		expect(weekOf("2026-11-23")).toBe("2026-11-23--2026-11-29");
		expect(weekOf("2026-04-02")).toBe("2026-03-30--2026-04-05");
		expect(weekOf("2027-01-01")).toBe("2026-12-28--2027-01-03");
		expect(weekOf("2024-02-29")).toBe("2024-02-26--2024-03-03"); // leap day
	});

	it("period keys sort chronologically as text", () => {
		const days = ["2026-12-31", "2027-01-04", "2026-03-10", "2026-03-16", "2026-12-28"];
		for (const grouping of ["year", "month", "week", "day"] as const) {
			const keys = days.map((d) => periodKey(d, grouping));
			const inTimeOrder = [...days].sort().map((d) => periodKey(d, grouping));
			expect([...keys].sort()).toEqual(inTimeOrder);
		}
	});
});

describe("periodOf", () => {
	it("gives each key's kind and first and last days", () => {
		expect(periodOf("2026")).toEqual({ type: "year", start: "2026-01-01", end: "2026-12-31" });
		expect(periodOf("2026-02")).toEqual({ type: "month", start: "2026-02-01", end: "2026-02-28" });
		expect(periodOf("2024-02")).toEqual({ type: "month", start: "2024-02-01", end: "2024-02-29" });
		expect(periodOf("2026-12")).toEqual({ type: "month", start: "2026-12-01", end: "2026-12-31" });
		expect(periodOf("2026-12-28--2027-01-03")).toEqual({ type: "week", start: "2026-12-28", end: "2027-01-03" });
		expect(periodOf("2026-03-10")).toEqual({ type: "day", start: "2026-03-10", end: "2026-03-10" });
	});

	it("round-trips every key periodKey makes", () => {
		for (const grouping of ["year", "month", "week", "day"] as const) {
			const { type, start, end } = periodOf(periodKey("2026-03-10", grouping));
			expect(type).toBe(grouping);
			expect(start <= "2026-03-10" && "2026-03-10" <= end).toBe(true);
			expect(periodKey(start, grouping)).toBe(periodKey(end, grouping));
		}
	});
});

describe("isPeriodNoteName", () => {
	it("accepts only the names the grouping gives its periods", () => {
		expect(isPeriodNoteName("2026", "year")).toBe(true);
		expect(isPeriodNoteName("2026-03", "month")).toBe(true);
		expect(isPeriodNoteName("2026-03-09--2026-03-15", "week")).toBe(true);
		expect(isPeriodNoteName("2026-03-10", "day")).toBe(true);
		expect(isPeriodNoteName("2026-W11", "week")).toBe(false); // an older version's week
		expect(isPeriodNoteName("2026-03-10--2026-03-16", "week")).toBe(false); // not Monday to Sunday
		expect(isPeriodNoteName("2026-03", "week")).toBe(false); // another grouping's period
		expect(isPeriodNoteName("2026-13", "month")).toBe(false);
		expect(isPeriodNoteName("Resumo", "month")).toBe(false);
		expect(isPeriodNoteName("2026-03", "single")).toBe(false);
	});
});

describe("layouts", () => {
	it("one note per chat lives at <base>.md; periods at <base>/<period>.md", () => {
		expect(notePath({ grouping: "single", base: "W/G/Chat" }, "")).toBe("W/G/Chat.md");
		expect(notePath({ grouping: "month", base: "W/G/Chat" }, "2026-11")).toBe("W/G/Chat/2026-11.md");
	});

	it("recovers the layout from a stored note path", () => {
		expect(layoutOf({ grouping: "single", transcriptPath: "W/G/Chat.md" })).toEqual({ grouping: "single", base: "W/G/Chat" });
		expect(layoutOf({ grouping: "day", transcriptPath: "W/G/Chat/2026-11-18.md" })).toEqual({ grouping: "day", base: "W/G/Chat" });
	});

	it("splits items into consecutive runs of one period", () => {
		const days = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-10-30"];
		expect(runsByPeriod(days, (d) => d, "month")).toEqual([
			{ key: "2026-10", items: ["2026-10-31"] },
			{ key: "2026-11", items: ["2026-11-01", "2026-11-02"] },
			{ key: "2026-10", items: ["2026-10-30"] },
		]);
		expect(runsByPeriod(days, (d) => d, "single")).toEqual([{ key: "", items: days }]);
	});
});
