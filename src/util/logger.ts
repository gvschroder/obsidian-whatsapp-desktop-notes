// Console output for the plugin. Following Obsidian's plugin guidelines, the
// console only shows problems by default; step-by-step detail (`log.step`,
// `log.detail`) is written with console.debug, and only while "Verbose
// logging" is on. The status bar always shows sync progress.

const TAG = "[wa-desktop-notes]";

let verbose = false;

/** Text for something thrown that is not an Error (a string, an object…). */
function asText(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

export const log = {
	/** Turn the step-by-step output on or off (the "Verbose logging" setting). */
	setVerbose(enabled: boolean): void {
		verbose = enabled;
	},

	/** A milestone of a sync: start, totals, per-chat counts. Verbose only. */
	step(message: string): void {
		if (verbose) console.debug(TAG, message);
	},

	/** Fine-grained detail: per row, per lookup. Verbose only. */
	detail(message: string): void {
		if (verbose) console.debug(TAG, message);
	},

	/** Something went wrong but the work continued. Always shown. */
	warning(message: string): void {
		console.warn(TAG, message);
	},

	/** A failed operation, with its cause. Always shown. */
	failure(message: string, cause?: unknown): void {
		if (cause === undefined) console.error(TAG, message);
		else console.error(TAG, message, cause instanceof Error ? cause : new Error(asText(cause)));
	},
};
