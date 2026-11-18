// Bundles the plugin into main.js.
//   node esbuild.config.mjs              watch mode, inline source maps
//   node esbuild.config.mjs production   one minified build

import { builtinModules } from "node:module";
import esbuild from "esbuild";

const production = process.argv.includes("production");

const BANNER = [
	"/*",
	"WhatsApp Desktop (macOS) — Guilherme Schroder — MIT License",
	"Generated bundle; edit the TypeScript sources instead.",
	"*/",
].join("\n");

/** @type {import("esbuild").BuildOptions} */
const options = {
	entryPoints: ["src/main.ts"],
	outfile: "main.js",
	bundle: true,
	format: "cjs", // Obsidian loads plugins as CommonJS
	target: "es2020",
	platform: "browser",
	banner: { js: BANNER },
	// Provided at runtime: Obsidian's API, Electron and Node's built-ins (the
	// plugin is desktop-only). node:sqlite is listed on its own because older
	// Node versions leave prefix-only modules out of builtinModules.
	external: ["obsidian", "electron", "node:sqlite", ...builtinModules],
	// `await import("node:sqlite")` becomes a lazy require inside a promise, so
	// an Obsidian build without it rejects with a clear message instead of
	// failing to load the plugin.
	supported: { "dynamic-import": false },
	treeShaking: true,
	minify: production,
	sourcemap: production ? false : "inline",
	logLevel: "info",
};

if (production) {
	await esbuild.build(options);
} else {
	const watcher = await esbuild.context(options);
	await watcher.watch();
}
