import { afterEach, describe, expect, it } from "vitest";

import { formatDuration, MEDIA_TYPES, mediaKindOf, renderMedia, type MediaInfo } from "../../src/core/media";
import { setLocale } from "../../src/core/i18n";

const info = (o: Partial<MediaInfo>): MediaInfo => ({ kind: "image", durationSec: null, name: null, latitude: null, longitude: null, ...o });

afterEach(() => setLocale("en"));

describe("media", () => {
	it("maps the confirmed message types and nothing else", () => {
		expect(MEDIA_TYPES).toEqual([1, 2, 3, 4, 5, 8, 11, 15, 54]);
		expect(mediaKindOf(54)).toBe("video");
		expect(mediaKindOf(0)).toBeNull();
		expect(mediaKindOf(66)).toBeNull();
	});

	it("formats durations", () => {
		expect(formatDuration(5)).toBe("0:05");
		expect(formatDuration(65)).toBe("1:05");
		expect(formatDuration(3725)).toBe("1:02:05");
	});

	it("labels media in the interface language and escapes third-party text", () => {
		expect(renderMedia(info({ kind: "gif" }), "  ")).toBe("[GIF]");
		expect(renderMedia(info({ kind: "document" }), "")).toBe("[Document]");
		expect(renderMedia(info({ kind: "location", latitude: 0, longitude: 0 }), "")).toBe("[Location]");
		expect(renderMedia(info({ kind: "contact", name: "[[Ana]]" }), "")).toBe("[Contact: \\[\\[Ana\\]\\]]");
		setLocale("pt");
		expect(renderMedia(info({ kind: "audio", durationSec: 30 }), "")).toBe("[Áudio 0:30]");
		expect(renderMedia(info({ kind: "sticker" }), "")).toBe("[Figurinha]");
		expect(renderMedia(info({ kind: "image" }), "oi #tag")).toBe("[Imagem] oi \\#tag");
	});
});
