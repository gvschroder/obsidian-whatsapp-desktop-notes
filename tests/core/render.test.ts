import { describe, expect, it } from "vitest";

import {
	formatLocalDate,
	insertOlderMessages,
	joinSections,
	splitNote,
	transcriptHeader,
	renderIndex,
	renderMessages,
	speakerName,
	formatLocalTime,
} from "../../src/core/render";
import { dateToCoreDataTime } from "../../src/core/mactime";
import { setLocale } from "../../src/core/i18n";
import type { ChatSyncRecord, ChatStorageMessage } from "../../src/core/types";

// Runs with TZ=America/Sao_Paulo (UTC−3), set in vitest.config.mts.
const at = (iso: string): number => dateToCoreDataTime(new Date(iso));

function msg(overrides: Partial<ChatStorageMessage>): ChatStorageMessage {
	return { zPk: 1, jid: "g@g.us", chatTitle: "G", sender: null, text: "oi", coreDataTime: at("2026-03-10T12:00:00Z"), isFromMe: false, ...overrides };
}

const group = { jid: "g@g.us", kind: "group" as const, name: "Grupo" };
const personal = { jid: "p@s.whatsapp.net", kind: "personal" as const, name: "Pessoa" };
const unnamed = { jid: "p@s.whatsapp.net", kind: "personal" as const, name: "p@s.whatsapp.net" };

describe("formatLocalDate / formatLocalTime (local time)", () => {
	it("formats in the local time zone", () => {
		const d = new Date("2026-03-11T02:30:00Z"); // 23:30 on the 10th in São Paulo
		expect(formatLocalDate(d)).toBe("2026-03-10");
		expect(formatLocalTime(d)).toBe("23:30");
	});
});

describe("speakerName", () => {
	it("uses the own-name for messages you sent", () => {
		expect(speakerName(msg({ isFromMe: true, sender: "x" }), group, "Eu")).toBe("Eu");
	});

	it("uses the chat title in named 1:1 chats", () => {
		expect(speakerName(msg({ sender: "Agenda" }), personal, "Eu")).toBe("Pessoa");
	});

	it("falls back to the resolved sender in unnamed 1:1 chats, then to the title", () => {
		expect(speakerName(msg({ sender: "+5511" }), unnamed, "Eu")).toBe("+5511");
		expect(speakerName(msg({ sender: null }), unnamed, "Eu")).toBe("p@s.whatsapp.net");
	});

	it("uses the resolved sender in groups, or 'Unknown'", () => {
		expect(speakerName(msg({ sender: "  Bruno  " }), group, "Eu")).toBe("Bruno");
		expect(speakerName(msg({ sender: "   " }), group, "Eu")).toBe("Unknown");
	});
});

describe("transcriptHeader", () => {
	it("writes quoted frontmatter and an escaped single-line title", () => {
		expect(transcriptHeader('A "b"\n#c', "g@g.us", "group", [])).toBe(
			'---\nsource: whatsapp-desktop\nwhatsapp_jid: "g@g.us"\nwhatsapp_chat: "A \\"b\\"\\n#c"\nchat_type: group\nparticipants: []\n---\n\n# A "b" \\#c\n',
		);
	});

	it("lists the participants as a YAML list", () => {
		expect(transcriptHeader("G", "g@g.us", "group", ["Ana", 'Bruno "B"'])).toContain('participants:\n  - "Ana"\n  - "Bruno \\"B\\""\n---');
	});
});

