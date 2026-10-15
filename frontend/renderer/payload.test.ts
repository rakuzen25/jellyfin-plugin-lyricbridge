import { normalizedCueTextRanges } from "./cue-ranges.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { lyricPayloadIdentity, normalizeLyricsPayload, lyricTextProfile, lyricTimingMode, usableWordCueRanges } from "./payload.ts";
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

test("Unicode control characters remain literal unless an explicit background prefix is present", () => {
    const text = "\u2063\u2060hello";
    const profile = lyricTextProfile({ Text: text });
    assert.equal(profile.text, text);
    assert.equal(profile.isBackgroundVocal, false);
    assert.equal(lyricTextProfile({ Text: "[ak:bg]hello" }).isBackgroundVocal, true);
});

test("original identity tracks cue boundaries and IDs without auxiliary metadata", () => {
    const line = { Text: "歌", Start: 1, End: 9, LyricBridgeId: "row", Cues: [{ Position: 0, EndPosition: 1, Start: 1, End: 9 }] };
    assert.equal(lyricPayloadIdentity([line]), lyricPayloadIdentity([{ ...line, translations: { en: "song" } }]));
    assert.notEqual(lyricPayloadIdentity([line]), lyricPayloadIdentity([{ ...line, Cues: [{ Position: 0, EndPosition: 1, Start: 1, End: 8 }] }]));
    assert.notEqual(lyricPayloadIdentity([line]), lyricPayloadIdentity([{ ...line, LyricBridgeId: "other" }]));
});

test("inferred cue ends retain empty markers, bounded positions and source order", () => {
    const ranges = normalizedCueTextRanges([{ Position: 0 }, { Position: 0 }, { Position: 2 }, { Position: 1 }, { Position: 4 }], 5);
    assert.deepEqual(
        ranges.map(({ cueIndex, startPosition, endPosition }) => [cueIndex, startPosition, endPosition]),
        [
            [1, 0, 2],
            [2, 2, 4],
            [3, 1, 4],
            [4, 4, 5],
        ],
    );
    assert.deepEqual(normalizedCueTextRanges([{ Position: null }, { Position: 2 }], 5), []);
    assert.deepEqual(normalizedCueTextRanges([{ Position: 6 }], 5), []);
    assert.equal(normalizedCueTextRanges([{ Position: -1 }, { Position: 0 }, { Position: 2 }], 3)[0]?.endPosition, 2);
});

test("large cue rows preserve every adjacent text boundary", () => {
    const count = 10000;
    const ranges = normalizedCueTextRanges(
        Array.from({ length: count }, (_, Position) => ({ Position })),
        count,
    );
    assert.equal(ranges.length, count);
    for (let index = 0; index < count; index++) {
        assert.equal(ranges[index]?.startPosition, index);
        assert.equal(ranges[index]?.endPosition, index + 1);
    }
});
