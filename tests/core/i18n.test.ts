import { afterEach, describe, expect, it } from "vitest";

import { localeFromLanguage, setLocale, t } from "../../src/core/i18n";
import { en } from "../../src/core/i18n/en";
import { pt } from "../../src/core/i18n/pt";
import { describeScope, startSyncing, stopSyncing } from "../../src/core/selection";
import { validateVaultFolder } from "../../src/core/validation";
import { renderIndex, speakerName } from "../../src/core/render";
import type { ChatSyncRecord, ChatStorageMessage } from "../../src/core/types";

afterEach(() => setLocale("en"));

/** Every leaf path with its kind ("string" | "function"). */
function shape(obj: object, prefix = ""): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === "object") Object.assign(out, shape(v as object, path));
		else out[path] = typeof v;
	}
	return out;
}

/** Call every entry with plausible arguments, for each locale. */
function render(obj: object): string[] {
	const out: string[] = [];
	for (const v of Object.values(obj)) {
		if (typeof v === "string") out.push(v);
		else if (typeof v === "function") {
			const fn = v as (...args: unknown[]) => unknown;
			out.push(String(fn(...new Array<unknown>(fn.length).fill(2))));
		}
		else if (v && typeof v === "object") out.push(...render(v as object));
	}
	return out;
}

describe("dictionaries", () => {
	it("pt has exactly the keys of en, with the same kinds", () => {
		expect(shape(pt)).toEqual(shape(en));
	});

	it("no entry renders empty or leaks a placeholder", () => {
		for (const dict of [en, pt]) {
			for (const text of render(dict)) {
				expect(text.trim()).not.toBe("");
				expect(text).not.toMatch(/undefined|NaN|\[object/);
			}
		}
	});

	it("pt uses singular and plural forms", () => {
		expect(pt.notices.syncResult(1, 1, 0)).toBe("1 mensagem nova em 1 conversa.");
		expect(pt.notices.syncResult(3, 2, 2)).toBe("3 mensagens novas em 2 conversas. 2 conversas falharam — veja o console.");
		expect(pt.notices.syncResult(0, 0, 0)).toBe("Nenhuma mensagem nova.");
		expect(en.notices.syncResult(1, 1, 1)).toBe("1 new message in 1 chat. 1 chat failed — see the developer console.");
	});
});

describe("localeFromLanguage", () => {
	it.each([
		["pt", "pt"],
		["pt-BR", "pt"],
		["PT-br", "pt"],
		["en", "en"],
		["en-GB", "en"],
		["es", "en"],
		["zh-TW", "en"],
		["", "en"],
		[null, "en"],
		[undefined, "en"],
	] as const)("%s → %s", (code, locale) => {
		expect(localeFromLanguage(code)).toBe(locale);
	});
});

describe("setLocale / t", () => {
	it("defaults to English and switches dictionaries", () => {
		expect(t().commands.syncNow).toBe("Sync now");
		setLocale("pt");
		expect(t().commands.syncNow).toBe("Sincronizar agora");
	});
});

describe("pure modules follow the locale", () => {
	const G = { jid: "g@g.us", name: "Grupo", kind: "group" as const };

	it("selection messages", () => {
		setLocale("pt");
		expect(describeScope("include", { [G.jid]: { name: G.name, kind: G.kind } })).toBe(
			"Só as escolhidas são copiadas: 1 conversa (1 grupo, 0 pessoais).",
		);
		expect(describeScope("all", {})).toBe("Todas as conversas são copiadas para o vault.");
		expect(startSyncing({ chatFilterMode: "include", excludedChats: {}, chosenChats: {} }, G).message).toBe('"Grupo" passará a ser sincronizada.');
		expect(stopSyncing({ chatFilterMode: "all", excludedChats: {}, chosenChats: {} }, G).message).toBe(
			'"Grupo" não será mais sincronizada. A nota foi mantida.',
		);
	});

	it("validation errors", () => {
		setLocale("pt");
		expect(validateVaultFolder("a/../b")).toEqual({ ok: false, error: 'O nome da pasta não pode ser "." nem "..".' });
	});

	it("index note and unknown sender", () => {
		setLocale("pt");
		const chat: ChatSyncRecord = {
			jid: G.jid,
			name: "Grupo",
			kind: "group",
			transcriptPath: "W/Groups/Grupo.md",
			lastMessageZPk: 1,
			lastDayHeading: "2025-01-01",
			messageTotal: 1,
			lastMessageAtIso: "2025-01-01T10:00:00.000Z",
			coveredSinceMac: null,
			participants: [],
		};
		const md = renderIndex([chat], "WhatsApp");
		expect(md).toContain("# WhatsApp\n");
		expect(md).toContain("_1 conversa · atualizado a cada sincronização._");
		expect(md).toContain("— 1 mensagem · 2025-01-01");
		expect(md).toContain("## Conversas pessoais (0)\n\n_Nenhuma ainda._");
		expect(md).toContain("## Grupos (1)");
		const msg: ChatStorageMessage = { zPk: 1, jid: G.jid, chatTitle: G.name, sender: null, text: "x", coreDataTime: 0, isFromMe: false };
		expect(speakerName(msg, G, "Eu")).toBe("Desconhecido");
	});
});