describe("renderMessages", () => {
	it("emits a day header on each local-day change and tracks the cursor", () => {
		const out = renderMessages(
			[
				msg({ zPk: 3, sender: "Ana", text: "um", coreDataTime: at("2026-03-10T12:00:00Z") }),
				msg({ zPk: 9, sender: "Ana", text: "dois", coreDataTime: at("2026-03-11T02:30:00Z") }), // still the 10th locally
				msg({ zPk: 7, isFromMe: true, text: "três", coreDataTime: at("2026-03-11T12:00:00Z") }),
			],
			group,
			"Eu",
			{ lastDay: "", lastPk: 2, lastMessageAtIso: "" },
		);
		expect(out.body).toBe(
			"\n## 2026-03-10\n\n**09:00** — Ana: um\n\n**23:30** — Ana: dois\n\n\n## 2026-03-11\n\n**09:00** — Eu: três\n\n",
		);
		expect(out.lastDay).toBe("2026-03-11");
		expect(out.maxPk).toBe(9);
		expect(out.lastMessageAtIso).toBe("2026-03-11T12:00:00.000Z");
	});

	it("continues an existing day without repeating its header", () => {
		const out = renderMessages([msg({ sender: "Ana" })], group, "Eu", { lastDay: "2026-03-10", lastPk: 0, lastMessageAtIso: "x" });
		expect(out.body).toBe("**09:00** — Ana: oi\n\n");
	});

	it("keeps the previous cursor and activity when there is nothing new", () => {
		expect(renderMessages([], group, "Eu", { lastDay: "d", lastPk: 5, lastMessageAtIso: "t" })).toEqual({
			body: "",
			lastDay: "d",
			maxPk: 5,
			lastMessageAtIso: "t",
		});
	});
});

describe("renderIndex", () => {
	const chat = (o: Partial<ChatSyncRecord> & { periods?: string[] }): ChatSyncRecord & { periods?: string[] } => ({
		jid: "j",
		name: "N",
		kind: "group",
		grouping: "single",
		transcriptPath: "WA/G/N h.md",
		lastMessageZPk: 1,
		lastMessageAtIso: "2026-03-10T12:00:00.000Z",
		lastDayHeading: "2026-03-10",
		messageTotal: 1,
		coveredSinceMac: null,
		participants: [],
		...o,
	});

	it("lists chats newest first, split by kind", () => {
		const md = renderIndex(
			[
				chat({ name: "Antigo [x]", lastMessageAtIso: "2026-01-01T12:00:00.000Z", transcriptPath: "WA/G/Antigo h.md" }),
				chat({ name: "Novo", lastMessageAtIso: "2026-03-01T12:00:00.000Z", transcriptPath: "WA/G/Novo h.md", messageTotal: 3 }),
				chat({ name: "Pessoa", kind: "personal", transcriptPath: "WA/P/Pessoa h.md" }),
			],
			"WA",
		);
		expect(md).toBe(
			"# WA\n\n" +
				"_3 chats · updated on every sync._\n\n" +
				"## Personal chats (1)\n\n- [[WA/P/Pessoa h|Pessoa]] — 1 message · 2026-03-10\n\n" +
				"## Groups (2)\n\n- [[WA/G/Novo h|Novo]] — 3 messages · 2026-03-01\n- [[WA/G/Antigo h|Antigo (x)]] — 1 message · 2026-01-01\n",
		);
	});

	it("dates the last message in local time", () => {
		// 01:30 UTC on the 11th is still the 10th in São Paulo (tests run there).
		expect(renderIndex([chat({ lastMessageAtIso: "2026-03-11T01:30:00.000Z" })], "WA")).toContain("— 1 message · 2026-03-10\n");
	});

	it("lists a chat's period notes under it, newest first, named in words", () => {
		const md = renderIndex(
			[
				chat({
					grouping: "week",
					transcriptPath: "WA/G/N/2026-03-09--2026-03-15.md",
					periods: ["WA/G/N/2026-02-23--2026-03-01.md", "WA/G/N/2026-03-09--2026-03-15.md"],
				}),
			],
			"WA",
		);
		expect(md).toContain(
			"- [[WA/G/N/2026-03-09--2026-03-15|N]] — 1 message · 2026-03-10\n" +
				"\t- [[WA/G/N/2026-03-09--2026-03-15|March 9–15, 2026]]\n" +
				"\t- [[WA/G/N/2026-02-23--2026-03-01|February 23 – March 1, 2026]]\n",
		);
	});

	it("handles an empty state", () => {
		expect(renderIndex([], "WA")).toContain("## Personal chats (0)\n\n_None yet._\n\n## Groups (0)\n\n_None yet._\n");
	});
});

