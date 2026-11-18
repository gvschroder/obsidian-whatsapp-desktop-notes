// Whether the plugin runs on macOS — the only system where the official
// WhatsApp Desktop keeps a readable message database. Pure: main.ts sets it
// once at load (from Obsidian's Platform); everything else reads it.

let mac = true;

export function setMacOS(value: boolean): void {
	mac = value;
}

export function isMacOS(): boolean {
	return mac;
}
