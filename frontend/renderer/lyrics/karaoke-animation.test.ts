import assert from "node:assert/strict";
import type { AnimatedWord } from "./karaoke-animation.ts";
import { createKaraokeAnimation, MOTION_HANDOFF_TICKS } from "./karaoke-animation.ts";
const animation = createKaraokeAnimation(() => ({ gain: 1 }));
const word: AnimatedWord = {
    start: 0,
    end: 20,
    length: 4,
    segments: [
        { start: 0, end: 10, startPos: 0, endPos: 1 },
        { start: 10, end: 20, startPos: 1, endPos: 4 },
    ],
    visualProgress: 0,
    lastPaintAt: 0,
    motionMode: "grow",
    motionDurationMs: 2000,
};
assert.equal(animation.wordTargetProgress(word, -1), 0);
assert.equal(animation.wordTargetProgress(word, 5), 0.125);
assert.equal(animation.wordTargetProgress(word, 15), 0.625);
assert.equal(animation.wordTargetProgress(word, 20), 1);
word.segments[0]!.visualEnd = 0.5;
word.segments[1]!.visualStart = 0.5;
assert.equal(animation.wordTargetProgress(word, 5), 0.25);
assert.equal(animation.wordTargetProgress(word, 15), 0.75);
assert.equal(animation.motionContinuityGain(word, 20), 1);
assert.equal(animation.motionContinuityGain(word, 20 + MOTION_HANDOFF_TICKS), 0);
assert.equal(animation.motionHandoffActive(word, 20 + MOTION_HANDOFF_TICKS), false);
