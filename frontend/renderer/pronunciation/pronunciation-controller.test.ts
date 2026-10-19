import assert from "node:assert/strict";
import { test } from "node:test";
import { Lifecycle } from "../../shared/lifecycle.ts";
import { createPronunciationController } from "./pronunciation-controller.ts";
function fixture() {
    const lifecycle = new Lifecycle();
    return {
        ...createPronunciationController({
            lyricsPort: { snapshot: { lyrics: null, generation: 1 } },
            lifecycle,
            redecorateForRomanization: () => {},
            warn: () => {},
        }),
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
