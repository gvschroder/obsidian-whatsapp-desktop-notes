import { describe, expect, it } from "vitest";
import type { Vault as ObsidianVault } from "obsidian";

import { ensureVaultFolder, appendToTranscript, writeVaultFile, noteExists } from "../../src/vault/notes-writer";
import { Vault } from "../mocks/obsidian";

const asVault = (v: Vault): ObsidianVault => v as unknown as ObsidianVault;

describe("vault writes", () => {
	it("ensureVaultFolder is idempotent and ignores the vault root", async () => {
		const v = new Vault();
		await ensureVaultFolder(asVault(v), "A/B");
		await ensureVaultFolder(asVault(v), "A/B");
		await ensureVaultFolder(asVault(v), "/");
		expect([...v.folders]).toEqual(["A/B"]);
	});

	it("appendToTranscript creates with header once, then appends body only", async () => {
		const v = new Vault();
		await appendToTranscript(asVault(v), "n.md", "HEADER\n", "one\n");
		await appendToTranscript(asVault(v), "n.md", "HEADER\n", "two\n");
		expect(v.files.get("n.md")).toBe("HEADER\none\ntwo\n");
	});

	it("writeVaultFile overwrites an existing file", async () => {
		const v = new Vault();
		await writeVaultFile(asVault(v), "i.md", "v1");
		await writeVaultFile(asVault(v), "i.md", "v2");
		expect(v.files.get("i.md")).toBe("v2");
	});
});

describe("vault writes use the Vault API only", () => {
	it("never touches vault.adapter", async () => {
		const v = new Vault();
		const adapter = { exists: () => Promise.reject(new Error("adapter used")), append: () => Promise.reject(new Error("adapter used")) };
		Object.assign(v.adapter, adapter);
		await ensureVaultFolder(asVault(v), "A");
		await appendToTranscript(asVault(v), "A/n.md", "H\n", "x\n");
		await appendToTranscript(asVault(v), "A/n.md", "H\n", "y\n");
		await writeVaultFile(asVault(v), "A/i.md", "1");
		await writeVaultFile(asVault(v), "A/i.md", "2");
		expect(v.files.get("A/n.md")).toBe("H\nx\ny\n");
		expect(v.files.get("A/i.md")).toBe("2");
		expect(noteExists(asVault(v), "A/n.md")).toBe(true);
		expect(noteExists(asVault(v), "A/missing.md")).toBe(false);
	});

	it("falls back to append when a create races with another writer", async () => {
		const v = new Vault();
		const create = v.create.bind(v);
		v.create = async (path: string, data: string) => {
			await create(path, "RACED\n"); // another writer wins the race…
			return create(path, data); // …so our create throws "already exists"
		};
		await appendToTranscript(asVault(v), "n.md", "H\n", "body\n");
		expect(v.files.get("n.md")).toBe("RACED\nbody\n");
	});
});
