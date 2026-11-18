import { describe, expect, it } from "vitest";

import { setFrontmatterList, yamlList } from "../../src/core/frontmatter";

describe("yamlList", () => {
	it("writes quoted items, or an empty list", () => {
		expect(yamlList("participants", ["Ana", "Bia"])).toBe('participants:\n  - "Ana"\n  - "Bia"\n');
		expect(yamlList("participants", [])).toBe("participants: []\n");
	});
});

describe("setFrontmatterList", () => {
	const note = '---\nsource: whatsapp\nparticipants:\n  - "Ana"\n  - "Bia"\nkind: group\ntags: [minha]\n---\n\n# G\n\ncorpo\n';

	it("replaces the list and keeps every other property and the body", () => {
		expect(setFrontmatterList(note, "participants", ["Ana", "Caio"])).toBe(
			'---\nsource: whatsapp\nkind: group\ntags: [minha]\nparticipants:\n  - "Ana"\n  - "Caio"\n---\n\n# G\n\ncorpo\n',
		);
	});

	it("replaces an inline list and adds a missing one", () => {
		expect(setFrontmatterList("---\na: 1\nparticipants: []\n---\nx", "participants", ["Ana"])).toBe('---\na: 1\nparticipants:\n  - "Ana"\n---\nx');
		expect(setFrontmatterList("---\na: 1\n---\nx", "participants", [])).toBe("---\na: 1\nparticipants: []\n---\nx");
	});

	it("does not touch similarly named keys or notes without frontmatter", () => {
		expect(setFrontmatterList("---\nparticipants_old: 1\n---\n", "participants", [])).toBe("---\nparticipants_old: 1\nparticipants: []\n---\n");
		expect(setFrontmatterList("# sem frontmatter", "participants", ["A"])).toBe("# sem frontmatter");
	});
});
