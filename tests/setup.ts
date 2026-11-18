import { afterEach, beforeEach, vi } from "vitest";

// Plugin code uses window.setTimeout (popout-window safe, per the Obsidian
// guidelines); under Node the global object stands in for window.
(globalThis as { window?: unknown }).window ??= globalThis;

// The plugin logs progress through console.log/warn. Silence it in
// tests so the runner output stays readable; individual tests can still assert
// on the spies when log behaviour matters.
beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});
