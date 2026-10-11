import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument, parseServices, parseSources, displayFailure, responseOrder } from "./responses.ts";
import { BridgeRequestError } from "./api.ts";
import { PreferenceSaveError } from "./preferences.ts";
import type { Preferences } from "./models.ts";
const defaults: Preferences = {
    translationLanguage: "zh-Hans",
    sourceLanguage: "auto",
    showTranslation: true,
    showPronunciation: true,
    japaneseRomaji: true,
    originalChineseScript: "Simplified",
    romanizationSystem: "Hepburn",
    rowOrder: "pronunciation-first",
    originalSize: 40,
    pronunciationSize: 24,
    translationSize: 24,
    rowSpacing: 6,
};
const fixture = () => ({
    lyrics: {
        hash: "current",
        source: "Fixture",
        providerId: "42",
        lines: [
            {
                id: "row",
                text: "你好",
                start: 0,
                end: 100,
                cues: [{ position: 0, endPosition: 2, start: 0, end: 100 }],
                translations: { en: "Hello" },
                language: "zh",
            },
        ],
    },
    preferences: defaults,
    accountPreferences: defaults,
    songOverrides: { sourceLanguage: null, translationLanguage: null },
    auxiliaryChoices: { translation: "auto", pronunciation: "provider" },
    track: { title: "Fixture", artist: "Artist", album: "", durationMs: null },
    timingCorrection: { hash: "current", fingerprint: "timeline", seconds: 0.5 },
    previousSelection: { lyrics: null, instrumental: null },
    variants: [],
    improvement: null,
    errors: [],
    pronunciation: { state: "idle", error: null },
});
test("normalization preserves request ordering without exposing internal metadata in JSON", () => {
    const key = Symbol("request-order"),
        input = fixture();
    Object.defineProperty(input, key, { value: 3 });
    const value = parseDocument(input, defaults);
    assert.equal(responseOrder(value, key), 3);
    assert.equal(JSON.stringify(value).includes("request-order"), false);
    assert.equal(value.songOverrides?.sourceLanguage, null);
    assert.equal(value.timingCorrection?.seconds, 0.5);
});
test("malformed payloads and duplicate foreground/background identities fail before rendering", () => {
    for (const input of [null, [], { lyrics: { hash: "bad", lines: [{ id: "a", text: 42 }] } }, { preferences: { rowSpacing: "huge" } }])
        assert.throws(() => parseDocument(input, defaults));
    const input = fixture();
    input.lyrics.lines.push({ ...input.lyrics.lines[0]! });
    assert.throws(() => parseDocument(input, defaults), /duplicate/);
    assert.throws(() => parseServices([{ service: "Google", translation: true, pronunciation: true, languages: [12] }]));
    assert.throws(() => parseSources([{ name: "Fixture", enabled: "yes", configured: true }]));
});
test("error translation preserves scope and explicit retry identity including Error subclasses", () => {
    const scope = { id: 1, itemId: "item", controller: new AbortController(), issued: 1, accepted: 0 };
    const failure = displayFailure(new BridgeRequestError({ code: "conflict", message: "Changed", retryable: true }, scope));
    assert.equal(failure.scope, scope);
    assert.equal(failure.details?.code, "conflict");
    const save = displayFailure(new PreferenceSaveError("Retry saving", "preferences"));
    assert.equal(save.noticeKey, "preferences:preferences");
    assert.equal(save.details?.retryable, true);
    assert.equal(displayFailure(new DOMException("Cancelled", "AbortError")).name, "AbortError");
});

test("preview-era responses without explicit account/song preferences are rejected", () => {
    const input: Record<string, unknown> = fixture();
    delete input.accountPreferences;
    assert.throws(() => parseDocument(input, defaults), /invalid lyric response/);
});
