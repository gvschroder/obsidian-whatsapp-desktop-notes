// Status-bar item: "WhatsApp · 14:32" / "· 3/12" / "· error". Click to sync.

import { t } from "../core/i18n";

const CLASS = "wa-desktop-notes-status";

function shortTime(iso: string): string | null {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export class SyncStatusBar {
	constructor(
		private readonly el: HTMLElement,
		onClick: () => void,
	) {
		el.addClasses([CLASS, "mod-clickable"]);
		el.setAttribute("aria-label", t().statusBar.tooltip);
		el.addEventListener("click", onClick);
	}

	idle(lastSyncIso: string | null): void {
		const when = lastSyncIso ? shortTime(lastSyncIso) : null;
		this.el.setText(when ? `${t().statusBar.idle} · ${when}` : t().statusBar.idle);
	}

	syncing(): void {
		this.el.setText(t().statusBar.syncing);
	}

	progress(done: number, total: number): void {
		this.el.setText(`${t().statusBar.idle} · ${done}/${total}`);
	}

	error(): void {
		this.el.setText(t().statusBar.error);
	}
}
