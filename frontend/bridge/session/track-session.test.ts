import assert from "node:assert/strict";
import { test } from "node:test";
import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { Preferences } from "../../contracts/preferences.ts";
import { Lifecycle } from "../../shared/lifecycle.ts";
import { createTrackSession } from "./track-session.ts";

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
function fixture(api: () => Promise<unknown> = async () => ({})) {
    const lifetime = new Lifecycle(),
        metrics = { decorations: 0, requests: 0, stale: 0, searchRowUpdates: 0, searchSorts: 0, maxSearchPaintMs: 0 };
    let rendered = 0;
    const session = createTrackSession({
        beforeRelease() {},
        afterRelease() {},
        discardOtherAccounts() {},
        reportPreferenceFailures() {},
        refreshLanguageOptions() {},
        hasLyricRows: () => true,
        lifetime,
        saveIdentity: () => "account",
        ensureTools() {},
        services: [],
        sources: [],
        updateStatus() {},
        status() {},
        responseOrder: Symbol(),
        lyricViewHidden: false,
        metrics,
        playbackPreview: { defer: () => false },
        pendingPreference: () => undefined,
        defaults,
        mergePreferences() {},
        lyricView: { index() {} },
        showError(error) {
            throw error;
        },
        render() {
            rendered++;
        },
        refreshRows() {},
        updateSongPanel() {},
        isLyrics: () => false,
        restoreGeneration: async () => {},
        transcriptionPanel: { restore: async () => {} },
        api,
        searchUsageRefresh: null,
    });
    return { session, lifetime, metrics, rendered: () => rendered };
}
function document(): BridgeDocument {
    return { preferences: { ...defaults }, accountPreferences: { ...defaults }, songOverrides: {}, complete: true };
}

test("track requests reuse their captured identity and cancellation releases the previous track", () => {
    const original = globalThis.window;
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window;
    const f = fixture();
    try {
        const request = new Request("https://fixture.invalid/Audio/first/Lyrics");
        const first = f.session.begin(request, "first");
        assert.equal(f.session.begin(request, "FIRST"), first);
        assert.equal(first.controller.signal.aborted, false);
        const second = f.session.begin(request, "second");
        assert.notEqual(second, first);
        assert.equal(first.controller.signal.aborted, true);
        f.session.cancel();
        f.session.cancel();
        assert.equal(second.controller.signal.aborted, true);
        assert.equal(f.session.current, null);
        assert.equal(f.session.scope, null);
    } finally {
        f.lifetime.dispose();
        globalThis.window = original;
    }
});

test("late track reads cannot render or replace the newer track", async () => {
    const original = globalThis.window;
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window;
    let resolve!: (data: unknown) => void;
    const f = fixture(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    try {
        const request = new Request("https://fixture.invalid/Audio/first/Lyrics");
        f.session.begin(request, "first");
        const pending = f.session.refreshSong(true);
        const second = f.session.begin(request, "second");
        f.session.accept(document(), second, false, 2);
        resolve(document());
        await pending;
        assert.equal(f.session.current?.itemId, "second");
        assert.equal(f.metrics.stale, 1);
        assert.equal(f.rendered(), 0);
    } finally {
        f.lifetime.dispose();
        globalThis.window = original;
    }
});

test("document commands preserve unrelated payload fields and stale revisions are rejected", () => {
    const original = globalThis.window;
    globalThis.window = { setTimeout, clearTimeout } as unknown as Window;
    const f = fixture();
    try {
        const scope = f.session.begin(new Request("https://fixture.invalid/Audio/item/Lyrics"), "item");
        f.session.accept({ ...document(), track: { title: "captured", artist: "fixture", album: "" } }, scope, false, 4);
        f.session.setSongOverrides({ sourceLanguage: "ja" });
        f.session.setPreferences({ ...defaults, translationLanguage: "fr" });
        f.session.accept({ ...document(), track: { title: "old", artist: "", album: "" } }, scope, false, 3);
        assert.equal(f.session.current?.track?.title, "captured");
        assert.equal(f.session.current?.songOverrides?.sourceLanguage, "ja");
        assert.equal(f.session.current?.preferences.translationLanguage, "fr");
        assert.equal(f.metrics.stale, 1);
    } finally {
        f.lifetime.dispose();
        globalThis.window = original;
    }
});
