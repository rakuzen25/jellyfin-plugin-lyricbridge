import assert from "node:assert/strict";
import { detectScriptProfile, firstStrongDirection, getGraphemeRanges, getWordRanges } from "./text-processing.ts";

// Surrogate pairs, combining marks, emoji families/flags and Indic/Hangul shaping
// must never acquire an animation boundary inside the displayed grapheme.
for (const text of ["𝄞", "e\u0301", "👨‍👩‍👧‍👦", "🇯🇵", "क्‍ष", "각"]) {
    assert.deepEqual(getGraphemeRanges(text), [{ start: 0, end: text.length, text }]);
}
assert.deepEqual(
    getGraphemeRanges("a😀b").map((range) => [range.start, range.end]),
    [
        [0, 1],
        [1, 3],
        [3, 4],
    ],
);
assert.deepEqual(
    getWordRanges("你好世界", [
        { startPos: 0, endPos: 2 },
        { startPos: 2, endPos: 4 },
    ]).map((range) => range.text),
    ["你好", "世界"],
);
assert.deepEqual(
    getWordRanges("hello   world", null).map((range) => range.text),
    ["hello", "world"],
);
assert.equal(detectScriptProfile("مرحبا"), "arabic");
assert.equal(firstStrongDirection("123 مرحبا"), "rtl");
assert.equal(firstStrongDirection("123 Hello"), "ltr");
