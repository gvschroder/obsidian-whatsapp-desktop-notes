// English strings — the reference dictionary. Every other language provides
// the same keys (enforced by the `Messages` type).

import { dayParts, type Period } from "../periods";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026", "March 2026", "March 9–15, 2026", "Tuesday, March 10, 2026". */
function periodTitle({ type, start, end }: Period): string {
	const a = dayParts(start);
	const b = dayParts(end);
	const month = (p: typeof a): string => MONTHS[p.month - 1] ?? "";
	switch (type) {
		case "year":
			return String(a.year);
		case "month":
			return `${month(a)} ${a.year}`;
		case "day":
			return `${WEEKDAYS[a.weekday] ?? ""}, ${month(a)} ${a.day}, ${a.year}`;
		case "week":
			if (a.year !== b.year) return `${month(a)} ${a.day}, ${a.year} – ${month(b)} ${b.day}, ${b.year}`;
			if (a.month !== b.month) return `${month(a)} ${a.day} – ${month(b)} ${b.day}, ${a.year}`;
			return `${month(a)} ${a.day}–${b.day}, ${a.year}`;
	}
}

export const en = {
	/** Values written into a first install's settings. */
	defaults: {
		groupNotesFolder: "Groups",
		directNotesFolder: "Personal",
		selfDisplayName: "Me",
	},

	commands: {
		ribbon: "Sync WhatsApp now",
		syncNow: "Sync now",
		stopSync: "Stop syncing",
		chooseChats: "Choose chats to sync",
		addChat: "Add a chat to the list",
		stopSyncingCurrent: "Stop syncing this chat",
		rebuildCurrent: "Rebuild this chat's note",
		openSetup: "Open the setup assistant",
		expireNow: "Remove messages older than the TTL",
	},

	notices: {
		alreadyRunning: "A sync is already running.",
		stopping: "Stopping after the current chat…",
		syncResult: (messages: number, chats: number, failed: number) =>
			(messages ? `${plural(messages, "new message", "new messages")} in ${plural(chats, "chat", "chats")}.` : "No new messages.") +
			(failed ? ` ${plural(failed, "chat", "chats")} failed — see the developer console.` : ""),
		rebuilt: (n: number) => `Note rebuilt with ${plural(n, "message", "messages")}.`,
		rebuiltAll: (notes: number, failed: number) =>
			`${plural(notes, "note", "notes")} rebuilt.` + (failed ? ` ${failed} failed — see the developer console.` : ""),
		reorganized: (chats: number, failed: number) =>
			`Notes of ${plural(chats, "chat", "chats")} reorganized.` + (failed ? ` ${failed} failed — see the developer console.` : ""),
		expired: (messages: number, notes: number, failed: number) =>
			(messages ? `${plural(messages, "old message", "old messages")} removed` : "No message older than the TTL") +
			(notes ? `; ${plural(notes, "empty note", "empty notes")} moved to the trash.` : ".") +
			(failed ? ` ${failed} failed — see the developer console.` : ""),
		expiredAfterSync: (messages: number) => ` ${plural(messages, "old message", "old messages")} removed (TTL).`,
		ttlOff: "Set a TTL in the settings first (Period › Keep messages for).",
		listComplete: "Every chat is already on the list.",
		testing: "Testing access…",
	},

	errors: {
		dbNotFound:
			"WhatsApp database not found. Open WhatsApp Desktop at least once, or set its path in Settings › Advanced.",
		noAccess:
			"Could not open WhatsApp's database. Check that WhatsApp Desktop is installed and was opened at least once, and that Obsidian is on in System Settings › Privacy & Security › Full Disk Access, then restart Obsidian.",
		noSqlite:
			"This Obsidian installation lacks the built-in SQLite the plugin needs. Download and install the latest Obsidian from obsidian.md (in-app updates do not replace the installer).",
		unsupportedOs:
			"This plugin works only on macOS: it is the only system where the official WhatsApp Desktop keeps a readable message database.",
		emptyWindow: "This chat has no text messages in the configured period. The note was not changed.",
		writeNoteFailed: (path: string) => `Could not write the note ${path}.`,
		writeFileFailed: (path: string) => `Could not write the file ${path}.`,
		newerSchema: (found: number, supported: number) =>
			`data.json was saved by a newer version of this plugin (format ${found}; this version reads up to ${supported}). ` +
			"Update the plugin. Your data was not changed.",
	},

	/** Results of adding or removing one chat. */
	selection: {
		alreadySynced: (name: string) => `"${name}" is already being synced.`,
		nowSyncing: (name: string) => `"${name}" will be synced.`,
		stopped: (name: string) => `"${name}" will no longer be synced. Its note was kept.`,
		notSynced: (name: string) => `"${name}" is not being synced.`,
	},

	scope: {
		all: "All chats",
		groups: "Groups only",
		personal: "Personal chats only",
		include: "Only chosen chats",
		exclude: "All except chosen chats",
		counts: (total: number, groups: number, personal: number) =>
			`${plural(total, "chat", "chats")} (${plural(groups, "group", "groups")}, ${personal} personal)`,
		describeAll: "Every chat is copied to the vault.",
		describeGroups: "Only group chats are copied.",
		describePersonal: "Only one-to-one chats are copied.",
		describeInclude: (counts: string) => `Only the chosen chats are copied: ${counts}.`,
		describeIncludeNone: "No chat chosen yet — nothing will be copied.",
		describeExclude: (counts: string) => `Every chat is copied except the chosen ones: ${counts}.`,
		describeExcludeNone: "No exceptions — every chat is copied.",
	},

	period: {
		days: (n: number) => `Last ${n} days`,
		year: "Last year",
		all: "Entire history",
	},

	interval: {
		off: "Off",
		minutes: (n: number) => `Every ${n} min`,
		hours: (n: number) => `Every ${n} h`,
	},

	validation: {
		dotSegments: 'A folder name cannot be "." or "..".',
		blankSegment: "A folder name cannot be blank.",
		illegalChars: 'A folder name cannot contain : * ? " < > |',
	},

	settings: {
		unsupported: "System not supported",
		syncNow: "Sync now",
		lastSync: (when: string) => `Last sync: ${when}.`,
		neverSynced: "Not synced yet.",
		syncButton: "Sync",
		stopButton: "Stop",

		chatsHeading: "Chats",
		scope: "Chats to sync",
		choose: "Choose chats",
		chooseDesc: "Opens your WhatsApp chat list to pick which chats are synced.",
		chooseButton: "Choose…",
		skipArchived: "Skip archived chats",
		skipArchivedDesc: "Chats archived in WhatsApp are not copied.",

		periodHeading: "Period",
		period: "Copy messages from",
		periodDesc:
			"Older messages are not copied. Widening the period adds the missing older messages at the top of each note on the next sync; narrowing it keeps what the notes already have.",
		retention: "Keep messages for (days)",
		retentionDesc:
			"TTL: days older than this leave the notes after every sync, or now with the button; a period note left empty goes to the trash. Text you added inside those days goes too. Empty or 0 keeps everything.",
		retentionPlaceholder: "Forever",
		retentionButton: "Remove now",

		notesHeading: "Notes",
		folder: "Vault folder",
		folderDesc: (index: string) => `Chat notes go in this folder. The note "${index}" lists every chat.`,
		grouping: "Split notes by",
		groupingDesc:
			"One note per chat, or one note per period in a folder per chat — lighter to open for long chats. Changing it reorganizes the existing notes.",
		groupingOptions: { single: "Nothing (one note per chat)", year: "Year", month: "Month", week: "Week", day: "Day" },

		autoHeading: "Automatic sync",
		interval: "Frequency",
		intervalDesc: "Syncs in the background while Obsidian is open.",
		onStartup: "When Obsidian opens",
		onStartupDesc: "Syncs once Obsidian finishes loading.",

		accessHeading: "WhatsApp access",
		db: "WhatsApp database",
		dbFound: (path: string) => `Reads ${path}. Use "Test access" to check it.`,
		dbNotFound: "Not found. Open WhatsApp Desktop at least once, or set the path under Advanced.",
		testButton: "Test access",
		setup: "Setup assistant",
		setupDesc: "Walks through access, chats, period and folder.",
		setupButton: "Open",

		advancedHeading: "Advanced",
		language: "Language",
		languageDesc:
			"Automatic follows Obsidian's language, or the system's when Obsidian has none set. Command names change after Obsidian reloads.",
		languageAuto: "Automatic",
		dbPath: "Database path",
		dbPathDesc: "Full path to ChatStorage.sqlite. Leave empty to detect it automatically.",
		groupNotesFolder: "Groups subfolder",
		directNotesFolder: "Personal chats subfolder",
		subfolderDesc: "Inside the vault folder. Applies to new notes.",
		selfDisplayName: "Your name in chats",
		ownNameDesc: "Label for the messages you sent.",
		debug: "Debug log",
		debugDesc: "Writes the details of each sync to the developer console (Cmd+Option+I).",
		rebuildAll: "Rebuild all notes",
		rebuildAllDesc:
			"Rewrites every chat note from WhatsApp with the messages of the configured period. Use it after changing the period or if a note is out of date. Text you added by hand is lost.",
		rebuildAllButton: "Rebuild",
	},

	probe: {
		ok: (n: number) => `Access OK: ${plural(n, "text message", "text messages")}.`,
		names: (contacts: number, pushNames: number) =>
			`Names: ${plural(contacts, "saved contact", "saved contacts")} and ${plural(pushNames, "profile name", "profile names")}.`,
		contactsMissing: "Contacts database not found: senders without a saved contact show their profile name or phone number.",
		samples: "Sample senders:",
		you: "(you)",
		kindPhone: "phone",
		kindNone: "no ID",
	},

	setup: {
		title: "Set up WhatsApp Desktop (macOS)",
		intro: "Copies your WhatsApp Desktop chats into notes in this vault. Read-only: nothing is sent or changed in WhatsApp.",
		accessStep: "1. WhatsApp access",
		checking: "Checking…",
		accessOk: "WhatsApp database found and readable.",
		retry: "Test again",
		openPrivacy: "Open Privacy settings",
		chatsStep: "2. Chats",
		periodStep: "3. Period",
		folderStep: "4. Vault folder",
		later: "Not now",
		finish: "Save and sync",
	},

	picker: {
		titleInclude: "Chats to sync",
		titleExclude: "Chats to skip",
		hintInclude: "Check the chats to copy into the vault.",
		hintExclude: "Check the chats that should not be copied.",
		loading: "Reading your WhatsApp chats…",
		loadFailed: (msg: string) => `Could not read the chats: ${msg}`,
		searchPlaceholder: "Search by name",
		showAll: "All",
		showGroups: "Groups",
		showPersonal: "Personal",
		showChecked: "Checked",
		showArchived: "Show archived",
		checkShown: "Check shown",
		uncheckAll: "Uncheck all",
		summary: (checked: number, shown: number) => `${checked} checked · ${shown} shown`,
		noMatches: "No chats found.",
		noMessages: "no messages",
		kindGroup: "Group",
		kindPersonal: "Personal",
		messages: (n: number) => plural(n, "message", "messages"),
		archived: "archived",
		missing: "not found in WhatsApp",
		truncated: (max: number, total: number) => `Showing the ${max} most recent of ${total}. Search to find the others.`,
		cancel: "Cancel",
		save: (n: number) => (n ? `Save (${n})` : "Save"),
		saveFailed: (msg: string) => `Could not save the selection: ${msg}`,
	},


	modals: {
		cancel: "Cancel",
		suggestPlaceholder: "Search chats",
		suggestGroup: "group",
		suggestPersonal: "personal",
		rebuildTitle: "Rebuild this note?",
		rebuildBody: (name: string) =>
			`The note for "${name}" will be rewritten with the messages of the configured period. Text you added by hand will be lost.`,
		rebuildAllTitle: "Rebuild all notes?",
		rebuildAllBody:
			"Every chat note will be rewritten with the messages of the configured period. Text you added by hand will be lost.",
		rebuildConfirm: "Rebuild",
		reorganizeTitle: "Reorganize the notes?",
		reorganizeBody: (chats: number, layout: string) =>
			`The notes of ${plural(chats, "chat", "chats")} will be regrouped as "${layout}". Nothing is read from WhatsApp and no message is lost; the old files go to the trash. Properties you added to their frontmatter are not carried over.`,
		reorganizeConfirm: "Reorganize",
		expireTitle: "Remove old messages?",
		expireBody: (days: number, cutoff: string) =>
			`Days before ${cutoff} (older than ${plural(days, "day", "days")}) will be removed from every chat's notes, including text you added inside them. Period notes left empty go to the trash. This also happens after every sync while the TTL is set.`,
		expireConfirm: "Remove",
	},

	statusBar: {
		idle: "WhatsApp",
		syncing: "WhatsApp · syncing…",
		error: "WhatsApp · error",
		tooltip: "Sync WhatsApp now",
	},

	/** Labels written in transcripts for media messages. */
	media: {
		image: "Image",
		video: "Video",
		audio: "Audio",
		contact: "Contact",
		location: "Location",
		document: "Document",
		gif: "GIF",
		sticker: "Sticker",
	},

	notes: {
		unknownSender: "Unknown",
		indexIntro: (n: number) => `_${plural(n, "chat", "chats")} · updated on every sync._`,
		indexPersonal: "Personal chats",
		indexGroups: "Groups",
		indexNone: "_None yet._",
		indexMessages: (n: number) => plural(n, "message", "messages"),
		/** The period in a period note's "# title", written out. */
		periodTitle,
	},
};

export type Messages = typeof en;