describe("insertOlderMessages", () => {
	const header = '---\nsource: whatsapp\nchat_name: "A"\n---\n\n# A\n';

	it("inserts after the title and does not repeat the shared day header", () => {
		const note = `${header}\n## 2026-03-10\n\n**10:00** — A: novo\n\nnota minha\n`;
		const older = "\n## 2026-03-09\n\n**09:00** — A: velho 1\n\n\n## 2026-03-10\n\n**08:00** — A: velho 2\n\n";
		expect(insertOlderMessages(note, older, "2026-03-10")).toBe(
			`${header}\n## 2026-03-09\n\n**09:00** — A: velho 1\n\n\n## 2026-03-10\n\n**08:00** — A: velho 2\n\n**10:00** — A: novo\n\nnota minha\n`,
		);
	});

	it("keeps the next day's header when the days differ", () => {
		const note = `${header}\n## 2026-03-10\n\n**10:00** — A: novo\n\n`;
		expect(insertOlderMessages(note, "\n## 2026-03-09\n\n**09:00** — A: velho\n\n", "2026-03-09")).toContain(
			"velho\n\n\n## 2026-03-10\n\n**10:00**",
		);
	});

	it("falls back to the top when the header was removed", () => {
		expect(insertOlderMessages("texto", "X\n", "2026-03-09")).toBe("X\ntexto");
		expect(insertOlderMessages("---\na: 1\n---\ncorpo", "X\n", "")).toBe("---\na: 1\n---\nX\ncorpo");
	});
});

describe("period notes", () => {
	it("a period note carries its period in the frontmatter, as dates, and in the title, in words", () => {
		const header = transcriptHeader("G", "g@g.us", "group", [], "2026-03-09--2026-03-15");
		expect(header).toContain(
			'whatsapp_period: "2026-03-09--2026-03-15"\n' +
				"whatsapp_period_type: week\n" +
				"whatsapp_period_start: 2026-03-09\n" +
				"whatsapp_period_end: 2026-03-15\n",
		);
		expect(header.endsWith("# G · March 9–15, 2026\n")).toBe(true);
		expect(transcriptHeader("G", "g@g.us", "group", [])).not.toContain("whatsapp_period");
	});

	it.each([
		["2026", "2026", "2026"],
		["2026-03", "March 2026", "março de 2026"],
		["2026-03-10", "Tuesday, March 10, 2026", "terça, 10 de março de 2026"],
		["2026-03-01", "Sunday, March 1, 2026", "domingo, 1º de março de 2026"],
		["2026-03-09--2026-03-15", "March 9–15, 2026", "9 a 15 de março de 2026"],
		["2026-03-30--2026-04-05", "March 30 – April 5, 2026", "30 de março a 5 de abril de 2026"],
		["2026-12-28--2027-01-03", "December 28, 2026 – January 3, 2027", "28 de dezembro de 2026 a 3 de janeiro de 2027"],
	])("names period %s in words", (key, english, portuguese) => {
		expect(transcriptHeader("G", "g@g.us", "group", [], key)).toContain(`# G · ${english}\n`);
		setLocale("pt");
		try {
			expect(transcriptHeader("G", "g@g.us", "group", [], key)).toContain(`# G · ${portuguese}\n`);
		} finally {
			setLocale("en");
		}
	});

	it("splits a note into days and joins it back unchanged, text added by hand included", () => {
		const header = transcriptHeader("G", "g@g.us", "group", []);
		const body = "Nota minha\n\n## 2026-03-10\n\n**09:00** — A: oi\n\n\n## 2026-03-11\n\n**10:00** — B: tchau\n\nComentário";
		const { preamble, sections } = splitNote(header + body);
		expect(preamble).toBe("Nota minha\n");
		expect(sections.map((s) => s.day)).toEqual(["2026-03-10", "2026-03-11"]);
		expect(sections[1]?.text).toBe("\n## 2026-03-11\n\n**10:00** — B: tchau\n\nComentário");
		expect(joinSections(preamble, sections)).toBe(body);
	});

	it("only YYYY-MM-DD level-2 headings start a day", () => {
		const { sections } = splitNote("# T\n\n## 2026-03-10\n\n## Minha seção\n### 2026-03-11\n");
		expect(sections).toHaveLength(1);
	});

	it("a note ending without a line break still leaves the next day on its own line", () => {
		const a = { day: "2026-03-10", text: "\n## 2026-03-10\n\nfim" };
		const b = { day: "2026-03-11", text: "\n## 2026-03-11\n\nx\n\n" };
		expect(joinSections("", [a, b])).toBe("\n## 2026-03-10\n\nfim\n\n## 2026-03-11\n\nx\n\n");
		expect(splitNote("# T\n").sections).toEqual([]);
	});
});
