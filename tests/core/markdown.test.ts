import { describe, expect, it } from "vitest";

import { fnv1aBase36 } from "../../src/core/hash";
import { toSafeFileName, toYamlString, escapeMarkdown, linkAlias, singleLine } from "../../src/core/markdown";

describe("fnv1aBase36 (FNV-1a 32-bit, base36)", () => {
	it.each([
		["", "ztntfp"],
		["a", "1r9wi7g"],
		["120363000000000001@g.us", "18xrxm0"],
		["5511999990001@s.whatsapp.net", "dgt7x3"],
	])("fnv1aBase36(%j) === %j", (input, expected) => {
		expect(fnv1aBase36(input)).toBe(expected);
	});

	it("distinguishes JIDs that share a suffix", () => {
		expect(fnv1aBase36("111@g.us")).not.toBe(fnv1aBase36("2111@g.us"));
	});
});

describe("toSafeFileName", () => {
	it("replaces characters illegal in file names or wiki-links", () => {
		expect(toSafeFileName('Projeto: "Falcon" / Q4 #1 [beta]')).toBe("Projeto Falcon Q4 1 beta");
		expect(toSafeFileName("a\\b*c?d<e>f|g^h")).toBe("a b c d e f g h");
	});

	it("collapses whitespace and trims", () => {
		expect(toSafeFileName("  muitos   espaços \n aqui ")).toBe("muitos espaços aqui");
	});

	it("caps the length at 80 characters", () => {
		expect(toSafeFileName("x".repeat(200))).toHaveLength(80);
	});

	it("falls back to 'chat' when nothing usable is left", () => {
		expect(toSafeFileName("/:*?")).toBe("chat");
		expect(toSafeFileName("")).toBe("chat");
	});

	it("keeps '..' (only safe because a hash suffix is always appended)", () => {
		expect(toSafeFileName("..")).toBe("..");
	});
});

describe("toYamlString", () => {
	it("wraps in double quotes and escapes backslash and quote", () => {
		expect(toYamlString('a "b" \\ c')).toBe('"a \\"b\\" \\\\ c"');
	});

	it("escapes control characters and line separators", () => {
		expect(toYamlString("linha1\nlinha2\tx\r")).toBe('"linha1\\nlinha2\\tx\\r"');
		expect(toYamlString("a\u0000b\u001bc\u2028d")).toBe('"a\\u0000b\\u001bc\\u2028d"');
		expect(toYamlString("sem nada especial")).toBe('"sem nada especial"');
	});
});

describe("escapeMarkdown", () => {
	it.each([
		// [input, expected]
		["texto simples, com acentuação e emoji 🎉", "texto simples, com acentuação e emoji 🎉"],
		["10:30 no café? ok!", "10:30 no café? ok!"],
		["**negrito** _itálico_ ~~riscado~~ ==marca==", "\\*\\*negrito\\*\\* \\_itálico\\_ \\~\\~riscado\\~\\~ \\=\\=marca\\=\\="],
		["![[nota]] [[link|alias]] [md](x)", "!\\[\\[nota\\]\\] \\[\\[link\\|alias\\]\\] \\[md\\](x)"],
		["#tag ^bloco %%comentário%% $x^2$", "\\#tag \\^bloco \\%\\%comentário\\%\\% \\$x\\^2\\$"],
		["`$= dv.current()` e `= this.file`", "\\`\\$\\= dv.current()\\` e \\`\\= this.file\\`"],
		["<script>x</script> <% tp.file %>", "&lt;script&gt;x&lt;/script&gt; &lt;\\% tp.file \\%&gt;"],
		["campo:: valor", "campo\\:\\: valor"],
		["C:\\pasta", "C:\\\\pasta"],
	])("escapeMarkdown(%j)", (input, expected) => {
		expect(escapeMarkdown(input)).toBe(expected);
	});

	it("neutralizes block syntax on continuation lines", () => {
		const out = escapeMarkdown("oi\n```js\n~~~\n# título\n> citação\n- item\n+ item\n1. item\n2) item\n---\n===\n| a | b |");
		expect(out).toBe(
			"oi\n\\`\\`\\`js\n\\~\\~\\~\n\\# título\n&gt; citação\n\\- item\n\\+ item\n1\\. item\n2\\) item\n\\---\n\\=\\=\\=\n\\| a \\| b \\|",
		);
		expect(out).not.toMatch(/^(```|~~~|#|>|[-+] |\d+[.)] |---|===|\|)/m);
	});

	it("does not escape a leading '-' / '+' on the first line (it never starts a line in a note)", () => {
		expect(escapeMarkdown("+5511999990001")).toBe("+5511999990001");
		expect(escapeMarkdown("-oi")).toBe("-oi");
	});

	it("turns bare URLs into inert autolinks, keeping their characters intact", () => {
		expect(escapeMarkdown("veja https://ex.com/a_b?x=1&y=%20#frag.")).toBe("veja <https://ex.com/a_b?x=1&y=%20#frag>.");
		expect(escapeMarkdown("(https://ex.com/p)")).toBe("(<https://ex.com/p>)");
		expect(escapeMarkdown("https://ex.com/[[x]]")).toBe("<https://ex.com/>\\[\\[x\\]\\]");
		expect(escapeMarkdown("javascript:alert(1)")).toBe("javascript:alert(1)");
	});

	it("normalizes CRLF line endings", () => {
		expect(escapeMarkdown("a\r\nb\rc")).toBe("a\nb\nc");
	});
});

describe("singleLine / linkAlias", () => {
	it("singleLine collapses whitespace and newlines", () => {
		expect(singleLine("  a\n\n b\t c ")).toBe("a b c");
	});

	it("linkAlias removes characters that would end a wiki-link early", () => {
		expect(linkAlias("Projeto [beta] | Q4\nnovo")).toBe("Projeto (beta) - Q4 novo");
		expect(linkAlias("   ")).toBe("chat");
	});
});
