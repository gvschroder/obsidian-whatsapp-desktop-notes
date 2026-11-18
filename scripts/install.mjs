// Puts the built plugin into a vault for testing.
//
//   npm run install:vault              copies into ~/Documents/Obsidian Vault
//   npm run install:vault -- --link    symlinks instead (each build is picked up on reload)
//   VAULT="/path/to/vault" npm run install:vault
//
// Use a vault kept for testing: the plugin writes real conversations into it.

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];
const vault = process.env.VAULT || join(homedir(), "Documents", "Obsidian Vault");
const useSymlinks = process.argv.includes("--link");
// The plugin folder must be named after the manifest id.
const { id } = JSON.parse(readFileSync("manifest.json", "utf8"));
const destination = join(vault, ".obsidian", "plugins", id);

const fail = (message) => {
	console.error(message);
	process.exit(1);
};

if (!existsSync(join(vault, ".obsidian"))) {
	fail(`"${vault}" is not an Obsidian vault (no .obsidian folder). Open it in Obsidian once, or set VAULT.`);
}
const missing = RELEASE_FILES.filter((name) => !existsSync(name));
if (missing.length) fail(`Missing ${missing.join(", ")} — run "npm run build" first.`);

const occupied = (path) => {
	try {
		lstatSync(path); // also sees a broken symlink
		return true;
	} catch {
		return false;
	}
};

mkdirSync(destination, { recursive: true });
for (const name of RELEASE_FILES) {
	const target = join(destination, name);
	if (occupied(target)) rmSync(target);
	if (useSymlinks) symlinkSync(resolve(name), target);
	else copyFileSync(name, target);
	console.log(`${useSymlinks ? "linked" : "copied"} ${name} → ${destination}`);
}
console.log("Reload Obsidian (or toggle the plugin) to pick up the new build.");
