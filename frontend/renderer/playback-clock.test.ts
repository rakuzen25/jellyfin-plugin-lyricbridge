import { test } from "node:test";
import assert from "node:assert/strict";
import { projectClock, resetClock } from "./playback-clock.ts";
import type { PlaybackClockState, ClockMedia } from "./playback-clock.ts";
import { rows } from "../shared/lyrics.ts";

test("clock anchors pauses, seeks and media replacement without stale projection", () => {
    const media: ClockMedia = { currentTime: 10, playbackRate: 1, paused: false, seeking: false, ended: false, readyState: 4 };
    const state: PlaybackClockState = {
        playbackClockMedia: null,
        playbackClockSeconds: 0,
        playbackClockRawSeconds: 0,
        playbackClockFrameNow: 0,
        playbackClockCorrectionMs: 0,
        playbackClockSuspended: false,
        playbackClockHardSnaps: 0,
    };
    resetClock(state, media, 1000);
    assert.equal(projectClock(state, media, 1100), 10.1);
    media.paused = true;
    assert.equal(projectClock(state, media, 1200), 10);
    media.paused = false;
    media.seeking = true;
    media.currentTime = 2;
    assert.equal(projectClock(state, media, 1300), 2);
    media.seeking = false;
    const replacement = { ...media, currentTime: 40 };
    assert.equal(projectClock(state, replacement, 1400), 40);
    state.playbackClockSuspended = true;
    replacement.currentTime = 45;
    assert.equal(projectClock(state, replacement, 1500), 45);
});
test("native background markers offset UTF-16 cue boundaries without changing originals", () => {
    const line = {
        id: "main",
        text: "朝",
        start: 20,
        cues: [{ position: 0, endPosition: 1, start: 20 }],
        background: { id: "bg", text: "😀声", start: 10, cues: [{ position: 0, endPosition: 2, start: 10 }] },
    };
    const original = JSON.stringify(line);
    const output = rows({ hash: "fixture", lines: [line] });
    assert.equal(output[0]?.LyricBridgeId, "bg");
    assert.equal(output[0]?.Text, "[ak:bg]😀声");
    assert.equal(output[0]?.Cues[0]?.Position, 7);
    assert.equal(output[0]?.Cues[0]?.EndPosition, 9);
    assert.equal(JSON.stringify(line), original);
});
