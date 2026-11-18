// Everything the plugin writes goes through the Vault API (never
// `vault.adapter`), as Obsidian's plugin guidelines ask: Obsidian then caches
// reads, serializes writes with other plugins and keeps background edits
// atomic. Creating a file tolerates a race with another writer: if the file
// appears in between, the write is applied to the existing file instead.

import { normalizePath, TFile, type TAbstractFile, type Vault } from "obsidian";

import { t } from "../core/i18n";

/** Renames a note or folder; in Obsidian, FileManager.renameFile also updates links to it. */
export type RenameFile = (file: TAbstractFile, newPath: string) => Promise<void>;

/** Moves a note or folder to the trash; in Obsidian, FileManager.trashFile follows the user's trash setting. */
export type TrashFile = (file: TAbstractFile) => Promise<void>;

function fileAt(vault: Vault, path: string): TFile | null {
	return vault.getFileByPath(normalizePath(path));
}

/**
 * Create the file with `initial` content, or — when it already exists, even if
 * it appeared a moment ago — run `update` on it. `failure` names the error.
 */
async function createOrUpdate(
	vault: Vault,
	path: string,
	initial: string,
	update: (file: TFile) => Promise<unknown>,
	failure: (path: string) => string,
): Promise<void> {
	const target = normalizePath(path);
	const current = vault.getFileByPath(target);
	if (current) {
		await update(current);
		return;
	}
	try {
		await vault.create(target, initial);
	} catch {
		const appeared = vault.getFileByPath(target);
		if (!appeared) throw new Error(failure(target));
		await update(appeared);
	}
}

/** Make sure a vault folder exists. */
export async function ensureVaultFolder(vault: Vault, folder: string): Promise<void> {
	const target = normalizePath(folder);
	if (target === "/" || target === "" || vault.getFolderByPath(target)) return;
	await vault.createFolder(target).catch(() => undefined); // created meanwhile
}

/** Whether a note exists at this vault path. */
export function noteExists(vault: Vault, path: string): boolean {
	return fileAt(vault, path) !== null;
}

/** Add `body` at the end of a transcript, creating it with `header` first. */
export async function appendToTranscript(vault: Vault, path: string, header: string, body: string): Promise<void> {
	await createOrUpdate(vault, path, header + body, (file) => vault.append(file, body), t().errors.writeNoteFailed);
}

/** Write a whole file (the index, a rebuilt note), replacing what was there. */
export async function writeVaultFile(vault: Vault, path: string, content: string): Promise<void> {
	await createOrUpdate(vault, path, content, (file) => vault.process(file, () => content), t().errors.writeFileFailed);
}

/** Edit an existing note atomically; false when there is no such note. */
export async function transformNote(vault: Vault, path: string, transform: (content: string) => string): Promise<boolean> {
	const file = fileAt(vault, path);
	if (file) await vault.process(file, transform);
	return file !== null;
}

/** Move a note or a folder (nothing happens when it does not exist). */
export async function moveNote(vault: Vault, from: string, to: string, rename?: RenameFile): Promise<void> {
	const file = vault.getAbstractFileByPath(normalizePath(from));
	if (!file) return;
	await (rename ? rename(file, normalizePath(to)) : vault.rename(file, normalizePath(to)));
}

/** Whether a folder exists at this vault path. */
export function folderExists(vault: Vault, path: string): boolean {
	return vault.getFolderByPath(normalizePath(path)) !== null;
}

/** The Markdown notes directly inside a folder, sorted by path (none when it does not exist). */
export function notesIn(vault: Vault, folder: string): string[] {
	const children = vault.getFolderByPath(normalizePath(folder))?.children ?? [];
	return children
		.filter((c): c is TFile => c instanceof TFile && c.path.endsWith(".md"))
		.map((c) => c.path)
		.sort();
}

/** Read a note; null when there is none. */
export async function readNote(vault: Vault, path: string): Promise<string | null> {
	const file = fileAt(vault, path);
	return file ? vault.cachedRead(file) : null;
}

/** Move a note to the trash (nothing happens when it does not exist). */
export async function trashNote(vault: Vault, path: string, trash: TrashFile): Promise<void> {
	const file = fileAt(vault, path);
	if (file) await trash(file);
}

/** Move a folder to the trash when nothing is left in it. */
export async function trashFolderIfEmpty(vault: Vault, path: string, trash: TrashFile): Promise<void> {
	const folder = vault.getFolderByPath(normalizePath(path));
	if (folder && !folder.children.length) await trash(folder);
}
