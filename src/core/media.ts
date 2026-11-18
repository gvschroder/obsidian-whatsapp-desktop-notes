// Media messages: which WhatsApp message types are shown, and how each is
// written in a transcript ("[Image] caption", "[Audio 1:05]"…). Pure.
//
// ZWAMESSAGE.ZMESSAGETYPE values, confirmed against a real ChatStorage.sqlite
// by the extensions of the stored files: 1 image (jpg), 2 video (mp4),
// 3 audio (opus/mp3), 4 contact card, 5 location, 8 document, 11 GIF (mp4),
// 15 sticker (webp), 54 short video message (mp4). Other non-text types
// (calls, polls, reactions, system events…) are not shown.

import { escapeMarkdown, singleLine } from "./markdown";
import { t } from "./i18n";

export type MediaKind = "image" | "video" | "audio" | "contact" | "location" | "document" | "gif" | "sticker";

const KIND_BY_TYPE: Record<number, MediaKind> = {
	1: "image",
	2: "video",
	3: "audio",
	4: "contact",
	5: "location",
	8: "document",
	11: "gif",
	15: "sticker",
	54: "video",
};

/** Message types read as media (used in the SQL filter). */
export const MEDIA_TYPES: readonly number[] = Object.keys(KIND_BY_TYPE).map(Number);

export function mediaKindOf(type: number): MediaKind | null {
	return KIND_BY_TYPE[type] ?? null;
}

export interface MediaInfo {
	kind: MediaKind;
	/** Seconds, for audio and video. */
	durationSec: number | null;
	/** Document file name or shared contact's name. */
	name: string | null;
	latitude: number | null;
	longitude: number | null;
}

/** "1:05", "12:00", "1:02:03". */
export function formatDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.round(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * The transcript text of a media message: a bracketed label (with duration,
 * file or contact name, or a map link) followed by the escaped caption.
 * Names and captions are third-party text and are escaped like messages.
 */
export function renderMedia(media: MediaInfo, caption: string): string {
	const m = t().media;
	const parts: string[] = [];
	const named = (label: string): string => (media.name ? `${label}: ${escapeMarkdown(singleLine(media.name))}` : label);
	switch (media.kind) {
		case "audio":
		case "video": {
			const label = m[media.kind];
			parts.push(`[${media.durationSec ? `${label} ${formatDuration(media.durationSec)}` : label}]`);
			break;
		}
		case "document":
			parts.push(`[${named(m.document)}]`);
			break;
		case "contact":
			parts.push(`[${named(m.contact)}]`);
			break;
		case "location": {
			parts.push(`[${m.location}]`);
			if (media.latitude !== null && media.longitude !== null && (media.latitude !== 0 || media.longitude !== 0)) {
				const lat = media.latitude.toFixed(5);
				const lon = media.longitude.toFixed(5);
				parts.push(`<https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}>`);
			}
			break;
		}
		default:
			parts.push(`[${m[media.kind]}]`);
	}
	const text = caption.trim();
	if (text) parts.push(escapeMarkdown(text));
	return parts.join(" ");
}
