// Based on obsidianmd/obsidian-sample-plugin's eslint.config.mts, which runs the
// same `eslint-plugin-obsidianmd` rules the Community directory's automated
// review applies.
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"tests/tsconfig.json",
		"scripts/**",
		// Type-checked by tests/tsconfig.json (`npm run typecheck`); the project
		// service only discovers files listed in the nearest tsconfig.
		"vitest.config.mts",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Layering: src/core is pure — no
		// Obsidian, Electron, Node or SQLite, and no imports from the outer
		// layers — so everything it decides is unit-testable in isolation.
		files: ["src/core/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: ["obsidian", "electron", "fs", "path", "os"].map((name) => ({
						name,
						message: "src/core must stay pure: do I/O in source/, vault/, state/ or ui/.",
					})),
					patterns: [
						{ group: ["node:*"], message: "src/core must stay pure." },
						{
							group: ["../source/*", "../vault/*", "../state/*", "../ui/*", "../util/*", "../main", "../sync-service"],
							message: "src/core must not depend on outer layers.",
						},
					],
				},
			],
		},
	},
);
