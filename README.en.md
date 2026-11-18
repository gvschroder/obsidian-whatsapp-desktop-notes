# WhatsApp Desktop (macOS)

🇧🇷 **[Leia em português](README.md)**

> [!IMPORTANT]
> **macOS only.** Requires the official WhatsApp Desktop app for Mac. Windows and
> Linux are not supported: there the plugin stays inactive. See
> [Why only macOS](#why-only-macos).

Turn your WhatsApp Desktop chats into notes in your Obsidian vault — one note per
chat, kept up to date automatically. Everything happens on your Mac: the plugin
reads WhatsApp Desktop's local database, read-only, and never touches the
network.

---

## What you get

```
WhatsApp/
├── WhatsApp Index.md      ← index of every synced chat, newest first
├── Personal/
│   └── Alice Souza.md
└── Groups/
    └── Project Falcon.md
```

Each chat note starts with properties — including who is in the chat — and
grows with every sync, one section per day:

```markdown
---
source: whatsapp-desktop
whatsapp_jid: "5511999990001@s.whatsapp.net"
whatsapp_chat: "Alice Souza"
chat_type: personal
participants:
  - "Alice Souza"
  - "Me"
---

# Alice Souza

## 2026-03-10

**09:14** — Alice Souza: Did you see the proposal?

**09:15** — Alice Souza: [Document: proposal-v2.pdf]

**09:20** — Me: [Audio 0:42]
```

- **Choose what to sync:** all chats, groups only, personal chats only, only
  the chats you pick, or everything except the ones you pick.
- **Choose how far back:** the last 7, 30, 90 or 365 days, or the entire
  history. Widening the period later adds the older messages.
- **Media included:** photos, videos, voice messages, documents, contacts,
  locations, GIFs and stickers appear as labelled lines with their captions,
  durations or names (the files themselves stay in WhatsApp).
- **Who is in the chat:** a `participants` property lists the group's members
  (or, in a one-to-one chat, the other person and you), refreshed whenever the
  chat gets new messages or its note is rebuilt.
- **Automatic:** every 15 minutes to 4 hours, and/or when Obsidian opens.
- **Incremental:** each sync adds only new messages, with no duplicates.
- **Safe text:** messages are written as plain text — they cannot inject links,
  embeds, images, tags or code into your vault.
- **English and Portuguese:** follows Obsidian's language, or your system's.

## Requirements

- **macOS** with the official **WhatsApp Desktop** app (not WhatsApp Web),
  opened at least once.
- **Obsidian 1.13 or later**, desktop, installed from a recent installer from
  [obsidian.md](https://obsidian.md) (the plugin uses the SQLite built into it).
- **Full Disk Access** for Obsidian (see below) — macOS protects WhatsApp's
  data folder.

### Why only macOS

The plugin reads the message database that the official WhatsApp Desktop keeps
on your computer. Only the macOS app keeps one that can be read: the official
Windows app is WhatsApp Web inside a window, with its messages encrypted in
browser storage, and there is no official WhatsApp Desktop for Linux. On those
systems the plugin installs but stays inactive and says so in its settings.

## Getting started

1. Install the plugin: copy `main.js`, `manifest.json` and `styles.css` from the
   latest release into `<your vault>/.obsidian/plugins/whatsapp-desktop-sync/`,
   then enable **WhatsApp Desktop (macOS)** in **Settings › Community plugins**.
2. The **setup assistant** opens. It checks access to WhatsApp, then asks
   which chats to sync, how far back, and which vault folder to use.
3. Click **Save and sync**. Nothing is written to your vault before this step.

### Granting Full Disk Access

1. Open **System Settings › Privacy & Security › Full Disk Access** (the
   assistant has a button for it).
2. Turn on **Obsidian** (add it with **+** if it is not listed).
3. Quit and reopen Obsidian.

> **Know what you are granting.** Full Disk Access applies to the whole
> Obsidian app, including every community plugin in every vault you open. Grant
> it only if you trust those plugins, and check your company's policy on a work
> computer.

## Everyday use

| To… | Use |
|---|---|
| Sync now | The ribbon icon, the status bar item, or **Sync now** |
| Pick chats | **Settings › Chats › Choose chats**, or **Choose chats to sync** |
| Add one chat to your list | **Add a chat to the list** |
| Stop syncing the chat you are reading | **Stop syncing this chat** (the note is kept) |
| Refresh a note after edits or deletions in WhatsApp | **Rebuild this chat's note** |
| Refresh every note | **Settings › Advanced › Rebuild all notes** |
| Change the setup later | **Open the setup assistant** |

Commands live in the command palette (Cmd+P). Rebuilding rewrites a note from
WhatsApp, so text you added to it by hand is lost; the plugin asks first.

## Settings

| Section | Setting | What it does |
|---|---|---|
| — | Sync now | Runs a sync and shows when the last one finished. |
| Chats | Chats to sync | All, groups only, personal only, only chosen, or all except chosen. |
| | Choose chats | Opens the chat list: search, filter by kind, show archived chats. |
| | Skip archived chats | Leaves out chats archived in WhatsApp. |
| Period | Copy messages from | How far back to copy. Widening it adds the older messages at the top of each note on the next sync; narrowing it keeps what notes already have. |
| Notes | Vault folder | Where notes are created. The index note, "WhatsApp Index", goes in it. |
| Automatic sync | Frequency | Background sync while Obsidian is open. |
| | When Obsidian opens | Syncs once Obsidian finishes loading. |
| WhatsApp access | WhatsApp database | Shows where the database was found; **Test access** checks it can be read. |
| | Setup assistant | Reopens the assistant. |
| Advanced | Language | Automatic, English or Português. |
| | Database path | Only needed if WhatsApp's database is not found automatically. |
| | Subfolders | Folder names for group and personal chats (new notes). |
| | Your name in chats | Label for the messages you sent. |
| | Debug log | Details of each sync in the developer console. |
| | Rebuild all notes | Rewrites every chat note for the current period. |

## How it works

- WhatsApp Desktop keeps your messages in `ChatStorage.sqlite` and contact names
  in `ContactsV2.sqlite`, in
  `~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/`.
- The plugin opens both **read-only** with the SQLite engine built into
  Obsidian, so the newest messages appear immediately. Nothing is copied and no
  other file outside the vault is read or written.
- Each chat remembers the last message it wrote, so the next sync adds only
  newer ones — even messages sent in the same second are never duplicated.
- Each note is named after its chat; two chats with the same name get
  "Name (2)". The chat is identified by its WhatsApp ID (`whatsapp_jid`), not by the
  file name: renaming a chat keeps its note and its place in your selection, and
  **Rebuild** moves the note to the chat's current name, updating links.
- Sender names come from your saved contacts, then the sender's WhatsApp
  profile name, then the phone number; unknown group members appear as
  `Member-…`. Chats without a name show the phone number.
- Media messages show a label with the caption, duration, file name, contact
  name or a map link. Calls, polls, reactions and other events are not written.

## Privacy

- **No network.** The plugin makes no requests and needs no account or key.
- **Read-only.** WhatsApp's files are never modified, and no copy is written to
  disk.
- **Files outside the vault:** only the two WhatsApp databases above are read.
- **Sensitive data in your vault:** chat notes contain other people's messages
  and, for unsaved contacts, phone numbers. The plugin's `data.json`
  (`.obsidian/plugins/whatsapp-desktop-sync/`) lists the synced chats' IDs,
  names and participants. Think before syncing these files to other services,
  and follow data protection rules (such as LGPD or GDPR) for work
  conversations.

## Troubleshooting

| Problem | Solution |
|---|---|
| "Could not open WhatsApp's database" | Open WhatsApp Desktop once, grant Full Disk Access to Obsidian and restart it. If WhatsApp keeps its data elsewhere, set **Advanced › Database path**. |
| "This Obsidian installation lacks the built-in SQLite" | Download and install the latest Obsidian from obsidian.md; in-app updates do not replace the installer. |
| "System not supported" | You are on Windows or Linux — see [Why only macOS](#why-only-macos). |
| Older media or captions are missing from a note | Notes written before media support only gain new media; run **Rebuild this chat's note**. |
| The first sync is slow | Choose a shorter period; later syncs only read new messages. |
| A note looks wrong or has duplicates | Run **Rebuild this chat's note**. |

## Development

Requires Node 24 (`.nvmrc`; at least 22.13, for `node:sqlite`). Use a dedicated test vault.

```bash
npm install
npm run dev                      # rebuild main.js on every change
npm run check                    # typecheck, lint, tests with coverage, licence policy
npm run build                    # production bundle
npm run install:vault -- --link  # link the build into ~/Documents/Obsidian Vault
```

`VAULT="/path/to/vault" npm run install:vault` installs into another vault.
Tests run against a synthetic WhatsApp database
(`tests/fixtures/whatsapp-fixture.ts`) and an in-memory vault; golden files in
`tests/characterization/__golden__/` pin the generated Markdown.

## Licenses

MIT © 2026 Guilherme Schroder — see [LICENSE](LICENSE). `main.js` bundles no
third-party code.

This is an independent project, not affiliated with, endorsed by or sponsored by
WhatsApp or Meta. "WhatsApp" is a trademark of WhatsApp LLC.
