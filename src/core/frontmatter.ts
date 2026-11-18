// Small, targeted edits to a note's YAML frontmatter. Pure.

import { toYamlString } from "./markdown";

/** A YAML list property: `key:` followed by one quoted item per line, or `key: []`. */
export function yamlList(key: string, values: string[]): string {
	if (!values.length) return `${key}: []\n`;
	return `${key}:\n${values.map((v) => `  - ${toYamlString(v)}`).join("\n")}\n`;
}

/**
 * Replace (or add) one list property in the leading frontmatter block, leaving
 * every other line — including properties the user added — as it was. A note
 * without frontmatter is returned unchanged.
 */
export function setFrontmatterList(content: string, key: string, values: string[]): string {
	if (!content.startsWith("---\n")) return content;
	const end = content.indexOf("\n---\n", 3);
	if (end === -1) return content;
	const kept: string[] = [];
	let inKey = false;
	for (const line of content.slice(4, end).split("\n")) {
		if (inKey && /^\s+(-|$)/.test(line)) continue; // items of the replaced list
		inKey = line === `${key}:` || line.startsWith(`${key}: `) || line.startsWith(`${key}:\t`);
		if (!inKey) kept.push(line);
	}
	const head = kept.filter((l, i) => l !== "" || i < kept.length - 1);
	return `---\n${[...head, yamlList(key, values).trimEnd()].join("\n")}${content.slice(end)}`;
}
