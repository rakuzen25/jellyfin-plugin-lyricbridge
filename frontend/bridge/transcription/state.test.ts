import assert from "node:assert/strict";
import { test } from "node:test";
import { BoundaryHistory, graphemeEnds, parseReview, validateEnds, type TimedToken } from "./state.ts";
const tokens: TimedToken[] = [
    { id: "t0", text: "Hello", separator: "", position: 0, endPosition: 5, start: 10, end: 20 },
    { id: "t1", text: "world", separator: " ", position: 6, endPosition: 11, start: 18, end: 30 },
    { id: "t2", text: "!", separator: "", position: 11, endPosition: 12, start: 30, end: 32 },
];
const fixture = () => ({
    transcript: { id: "source", text: "Hello world!", language: "en", timing: "word", tokens, warnings: [] },
    versions: [
        {
            id: "initial",
            origin: "local",
            algorithm: "phrase-dp/1",
            endTokenIds: ["t2"],
            settings: { characters: null, seconds: 3, keepShortReplies: true },
        },
    ],
    savedEntries: [],
    deletion: { allowed: true, reason: null },
    canManage: true,
    boundaries: [{ afterId: "t0", message: "Advisory only" }],
    selection: "baseline",
    canUse: true,
});
test("manual split merge undo redo and branching preserve all source tokens", () => {
    const before = JSON.stringify(tokens),
        history = new BoundaryHistory(tokens, ["t2"]);
    history.split("t0");
    assert.deepEqual(history.ends, ["t0", "t2"]);
    assert.deepEqual(history.phrases.flat(), tokens);
    history.merge("t0");
    assert.deepEqual(history.ends, ["t2"]);
    history.undo();
    assert.deepEqual(history.ends, ["t0", "t2"]);
    history.redo();
    assert.deepEqual(history.ends, ["t2"]);
    history.undo();
    history.split("t1");
    assert.equal(history.canRedo, false);
    history.merge("t2");
    assert.equal(history.ends.at(-1), "t2");
    const copy = history.ends;
    copy.pop();
    assert.equal(history.ends.at(-1), "t2");
    assert.equal(JSON.stringify(tokens), before);
});
test("boundary ID validation rejects losses, reordering, duplicates and unknowns", () => {
    for (const ends of [[], ["t0"], ["t2", "t0"], ["t0", "t0", "t2"], ["unknown", "t2"]]) assert.throws(() => validateEnds(tokens, ends));
});
test("review parsing rejects incorrect offsets, changed text and incomplete versions", () => {
    assert.equal(parseReview(fixture()).transcript.text, "Hello world!");
    assert.throws(() => parseReview({ ...fixture(), transcript: { ...fixture().transcript, text: "changed" } }));
    assert.throws(() =>
        parseReview({ ...fixture(), transcript: { ...fixture().transcript, tokens: [{ ...tokens[0], endPosition: 99 }, ...tokens.slice(1)] } }),
    );
    assert.throws(() => parseReview({ ...fixture(), versions: [{ ...fixture().versions[0], endTokenIds: ["t0"] }] }));
});
test("split choices use graphemes and UTF-16 rather than code point counts", () => {
    assert.deepEqual([...graphemeEnds("😀が👩‍💻")], [2, 4, 9]);
});

test("saved AI result references preserve deduplicated boundary identity and review preferences", () => {
    const source = fixture();
    const document = parseReview({
        ...source,
        reviewResults: [
            {
                id: "review-job",
                versionId: "initial",
                created: "2026-10-17T12:00:00Z",
                profile: { model: "fixture" },
                settings: { characters: 24, seconds: 4, keepShortReplies: true },
            },
        ],
    });
    assert.equal(document.versions.length, 1);
    assert.equal(document.reviewResults[0]?.versionId, "initial");
    assert.equal(document.reviewResults[0]?.settings?.characters, 24);
    assert.throws(() => parseReview({ ...source, reviewResults: [{ id: "bad", versionId: "missing" }] }), /saved AI review reference/);
});

test("an empty saved workspace preserves tokens without inventing a version", () => {
    const document = parseReview({ ...fixture(), versions: [], savedEntries: [] });
    assert.deepEqual(document.transcript.tokens, tokens);
    assert.equal(document.versions.length, 0);
    assert.equal(document.savedEntries.length, 0);
});
test("saved entries retain independent provenance and authoritative deletion explanations", () => {
    const source = fixture();
    const entry = { id: "manual", transcriptId: "source", versionId: "initial", origin: "manual", settings: source.versions[0]!.settings };
    const deletion = { allowed: false, reason: "Used by saved original original-hash." };
    const document = parseReview({
        ...source,
        savedEntries: [
            { entry, deletion },
            {
                entry: {
                    ...entry,
                    id: "review:job",
                    origin: "AI",
                    settings: { characters: 24, seconds: 4, keepShortReplies: false },
                    profile: { model: "fixture" },
                },
                deletion,
            },
        ],
    });
    assert.equal(document.savedEntries.length, 2);
    assert.equal(document.savedEntries[1]?.settings.characters, 24);
    assert.equal(document.savedEntries[1]?.model, "fixture");
    assert.equal(document.savedEntries[0]?.deletion.reason, deletion.reason);
    assert.throws(() => parseReview({ ...source, savedEntries: [{ entry: { ...entry, versionId: "missing" }, deletion }] }), /saved entry reference/);
    assert.throws(() => parseReview({ ...source, savedEntries: [{ entry, deletion: { allowed: "yes" } }] }), /deletion permissions/);
});
