import { test } from "node:test";
import assert from "node:assert/strict";
import { createPronunciationController } from "./pronunciation-controller.ts";
import { RendererLifecycle } from "./lifecycle.ts";
function fixture() {
    const state = {
        googleRomanizationCache: new Map<string, string>(),
        lyrics: null,
        googleRomanizationRequest: null,
        googleRomanizationAttempted: new Set<string>(),
        googleRomanizationFragmentCache: new Map<string, string>(),
        generation: 1,
        googleRomanizationState: "idle",
        googleRomanizationError: "",
        googleRomanizationLineCount: 0,
        romanizationSource: "none",
        romanizationMode: "native",
        romanizationLineCount: 0,
        romanizationAvailable: false,
    };
    const lifecycle = new RendererLifecycle();
    return {
        ...createPronunciationController({
            state,
            lifecycle,
            GOOGLE_ROMANIZATION_TIMEOUT_MS: 6000,
            GOOGLE_ROMANIZATION_MAX_RETRIES: 3,
            GOOGLE_ROMANIZATION_RETRY_DELAY_MS: 1000,
            GOOGLE_ROMANIZATION_CACHE_MAX_ENTRIES: 1800,
            GOOGLE_ROMANIZATION_MAX_TEXT_CHARS: 1500,
            GOOGLE_ROMANIZATION_CONCURRENCY: 3,
            redecorateForRomanization: () => {},
            warn: () => {},
        }),
        state,
        lifecycle,
    };
}
test("standalone pronunciation retains native fallback, provider parsing and Unicode alignment", () => {
    const controller = fixture();
    assert.equal(controller.parseGoogleRomanization([[[null, null, null, "nǐ hǎo"]]], "你好"), "ni hao");
    assert.equal(controller.parseGoogleRomanization({ unexpected: true }, "你好"), "");
    assert.equal(controller.cacheGoogleRomanization("你好", "你好"), false);
    assert.equal(controller.cacheGoogleRomanization("你好", "ni hao"), true);
    const boundaries = controller.buildRomanizedBoundaryMap("😀你好", "hello world");
    assert.equal(boundaries[0], 0);
    assert.equal(boundaries.at(-1), 11);
    for (let index = 1; index < boundaries.length; index++) assert.ok(boundaries[index]! >= boundaries[index - 1]!);
    controller.lifecycle.dispose();
});
test("disposed standalone controller rejects network admission before any external call", async () => {
    const controller = fixture();
    controller.lifecycle.dispose();
    await assert.rejects(controller.googleFetchWithTimeout("https://fixture.invalid"), { name: "AbortError" });
});
