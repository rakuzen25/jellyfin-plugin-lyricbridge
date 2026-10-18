import assert from "node:assert/strict";
import { test } from "node:test";
import type { BridgeDocument } from "../../contracts/bridge.ts";
import { sourceUsage } from "./source-usage.ts";
test("source badges distinguish supplied origins, hidden rows and generated variants", () => {
    const doc: BridgeDocument = {
        lyrics: {
            hash: "source",
            source: "QQ",
            providerId: "42",
            lines: [{ id: "a", text: "日本語", language: "ja", pronunciation: "nihongo", translations: { zh: "日语" } }],
        },
        preferences: {
            sourceLanguage: "auto",
            translationLanguage: "zh-Hans",
            showPronunciation: true,
            showTranslation: true,
            japaneseRomaji: true,
            originalChineseScript: "Simplified",
            romanizationSystem: "Hepburn",
            rowOrder: "pronunciation-first",
            originalSize: 40,
            pronunciationSize: 24,
            translationSize: 24,
            rowSpacing: 6,
        },
        variants: [],
        auxiliaryChoices: { translation: "auto", pronunciation: "auto" },
    };
    assert.deepEqual(sourceUsage(doc).get("QQ:42"), ["Original in use", "Pronunciation in use", "Translation in use"]);
    const variant = {
        key: "mixed",
        hash: "source",
        kind: "translation" as const,
        language: "zh-Hans",
        service: "NetEase",
        model: "Supplied",
        originType: "supplied" as const,
        origin: { source: "NetEase", providerId: "88" },
        text: { a: "译文" },
        contextBefore: 0,
        contextAfter: 0,
        reasoningEffort: "",
        promptVersion: 0,
    };
    doc.variants = [variant];
    doc.auxiliaryChoices!.translation = "mixed";
    assert.deepEqual(sourceUsage(doc).get("NetEase:88"), ["Translation in use"]);
    doc.preferences.showTranslation = false;
    assert.deepEqual(sourceUsage(doc).get("NetEase:88"), ["Translation selected · hidden"]);
    doc.variants = [{ ...variant, originType: "generated", origin: null, service: "AI" }];
    assert.equal(sourceUsage(doc).has("NetEase:88"), false);
    doc.preferences.japaneseRomaji = false;
    assert.deepEqual(sourceUsage(doc).get("QQ:42"), ["Original in use", "Pronunciation selected · hidden"]);
    assert.equal(sourceUsage(null).size, 0);
});
