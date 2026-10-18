import assert from "node:assert/strict";
import { test } from "node:test";
import { Lifecycle } from "../../shared/lifecycle.ts";
import type { AccentStatePort } from "../appearance/accent-ports.ts";
import type { ArtworkLifecyclePort } from "../appearance/ports.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import { createMediaController } from "./media-controller.ts";

function fixture() {
    const lifecycle = new Lifecycle();
    const owner = createMediaController({
        lifecycle,
        currentLyricsItemId: () => "",
        mediaItemId: () => "",
        resetPlaybackClock() {},
        readAccentMode: () => "shuffle",
        selectSongAccent() {},
        scheduleDynamicBackgroundProbeBurst: () => "",
        updateAtmospherePlaybackState() {},
        wakeAnimationLoop() {},
        get accentPort(): AccentStatePort {
            throw new Error("Clock anchoring must not access accents");
        },
        get lyricsPort(): LyricSessionStatePort {
            throw new Error("Clock anchoring must not access lyrics");
        },
        get artwork(): ArtworkLifecyclePort {
            throw new Error("Clock anchoring must not access artwork");
        },
    });
    return { owner, lifecycle };
}

test("media owners have independent private clocks and stable read-only views", () => {
    const first = fixture(),
        second = fixture();
    const media = { currentTime: 12, playbackRate: 1, paused: false, seeking: false, ended: false, readyState: 4 } as HTMLMediaElement;
    try {
        const view = first.owner.snapshot;
        first.owner.anchorClock(media, 1000);
        assert.equal(first.owner.projectMediaClock(media, 1100), 12.1);
        assert.equal(view, first.owner.snapshot);
        assert.equal(view.playbackClockSeconds, 12.1);
        assert.equal(second.owner.snapshot.playbackClockSeconds, 0);
        assert.equal(Object.isFrozen(view), true);
        assert.equal(Reflect.set(view, "playbackClockSeconds", 999), false);
        assert.equal(first.owner.snapshot.playbackClockSeconds, 12.1);
    } finally {
        first.lifecycle.dispose();
        second.lifecycle.dispose();
    }
});
