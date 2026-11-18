// Decides HOW notes look: transcript header, message lines with day headers,
// and the conversation index. Pure — output is a string; the caller writes it.

import { escapeMarkdown, linkAlias, singleLine, toYamlString } from "./markdown";
import { yamlList } from "./frontmatter";
import { renderMedia } from "./media";
import { coreDataTimeToDate } from "./mactime";
import { t } from "./i18n";
import { periodOf } from "./periods";
import type { ChatGroup } from "./planner";
import type { ChatKind, ChatSyncRecord, ChatStorageMessage } from "./types";

/**
 * What the index needs to list a chat. `periods` are the paths of the chat's
 * period notes, when it is split by period.
 */
export type IndexEntry = Pick<ChatSyncRecord, "name" | "kind" | "transcriptPath" | "messageTotal" | "lastMessageAtIso"> & {
	periods?: string[];
};

function padTwo(n: number): string {
	return String(n).padStart(2, "0");
}

/** Local-time YYYY-MM-DD. */
export function formatLocalDate(d: Date): string {
	return `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
}

/** Local-time HH:MM. */
export function formatLocalTime(d: Date): string {
	return `${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
}

/** Sender label before escaping. */
export function speakerName(
	msg: ChatStorageMessage,
	chat: Pick<ChatGroup, "jid" | "kind" | "name"> & { named?: boolean },
	selfDisplayName: string,
): string {
	if (msg.isFromMe) return selfDisplayName;
	// 1:1 chats label the other person with the chat's own title (WhatsApp's
	// partner name), so the transcript matches its "# heading". When the chat
	// has no partner name, fall back to the resolved sender: saved contact name
	// or phone number.
	const named = chat.named ?? chat.name !== chat.jid;
	if (chat.kind === "personal" && named) return chat.name;
	const resolved = msg.sender?.trim();
	if (resolved) return resolved;
	return chat.kind === "personal" ? chat.name : t().notes.unknownSender;
}

/**
 * Frontmatter + "# title" written once, when a transcript note is created.
 * `period` (a period key, e.g. "2026-11") marks one note of a chat split by
 * period: the frontmatter says which days it covers, as dates, and the title
 * names the period in words.
 */
export function transcriptHeader(name: string, jid: string, kind: ChatKind, participants: string[], period = ""): string {
	const title = escapeMarkdown(singleLine(name));
	const covers = period ? periodOf(period) : null;
	return (
		`---\n` +
		`source: whatsapp-desktop\n` +
		`whatsapp_jid: ${toYamlString(jid)}\n` +
		`whatsapp_chat: ${toYamlString(name)}\n` +
		(covers
			? `whatsapp_period: ${toYamlString(period)}\n` +
				`whatsapp_period_type: ${covers.type}\n` +
				`whatsapp_period_start: ${covers.start}\n` +
				`whatsapp_period_end: ${covers.end}\n`
			: "") +
		`chat_type: ${kind}\n` +
		yamlList("participants", participants) +
		`---\n\n` +
		`# ${covers ? `${title} · ${t().notes.periodTitle(covers)}` : title}\n`
	);
}

/** Where a note's body starts: after its frontmatter and "# title" line. */
function headerEnd(content: string): number {
	let at = 0;
	if (content.startsWith("---\n")) {
		const end = content.indexOf("\n---\n", 4);
		if (end !== -1) at = end + 5;
	}
	const title = /^# .*$/m.exec(content.slice(at));
	if (title) at += title.index + title[0].length + 1;
	return at;
}

/** A note's frontmatter and "# title" line, as written (properties added by hand included). */
export function noteHeader(content: string): string {
	return content.slice(0, headerEnd(content));
}

/** How many messages a piece of a note holds (each starts with a "**HH:MM** — " line). */
export function countMessages(text: string): number {
	return text.match(/^\*\*\d{2}:\d{2}\*\* — /gm)?.length ?? 0;
}

/** One day of a note: its "## YYYY-MM-DD" header and everything up to the next day. */
export interface DaySection {
	day: string;
	/** "\n## YYYY-MM-DD\n\n…", exactly as in the note. */
	text: string;
}

const DAY_HEADER = /^## (\d{4}-\d{2}-\d{2})[ \t]*$/gm;

/**
 * A note's body, cut losslessly: the text before its first day (normally
 * empty, but it can hold what the user wrote there) and its day sections in
 * note order. `preamble + texts` gives the body back unchanged.
 */
export function splitNote(content: string): { preamble: string; sections: DaySection[] } {
	const body = content.slice(headerEnd(content));
	const starts = [...body.matchAll(DAY_HEADER)].map((m) => {
		const at = m.index ?? 0;
		// The blank line before a day header belongs to that day.
		return { at: at > 0 && body[at - 1] === "\n" ? at - 1 : at, day: m[1] ?? "" };
	});
	const sections = starts.map((s, i) => ({ day: s.day, text: body.slice(s.at, starts[i + 1]?.at ?? body.length) }));
	return { preamble: body.slice(0, starts[0]?.at ?? body.length), sections };
}

/** A note body from a preamble and day sections (possibly from several notes). */
export function joinSections(preamble: string, sections: DaySection[]): string {
	const last = sections.length - 1;
	// A note may end without a line break; the next day still needs its own line.
	return preamble + sections.map((s, i) => (i < last && !s.text.endsWith("\n") ? `${s.text}\n` : s.text)).join("");
}

export interface RenderedMessages {
	body: string;
	/** Day of the last header in the note after this append. */
	lastDay: string;
	/** Highest Z_PK rendered (the new cursor). */
	maxPk: number;
	/** ISO timestamp of the last message rendered. */
	lastMessageAtIso: string;
}

/**
 * Render new messages (oldest first) as transcript lines, emitting a
 * `## YYYY-MM-DD` header whenever the local day changes. `lastDay` is the day
 * of the last header already in the note ("" for a note being created).
 */
export function renderMessages(
	fresh: ChatStorageMessage[],
	chat: Pick<ChatGroup, "jid" | "kind" | "name"> & { named?: boolean },
	selfDisplayName: string,
	start: { lastDay: string; lastPk: number; lastMessageAtIso: string },
): RenderedMessages {
	let { lastDay } = start;
	let maxPk = start.lastPk;
	let lastMessageAtIso = start.lastMessageAtIso;
	const parts: string[] = [];
	for (const m of fresh) {
		const sentAt = coreDataTimeToDate(m.coreDataTime);
		const day = formatLocalDate(sentAt);
		if (day !== lastDay) parts.push(`\n## ${day}\n\n`);
		lastDay = day;
		const speaker = escapeMarkdown(singleLine(speakerName(m, chat, selfDisplayName)));
		const content = m.media ? renderMedia(m.media, m.text) : escapeMarkdown(m.text);
		parts.push(`**${formatLocalTime(sentAt)}** — ${speaker}: ${content}\n\n`);
		maxPk = Math.max(maxPk, m.zPk);
		lastMessageAtIso = sentAt.toISOString();
	}
	return { body: parts.join(""), lastDay, maxPk, lastMessageAtIso };
}

/**
 * Insert older messages at the top of a transcript, right after its header
 * (frontmatter and "# title"), keeping everything below untouched — including
 * text the user added. When the older batch ends on the day the note starts
 * with, that day's header is not repeated.
 */
export function insertOlderMessages(content: string, olderBody: string, olderLastDay: string): string {
	const at = headerEnd(content);
	let rest = content.slice(at);
	const sameDay = `\n## ${olderLastDay}\n\n`;
	if (olderLastDay && rest.startsWith(sameDay)) rest = rest.slice(sameDay.length);
	return content.slice(0, at) + olderBody + rest;
}


/**
 * The conversation index note, newest activity first, split by kind. A chat
 * split by period lists its notes under it, newest first, named in words.
 */
export function renderIndex(entries: IndexEntry[], title: string): string {
	const all = [...entries].sort((a, b) => b.lastMessageAtIso.localeCompare(a.lastMessageAtIso));
	const [groups, personal] = (["group", "personal"] as const).map((kind) => all.filter((entry) => entry.kind === kind)) as [
		IndexEntry[],
		IndexEntry[],
	];

	const m = t().notes;
	const link = (path: string, alias: string): string => `[[${path.replace(/\.md$/, "")}|${linkAlias(alias)}]]`;
	const line = (c: IndexEntry): string => {
		const when = c.lastMessageAtIso ? formatLocalDate(new Date(c.lastMessageAtIso)) : "";
		const periods = [...(c.periods ?? [])]
			.sort()
			.reverse()
			.map((path) => `\n\t- ${link(path, m.periodTitle(periodOf((path.split("/").pop() ?? "").replace(/\.md$/, ""))))}`);
		return `- ${link(c.transcriptPath, c.name)} — ${m.indexMessages(c.messageTotal)} · ${when}${periods.join("")}`;
	};

	let md = `# ${escapeMarkdown(singleLine(title))}\n\n`;
	md += `${m.indexIntro(all.length)}\n\n`;
	md += `## ${m.indexPersonal} (${personal.length})\n\n`;
	md += personal.length ? personal.map(line).join("\n") : m.indexNone;
	md += `\n\n## ${m.indexGroups} (${groups.length})\n\n`;
	md += groups.length ? groups.map(line).join("\n") : m.indexNone;
	md += "\n";
	return md;
}
