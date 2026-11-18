// Text → Markdown/YAML/file-name conversions for notes. Pure.
//
// Everything a third party controls (message text, chat names, sender names)
// passes through here before it reaches the vault.

/** Make a string safe for use inside a vault file name. */
export function toSafeFileName(name: string): string {
	return (
		name
			// characters illegal in file names or that break wiki-links
			.replace(/[[\]#^|<>"?*:\\/]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 80) || "chat"
	);
}

const YAML_NAMED_ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/** Escape a value for safe use inside a double-quoted YAML scalar. */
export function toYamlString(value: string): string {
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		// Control characters (and U+2028/2029, which YAML treats as line breaks)
		// would break or reshape the frontmatter; emit them as YAML escapes.
		// eslint-disable-next-line no-control-regex -- matching control characters is the point here
		.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (c) => YAML_NAMED_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
	return `"${escaped}"`;
}

/** Collapse all whitespace (including newlines) to single spaces. */
export function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

// Markdown/Obsidian syntax characters escaped wherever they appear:
//   \ ` * _ [ ] # | ~ = $ % ^
// covers code spans/fences and inline (Dataview)JS, emphasis, links, embeds
// and wiki-links, tags and headings, tables, strikethrough and ~~~ fences,
// highlights and setext headings, math, %% comments and ^block-ids.
const MD_SPECIAL = /[\\`*_[\]#|~=$%^]/g;
// Stops at characters that could start Obsidian syntax even inside an
// autolink (wiki-link brackets, pipes, backticks, quotes, backslashes); the
// remainder is escaped normally.
const URL_RE = /https?:\/\/[^\s<>[\]|`"\\]+/g;
const URL_TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/;

function escapeSegment(text: string): string {
	return (
		text
			.replace(MD_SPECIAL, (c) => `\\${c}`)
			// HTML (img/iframe/…) and Templater tags render as plain text.
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			// Dataview inline fields ("key:: value").
			.replace(/::/g, "\\:\\:")
	);
}

/**
 * Make third-party text (message bodies, chat and sender names) render as
 * literal text in Obsidian. Prevents a sender from injecting embeds, remote
 * images or iframes (which make Obsidian fetch URLs), wiki-links, tags,
 * Dataview fields and code blocks that plugins like DataviewJS would execute.
 *
 * Bare http(s) URLs become CommonMark autolinks (`<https://…>`): still
 * clickable, never loaded automatically, and their characters are not escaped.
 */
export function escapeMarkdown(text: string): string {
	const normalized = text.replace(/\r\n?/g, "\n");
	let out = "";
	let last = 0;
	for (const match of normalized.matchAll(URL_RE)) {
		const start = match.index ?? 0;
		const raw = match[0];
		const url = raw.replace(URL_TRAILING_PUNCTUATION, "");
		out += escapeSegment(normalized.slice(last, start)) + `<${url}>`;
		last = start + url.length;
	}
	out += escapeSegment(normalized.slice(last));
	// Block markers only matter at the start of a line: list bullets and
	// ordered-list numbers (everything else is escaped above). The first line is
	// never at a line start — it always follows "**HH:MM** — sender: " or "# " —
	// so only lines after a newline need it.
	return out.replace(/\n([ \t]*)([-+])/g, "\n$1\\$2").replace(/\n([ \t]*\d+)([.)])/g, "\n$1\\$2");
}

/** Alias text for a `[[path|alias]]` wiki-link: brackets and pipes would end the link early. */
export function linkAlias(name: string): string {
	return singleLine(name).replace(/\[/g, "(").replace(/\]/g, ")").replace(/\|/g, "-") || "chat";
}
