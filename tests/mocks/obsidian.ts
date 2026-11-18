// Minimal in-memory stand-in for the parts of the Obsidian API the plugin
// touches outside the UI: normalizePath, TFile/TFolder and Vault (+ adapter).
// Only behaviour the sync code depends on is modelled.

/** Same algorithm as Obsidian's normalizePath. */
export function normalizePath(path: string): string {
	let p = path.replace(/([\\/])+/g, "/").replace(/(^\/+|\/+$)/g, "");
	if (p === "") p = "/";
	return p.replace(/\u00A0|\u202F/g, " ").normalize("NFC");
}

export abstract class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.split("/").pop() ?? this.path;
	}
}

export class TFile extends TAbstractFile {}
export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Notice {
	constructor(public message: string, public timeout?: number) {}
}

/** In-memory vault. `files` maps normalized path → content. */
export class Vault {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();

	readonly adapter = {
		exists: async (path: string): Promise<boolean> => {
			const p = normalizePath(path);
			return this.files.has(p) || this.folders.has(p);
		},
		append: async (path: string, data: string): Promise<void> => {
			const p = normalizePath(path);
			this.files.set(p, (this.files.get(p) ?? "") + data);
		},
	};

	async create(path: string, data: string): Promise<TFile> {
		const p = normalizePath(path);
		if (this.files.has(p)) throw new Error("File already exists.");
		this.files.set(p, data);
		return new TFile(p);
	}

	async createFolder(path: string): Promise<TFolder> {
		const p = normalizePath(path);
		if (this.folders.has(p)) throw new Error("Folder already exists.");
		this.folders.add(p);
		return new TFolder(p);
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.files.set(file.path, data);
	}

	getFileByPath(path: string): TFile | null {
		const p = normalizePath(path);
		return this.files.has(p) ? new TFile(p) : null;
	}

	getFolderByPath(path: string): TFolder | null {
		const p = normalizePath(path);
		if (!this.folders.has(p)) return null;
		const folder = new TFolder(p);
		const inside = (q: string): boolean => q.startsWith(`${p}/`) && !q.slice(p.length + 1).includes("/");
		folder.children = [
			...[...this.folders].filter(inside).map((q) => new TFolder(q)),
			...[...this.files.keys()].filter(inside).map((q) => new TFile(q)),
		];
		return folder;
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.files.get(file.path) ?? "";
	}

	async append(file: TFile, data: string): Promise<void> {
		this.files.set(file.path, (this.files.get(file.path) ?? "") + data);
	}

	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const next = fn(this.files.get(file.path) ?? "");
		this.files.set(file.path, next);
		return next;
	}

	async rename(file: TAbstractFile, newPath: string): Promise<void> {
		const p = normalizePath(newPath);
		if (this.files.has(p) || this.folders.has(p)) throw new Error("Destination file already exists!");
		if (file instanceof TFolder) {
			const move = (q: string): string => (q === file.path || q.startsWith(`${file.path}/`) ? p + q.slice(file.path.length) : q);
			for (const q of [...this.folders]) {
				this.folders.delete(q);
				this.folders.add(move(q));
			}
			for (const [q, data] of [...this.files]) {
				this.files.delete(q);
				this.files.set(move(q), data);
			}
		} else {
			this.files.set(p, this.files.get(file.path) ?? "");
			this.files.delete(file.path);
		}
		file.path = p;
	}

	/** Paths moved to the trash, in order (tests check nothing is deleted outright). */
	readonly trashed: string[] = [];

	/** Stands in for FileManager.trashFile. */
	readonly trashFile = async (file: TAbstractFile): Promise<void> => {
		if (file instanceof TFolder) {
			if ([...this.files.keys(), ...this.folders].some((q) => q.startsWith(`${file.path}/`))) throw new Error("Folder not empty (mock)");
			this.folders.delete(file.path);
		} else {
			this.files.delete(file.path);
		}
		this.trashed.push(file.path);
	};

	getAbstractFileByPath(path: string): TAbstractFile | null {
		const p = normalizePath(path);
		if (this.files.has(p)) return new TFile(p);
		if (this.folders.has(p)) return new TFolder(p);
		return null;
	}

	/** Test helper: every note as one deterministic text blob (sorted by path). */
	dump(): string {
		return [...this.files.keys()]
			.sort()
			.map((path) => `===== ${path} =====\n${this.files.get(path) ?? ""}`)
			.join("\n");
	}
}

/** Same contract as Obsidian's debounce (enough for modules that import it). */
export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout = 0): ((...args: T) => void) & { cancel(): void } {
	let handle: ReturnType<typeof setTimeout> | undefined;
	const fn = (...args: T): void => {
		clearTimeout(handle);
		handle = setTimeout(() => cb(...args), timeout);
	};
	fn.cancel = () => clearTimeout(handle);
	return fn;
}

/** Knobs for tests: the app version check and the interface language. */
export const __mock = { language: "en" };


export function getLanguage(): string {
	return __mock.language;
}

// UI classes are never instantiated by the tested modules; they exist so that
// type-only and side-effect imports resolve.
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class App {}
