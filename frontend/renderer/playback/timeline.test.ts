import assert from "node:assert/strict";
import { calculateLineBounds, planInstrumentalGaps } from "./timeline.ts";
const second = 10_000_000;
const lyrics = [{ Start: 0 }, { Start: 10 * second }];
const plain = calculateLineBounds(lyrics, lyrics[0]!, 0, [], [], 5);
assert.equal(plain.endTicks, 10 * second);
assert.equal(plain.trustedEndTicks, null);
assert.deepEqual(planInstrumentalGaps([plain, { startTicks: 10 * second, endTicks: 12 * second, trustedEndTicks: 12 * second }]), []);
const enhanced = calculateLineBounds(
    lyrics,
    lyrics[0]!,
    0,
    [],
    [
        { Position: 0, EndPosition: 5, Start: 0 },
        { Position: 5, EndPosition: 5, Start: 3 * second },
    ],
    5,
);
assert.equal(enhanced.trustedEndTicks, 3 * second);
assert.deepEqual(
    planInstrumentalGaps([enhanced, { startTicks: 10 * second, endTicks: 12 * second, trustedEndTicks: 12 * second }]).map((gap) => [
        gap.startTicks,
        gap.endTicks,
    ]),
    [[3 * second, 10 * second]],
);
// An overlapping background vocal occupies the otherwise apparent gap.
assert.deepEqual(
    planInstrumentalGaps([
        enhanced,
        { startTicks: 2 * second, endTicks: 11 * second, trustedEndTicks: 11 * second },
        { startTicks: 10 * second, endTicks: 12 * second, trustedEndTicks: 12 * second },
    ]),
    [],
);
