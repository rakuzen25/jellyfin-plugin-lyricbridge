import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLyricsPayload, lyricTextProfile, lyricTimingMode, usableWordCueRanges } from "./payload.ts";
test("malformed native rows cannot shift line identities", () => {
    assert.equal(normalizeLyricsPayload({ Lyrics: [{ Text: "valid" }, null] }), null);
    assert.equal(normalizeLyricsPayload({ Lyrics: [{ Text: 9 }] }), null);
    assert.deepEqual(normalizeLyricsPayload({ lyrics: [{ text: "valid" }] }), [{ text: "valid" }]);
});
test("transport prefixes preserve UTF-16 cue offsets and supplied vocal roles", () => {
    const Text = "[ak:bg][ak:agent=lead%202]你😀";
    const profile = lyricTextProfile({ Text });
    assert.equal(profile.text, "你😀");
    assert.equal(profile.vocalAgent, "lead 2");
    assert.equal(profile.isBackgroundVocal, true);
    const ranges = usableWordCueRanges({
        Text,
        Cues: [
            { Position: profile.positionOffset, EndPosition: profile.positionOffset + 1, Start: 0 },
            { Position: profile.positionOffset + 1, EndPosition: Text.length, Start: 100 },
        ],
    });
    assert.deepEqual(
        ranges.map((range) => Text.slice(range.startPosition, range.endPosition)),
        ["你", "😀"],
    );
});
test("plain, line-timed and real advancing word cues stay distinct", () => {
    assert.equal(
        lyricTimingMode([
            { Text: "one", Start: 0 },
            { Text: "two", Start: 0 },
        ]),
        "plain",
    );
    assert.equal(
        lyricTimingMode([
            { Text: "one", Start: 0 },
            { Text: "two", Start: 100 },
        ]),
        "line",
    );
    assert.equal(
        lyricTimingMode([
            {
                Text: "one two",
                Cues: [
                    { Position: 0, EndPosition: 3, Start: 0 },
                    { Position: 4, EndPosition: 7, Start: 100 },
                ],
            },
        ]),
        "enhanced",
    );
    assert.notEqual(
        lyricTimingMode([
            {
                Text: "one two",
                Cues: [
                    { Position: 0, EndPosition: 7, Start: 0 },
                    { Position: 0, EndPosition: 7, Start: 100 },
                ],
            },
        ]),
        "enhanced",
    );
    assert.equal(lyricTimingMode([{ Text: "held", Cues: [{ Position: 0, EndPosition: 4, Start: 0, End: 100 }] }]), "enhanced");
});

test("obsolete preview sentinels are plain source text; current background prefixes remain supported", () => {
    const old = "\u2063\u2060hello";
    const profile = lyricTextProfile({ Text: old });
    assert.equal(profile.text, old);
    assert.equal(profile.isBackgroundVocal, false);
    assert.equal(lyricTextProfile({ Text: "[ak:bg]hello" }).isBackgroundVocal, true);
});
