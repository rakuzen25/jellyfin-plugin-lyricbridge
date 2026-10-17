import { test } from "node:test";
import assert from "node:assert/strict";
import { auxiliary, effectiveAuxiliaryChoice, hasEmbeddedVersion } from "./auxiliary.ts";
import type { AuxiliaryDocument, Preferences, Variant } from "./models.ts";

const preferences: Preferences = {
    sourceLanguage: "auto",
    translationLanguage: "zh-Hant",
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
};
function fixture(): AuxiliaryDocument {
    return {
        lyrics: {
            hash: "original",
            source: "QQ Music",
            lines: [
                { id: "first", text: "歌", language: "ja", pronunciation: "uta", translations: { zh: "歌曲" } },
                { id: "gap", text: "歌", language: "ja" },
            ],
        },
        auxiliaryChoices: { translation: "auto", pronunciation: "auto" },
        variants: [
            {
                key: "generated",
                hash: "original",
                kind: "translation",
                language: "zh-Hans",
                service: "AI",
                model: "fixture",
                originType: "generated",
                text: { first: "generated first", gap: "generated gap" },
            },
            {
                key: "local",
                hash: "original",
                kind: "pronunciation",
                language: "ja",
                service: "Kawazu",
                model: "",
                originType: "local",
                text: { gap: "local gap" },
            },
        ].map((v) => ({ contextBefore: 0, contextAfter: 0, reasoningEffort: "", promptVersion: 0, ...v }) as Variant),
    };
}
test("embedded availability includes background vocals and ignores blank or unrelated language rows", () => {
    const doc = fixture();
    assert.equal(hasEmbeddedVersion(doc.lyrics, "translation", "zh-Hant"), true);
    assert.equal(hasEmbeddedVersion(doc.lyrics, "translation", "en"), false);
    doc.lyrics!.lines = [
        { id: "main", text: "main", background: { id: "bg", text: "background", translations: { en: "hello" }, pronunciation: "   \u200B\uFEFF" } },
    ];
    assert.equal(hasEmbeddedVersion(doc.lyrics, "translation", "en"), true);
    assert.equal(hasEmbeddedVersion(doc.lyrics, "pronunciation", ""), false);
});
test("Automatic fills gaps while choosing the embedded version leaves missing rows blank", () => {
    const doc = fixture();
    const [first, gap] = doc.lyrics!.lines;
    assert.equal(auxiliary(first, "translation", preferences, doc)?.key, "provider");
    assert.equal(auxiliary(gap, "translation", preferences, doc)?.key, "generated");
    assert.equal(auxiliary(gap, "pronunciation", preferences, doc)?.key, "local");
    doc.auxiliaryChoices = { translation: "provider", pronunciation: "provider" };
    assert.equal(auxiliary(first, "pronunciation", preferences, doc)?.text, "uta");
    assert.equal(auxiliary(gap, "translation", preferences, doc), null);
    assert.equal(auxiliary(gap, "pronunciation", preferences, doc), null);
    assert.equal(effectiveAuxiliaryChoice(doc, "translation", { ...preferences, translationLanguage: "en" }), "auto");
    assert.equal(auxiliary(first, "translation", { ...preferences, translationLanguage: "zh-Hans" }, doc)?.key, "provider");
    assert.equal(auxiliary(first, "translation", { ...preferences, translationLanguage: "en" }, doc), null);
    assert.equal(effectiveAuxiliaryChoice(doc, "translation", preferences), "provider");
});

test("server-resolved playback rows preserve per-row selection and fall back after preference edits", () => {
    const line = { id: "l0", text: "Original", translations: { en: "Embedded" } };
    const p = { translationLanguage: "en", sourceLanguage: "auto", originalChineseScript: "Simplified" } as Preferences;
    const doc = {
        lyrics: { hash: "hash", lines: [line] },
        auxiliaryChoices: { translation: "provider", pronunciation: "auto" },
        resolvedAuxiliary: {
            translationLanguage: "en",
            sourceLanguage: "auto",
            originalChineseScript: "Simplified",
            choices: { translation: "provider", pronunciation: "auto" },
            translation: { l0: { text: "Resolved", key: "provider" } },
            pronunciation: {},
        },
    };
    assert.equal(auxiliary(line, "translation", p, doc)?.text, "Resolved");
    assert.equal(auxiliary(line, "pronunciation", p, doc), null);
    assert.equal(auxiliary(line, "translation", { ...p, originalChineseScript: "Traditional" }, doc)?.text, "Embedded");
});
