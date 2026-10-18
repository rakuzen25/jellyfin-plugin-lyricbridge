/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { readView } from "../../shared/read-view.ts";
import type { AccentStatePort } from "../appearance/accent-ports.ts";
import type { ArtworkLifecyclePort } from "../appearance/ports.ts";
import type { LyricInput } from "../lyrics/payload.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { MediaState } from "./media-ports.ts";
import { projectClock, resetClock } from "./playback-clock.ts";

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
interface Dependencies {
    currentLyricsItemId: () => string;
    mediaItemId: (media: HTMLMediaElement | null) => string;
    accentPort: AccentStatePort;
    lyricsPort: LyricSessionStatePort;
    resetPlaybackClock: (media?: HTMLMediaElement | null, frameNow?: number) => void;
    readAccentMode: () => string;
    selectSongAccent: (lyrics: LyricInput[], force?: boolean, reason?: string) => void;
    artwork: ArtworkLifecyclePort;
    scheduleDynamicBackgroundProbeBurst: (source?: string) => string;
    updateAtmospherePlaybackState: (media: HTMLMediaElement | null) => void;
    wakeAnimationLoop: () => void;
    lifecycle: Lifecycle;
}

/** Owns media controller behavior and its installation lifetime. */
export function createMediaController(deps: Dependencies) {
    const state: MediaState = {
        mediaElement: null,
        mediaProbeAt: 0,
        mediaSwitchCount: 0,
        staleMediaEventDrops: 0,
        playbackClockMedia: null,
        playbackClockSeconds: 0,
        playbackClockRawSeconds: 0,
        playbackClockFrameNow: 0,
        playbackClockCorrectionMs: 0,
        playbackClockHardSnaps: 0,
        playbackClockSuspended: false,
        mediaStartOffsetSource: "",
        mediaStartOffsetTicks: 0,
    };
    const snapshot = readView(state);

    let hookedMedia: HTMLMediaElement | null = null;

    const mediaWakeReleases: (() => void)[] = [];

    function mediaElementScore(element: HTMLMediaElement) {
        if (!element || !element.isConnected) {
            return -Infinity;
        }

        let score = 0;
        const classList = element.classList;

        if (classList && (classList.contains("mediaPlayerAudio") || classList.contains("mediaPlayerVideo"))) {
            score += 40;
        }

        if (element.currentSrc || element.src) {
            score += 22;
        }

        if (!element.paused && !element.ended) {
            score += 18;
        }

        if (Number(element.readyState) >= 2) {
            score += 8;
        }

        if ((Number(element.currentTime) || 0) > 0) {
            score += 2;
        }

        const expectedItemId = deps.currentLyricsItemId();
        const candidateItemId = deps.mediaItemId(element).toLowerCase();
        if (expectedItemId && candidateItemId) {
            score += candidateItemId === expectedItemId ? 90 : -45;
        }

        if (element === state.mediaElement) {
            score += 1;
        }

        return score;
    }

    function getLocalMediaElement(forceProbe = false) {
        const cached = state.mediaElement;

        const now = performance.now();

        if (!forceProbe && cached && cached.isConnected && now < state.mediaProbeAt) {
            return cached;
        }

        state.mediaProbeAt = now + 1000;

        const candidates: HTMLMediaElement[] = [];
        const addCandidate = (element: HTMLMediaElement | null) => {
            if (element && !candidates.includes(element)) {
                candidates.push(element);
            }
        };

        addCandidate(document.querySelector<HTMLMediaElement>(".mediaPlayerAudio"));
        addCandidate(document.querySelector<HTMLMediaElement>(".mediaPlayerVideo"));

        Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).forEach(addCandidate);

        if (cached && cached.isConnected) {
            addCandidate(cached);
        }

        let media = null;
        let bestScore = -Infinity;

        candidates.forEach((candidate) => {
            const score = mediaElementScore(candidate);

            if (score > bestScore) {
                bestScore = score;
                media = candidate;
            }
        });

        if (media !== cached) {
            releaseMediaWakeHooks();
            state.mediaElement = media;
            state.mediaProbeAt = now + 1000;
            state.mediaStartOffsetSource = "";
            state.mediaStartOffsetTicks = 0;
            state.mediaSwitchCount += 1;
            deps.resetPlaybackClock(media, now);
        }

        if (media) {
            ensureMediaWakeHooks(media);
        }

        return media;
    }

    function getStartTimeTicksFromUrl(media: HTMLMediaElement | null) {
        try {
            const src = requireValue(media).currentSrc || requireValue(media).src;
            if (!src) return 0;

            if (src === state.mediaStartOffsetSource) {
                return state.mediaStartOffsetTicks;
            }

            const url = new URL(src, location.href);
            const value = url.searchParams.get("StartTimeTicks") || url.searchParams.get("startTimeTicks");
            const parsed = Number(value);

            state.mediaStartOffsetSource = src;
            state.mediaStartOffsetTicks = isFiniteNumber(parsed) && parsed > 0 ? Math.min(parsed, Number.MAX_SAFE_INTEGER) : 0;

            return state.mediaStartOffsetTicks;
        } catch {
            return 0;
        }
    }

    function releaseMediaWakeHooks() {
        for (const release of mediaWakeReleases) release();
        mediaWakeReleases.length = 0;
        if (hookedMedia) delete hookedMedia.dataset.akPerfHooks;
        hookedMedia = null;
    }

    function ensureMediaWakeHooks(media: HTMLMediaElement | null) {
        if (!media || hookedMedia === media) return;
        releaseMediaWakeHooks();
        hookedMedia = media;
        media.dataset.akPerfHooks = "true";

        const handleMediaWake = (event: Event) => {
            const type = event && event.type;

            if (state.mediaElement && state.mediaElement !== media && state.mediaElement.isConnected) {
                state.staleMediaEventDrops += 1;
                return;
            }

            if (!media.isConnected && state.mediaElement !== media) {
                state.staleMediaEventDrops += 1;
                return;
            }

            if (type === "ended") {
                deps.accentPort.setAccentReplayArmed(true);
            } else if (type === "emptied") {
                deps.accentPort.setAccentReplayArmed(false);
            } else if ((type === "play" || type === "playing") && deps.accentPort.snapshot.accentReplayArmed) {
                const replayedFromStart = (Number(media.currentTime) || 0) < 2;

                deps.accentPort.setAccentReplayArmed(false);

                if (replayedFromStart && deps.lyricsPort.snapshot.lyrics && deps.readAccentMode() === "shuffle") {
                    deps.selectSongAccent(deps.lyricsPort.snapshot.lyrics, true, "replay");
                }
            }

            if (type === "waiting" || type === "stalled" || type === "seeking" || type === "emptied") {
                state.playbackClockSuspended = true;
            } else if (type === "play" || type === "playing" || type === "canplay" || type === "seeked" || type === "loadedmetadata") {
                state.playbackClockSuspended = false;
            }

            if (type === "loadedmetadata" || type === "emptied" || type === "durationchange") {
                state.mediaProbeAt = 0;
            }

            if (type === "loadedmetadata" || type === "playing" || type === "canplay" || type === "emptied") {
                deps.artwork.requestRefresh();
                deps.scheduleDynamicBackgroundProbeBurst(`media-${type}`);
            }

            const replayFromBeginning = (type === "play" || type === "playing") && (Number(media.currentTime) || 0) < 0.75;

            const frameNow = performance.now();

            if (type === "seeking" || type === "seeked" || type === "loadedmetadata" || type === "emptied" || replayFromBeginning) {
                deps.lyricsPort.setLastActiveLine(-999);
                deps.lyricsPort.setLastActiveLineSignature("");
                deps.lyricsPort.setActiveLineIndexes([]);
            }

            if (type !== "timeupdate") {
                deps.resetPlaybackClock(media, frameNow);
            }

            if (type !== "timeupdate") deps.updateAtmospherePlaybackState(media);
            if (type !== "timeupdate" || !media.paused) deps.wakeAnimationLoop();
        };

        for (const eventName of [
            "play",
            "playing",
            "pause",
            "waiting",
            "stalled",
            "canplay",
            "seeking",
            "seeked",
            "timeupdate",
            "loadedmetadata",
            "durationchange",
            "ratechange",
            "ended",
            "emptied",
        ] as const) {
            mediaWakeReleases.push(
                deps.lifecycle.on(media, eventName, handleMediaWake, {
                    passive: true,
                }),
            );
        }
    }
    return {
        anchorClock(media: HTMLMediaElement | null, frameNow: number) {
            resetClock(state, media, frameNow);
        },
        projectMediaClock(media: HTMLMediaElement, frameNow: number) {
            return projectClock(state, media, frameNow);
        },
        snapshot,
        getLocalMediaElement,
        getStartTimeTicksFromUrl,
        releaseMediaWakeHooks,
        ensureMediaWakeHooks,
    };
}
