// Decides HOW notes look: transcript header, message lines with day headers,
// and the conversation index. Pure — output is a string; the caller writes it.

import { escapeMarkdown, linkAlias, singleLine, toYamlString } from "./markdown";
import { yamlList } from "./frontmatter";
import { renderMedia } from "./media";
import { coreDataTimeToDate } from "./mactime";
import { t } from "./i18n";
import type { ChatGroup } from "./planner";
import type { ChatKind, ChatSyncRecord, ChatStorageMessage } from "./types";

/** What the index needs to list a chat (synced or imported). */
export type IndexEntry = Pick<ChatSyncRecord, "name" | "kind" | "transcriptPath" | "messageTotal" | "lastMessageAtIso">;

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

/** Frontmatter + "# title" written once, when a transcript note is created. */
export function transcriptHeader(name: string, jid: string, kind: ChatKind, participants: string[]): string {
	return (
		`---\n` +
		`source: whatsapp-desktop\n` +
		`whatsapp_jid: ${toYamlString(jid)}\n` +
		`whatsapp_chat: ${toYamlString(name)}\n` +
		`chat_type: ${kind}\n` +
		yamlList("participants", participants) +
		`---\n\n` +
		`# ${escapeMarkdown(singleLine(name))}\n`
	);
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
	let at = 0;
	if (content.startsWith("---\n")) {
		const end = content.indexOf("\n---\n", 4);
		if (end !== -1) at = end + 5;
	}
	const title = /^# .*$/m.exec(content.slice(at));
	if (title) at += title.index + title[0].length + 1;
	let rest = content.slice(at);
	const sameDay = `\n## ${olderLastDay}\n\n`;
	if (olderLastDay && rest.startsWith(sameDay)) rest = rest.slice(sameDay.length);
	return content.slice(0, at) + olderBody + rest;
}


/** The conversation index note, newest activity first, split by kind. */
export function renderIndex(entries: IndexEntry[], title: string): string {
	const all = [...entries].sort((a, b) => b.lastMessageAtIso.localeCompare(a.lastMessageAtIso));
	const [groups, personal] = (["group", "personal"] as const).map((kind) => all.filter((entry) => entry.kind === kind)) as [
		IndexEntry[],
		IndexEntry[],
	];

	const m = t().notes;
	const line = (c: IndexEntry): string => {
		const link = c.transcriptPath.replace(/\.md$/, "");
		const when = c.lastMessageAtIso ? c.lastMessageAtIso.slice(0, 10) : "";
		return `- [[${link}|${linkAlias(c.name)}]] — ${m.indexMessages(c.messageTotal)} · ${when}`;
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
