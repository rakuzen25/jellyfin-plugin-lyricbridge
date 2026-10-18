/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { readView } from "../../shared/read-view.ts";
import { LYRIC_FRAME_RECOVERY_MS, MEDIA_DISCOVERY_RETRY_MS } from "../common/settings.ts";
import type { AutoFollowPort } from "../follow/ports.ts";
import { isLyricsPage } from "../host/host.ts";
import type { HostInstallationStatePort } from "../host/ports.ts";
import type { AnimatedWord } from "../lyrics/karaoke-animation.ts";
import type { RenderGap } from "../lyrics/models.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { FrameSchedulerState } from "./frame-ports.ts";
import type { MediaStatePort } from "./media-ports.ts";

interface Dependencies {
    hostPort: HostInstallationStatePort;
    mediaPort: MediaStatePort;
    lyricsPort: LyricSessionStatePort;
    lifecycle: Lifecycle;
    getTargetFrameInterval: (media: HTMLMediaElement | null) => number;
    queueDecoration: () => boolean;
    getLocalMediaElement: (forceProbe?: boolean) => HTMLMediaElement | null;
    warn: (...args: unknown[]) => void;
    ensureMediaWakeHooks: (media: HTMLMediaElement | null) => void;
    chooseTimelineTicks: (media: HTMLMediaElement | null, frameNow: number) => number | null;
    maybeRefreshAtmosphere: (media: HTMLMediaElement | null, frameNow: number) => void;
    findLineIndexAtTicks: (ticks: number) => number;
    findInstrumentalGapAtTicks: (ticks: number) => RenderGap | null | undefined;
    findActiveLineIndexesAtTicks: (ticks: number, presentationLine: number) => number[];
    sameIndexList: (left: readonly number[] | null, right: readonly number[] | null) => boolean;
    syncStaticLineStates: (
        activeLine: number,
        activeLines: readonly number[],
        ticks: number,
        frameNow: number,
        instrumentalGap?: RenderGap | null,
    ) => void;
    queueBackgroundVocalAnchorRefresh: () => void;
    autoFollow: AutoFollowPort;
    focusLyricLineIndex: (
        lineIndex: number,
        { force, behavior, reason }?: { force?: boolean; behavior?: ScrollBehavior; reason?: string },
    ) => boolean;
    lyricPlaybackFollowIndex: (lineIndex: number) => number;
    updateInstrumentalGapVisual: (gap: RenderGap | null | undefined, ticks: number) => number;
    updateAtmospherePlaybackState: (media: HTMLMediaElement | null) => void;
    updateWordVisual: (word: AnimatedWord, timelineTicks: number, frameNow: number) => void;
    updateLineHandoffs: (ticks: number, activeLines: readonly number[]) => void;
    updateLyricSyncButton: () => void;
}

/** Owns frame scheduler behavior and its installation lifetime. */
export function createFrameScheduler(deps: Dependencies) {
    const state: FrameSchedulerState = {
        rafId: 0,
        frameTimer: 0,
        animationLoopRunning: false,
        animationLoopStarts: 0,
        animationLoopStops: 0,
        animationLoopErrors: 0,
        animationLoopRecoveries: 0,
        lastAnimationLoopError: "",
        lastMediaWarning: 0,
        performanceFrameCount: 0,
        performanceWindowStart: 0,
        measuredFps: 0,
        lastRenderedFrameAt: 0,
        forceNextFrame: false,
        pausedSettleUntil: 0,
        renderedFrameCount: 0,
        skippedRafFrames: 0,
        lineTransitionCount: 0,
        lastLineSyncCount: 0,
        maxLineSyncCount: 0,
    };
    const snapshot = readView(state);

    function updateMeasuredFps(frameNow: number) {
        if (!state.performanceWindowStart) {
            state.performanceWindowStart = frameNow;
            state.performanceFrameCount = 0;
        }

        state.performanceFrameCount += 1;

        const elapsed = frameNow - state.performanceWindowStart;

        if (elapsed >= 2000) {
            state.measuredFps = (state.performanceFrameCount * 1000) / elapsed;

            state.performanceFrameCount = 0;
            state.performanceWindowStart = frameNow;
        }
    }

    function shouldRunAnimationLoop() {
        return (
            !document.hidden &&
            !deps.hostPort.snapshot.lyricViewHidden &&
            (!(deps.mediaPort.snapshot.mediaElement?.paused || deps.mediaPort.snapshot.mediaElement?.ended) ||
                performance.now() < state.pausedSettleUntil ||
                state.forceNextFrame) &&
            !!deps.lyricsPort.snapshot.lyrics &&
            deps.lyricsPort.snapshot.lineData.length > 0 &&
            isLyricsPage()
        );
    }

    function stopAnimationLoop(reason: string = "idle") {
        const wasRunning = state.animationLoopRunning || !!state.rafId || !!state.frameTimer;

        if (state.rafId) {
            try {
                deps.lifecycle.cancelFrame(state.rafId);
            } catch {
                // Ignore incomplete embedded-browser cancellation APIs.
            }
            state.rafId = 0;
        }

        if (state.frameTimer) {
            deps.lifecycle.clearTimeout(state.frameTimer);
            state.frameTimer = 0;
        }

        state.forceNextFrame = false;
        state.animationLoopRunning = false;
        state.lastRenderedFrameAt = 0;
        state.performanceWindowStart = 0;
        state.performanceFrameCount = 0;
        state.measuredFps = 0;

        if (wasRunning) {
            state.animationLoopStops += 1;
        }

        return reason;
    }

    function markAnimationLoopRunning() {
        if (!state.animationLoopRunning) {
            state.animationLoopRunning = true;
            state.animationLoopStarts += 1;
        }
    }

    function scheduleNextFrame(media: HTMLMediaElement | null, immediate = false) {
        if (!shouldRunAnimationLoop()) {
            stopAnimationLoop("inactive");
            return;
        }

        if (immediate) {
            state.forceNextFrame = true;
        }

        if (state.rafId || state.frameTimer) {
            return;
        }

        markAnimationLoopRunning();

        const interval = immediate ? 0 : deps.getTargetFrameInterval(media);

        if (interval <= 19) {
            state.rafId = deps.lifecycle.frame(renderFrame);
            return;
        }

        const delay = Math.max(0, interval - 8);

        state.frameTimer = deps.lifecycle.timeout(() => {
            state.frameTimer = 0;

            if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("timer-inactive");
                return;
            }

            state.rafId = deps.lifecycle.frame(renderFrame);
        }, delay);
    }

    function scheduleMediaDiscoveryFrame() {
        if (!shouldRunAnimationLoop()) {
            stopAnimationLoop("media-discovery-inactive");
            return;
        }

        if (state.rafId || state.frameTimer) {
            return;
        }

        markAnimationLoopRunning();

        state.frameTimer = deps.lifecycle.timeout(() => {
            state.frameTimer = 0;

            if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("media-discovery-inactive");
                return;
            }

            state.rafId = deps.lifecycle.frame(renderFrame);
        }, MEDIA_DISCOVERY_RETRY_MS);
    }

    function wakeAnimationLoop() {
        state.pausedSettleUntil = performance.now() + 800;
        state.forceNextFrame = true;
        if (!shouldRunAnimationLoop()) {
            stopAnimationLoop("wake-inactive");
            return;
        }

        if (state.frameTimer) {
            deps.lifecycle.clearTimeout(state.frameTimer);
            state.frameTimer = 0;
        }

        scheduleNextFrame(deps.mediaPort.snapshot.mediaElement, true);
    }

    function renderFrame() {
        try {
            state.rafId = 0;

            if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("render-inactive");
                return;
            }

            const firstDecoratedLine = deps.lyricsPort.snapshot.lineData[0] && deps.lyricsPort.snapshot.lineData[0].element;

            /*
             * Full DOM ownership validation is mutation/watchdog driven so the
             * 60 fps path stays O(1). The observer invalidates
             * decoratedGeneration immediately when Jellyfin replaces children.
             */
            if (
                deps.lyricsPort.snapshot.decoratedGeneration !== deps.lyricsPort.snapshot.generation ||
                !firstDecoratedLine ||
                !firstDecoratedLine.isConnected
            ) {
                deps.lyricsPort.setDecoratedGeneration(-1);
                deps.queueDecoration();
                stopAnimationLoop("stale-lyric-dom");
                return;
            }

            const media = deps.getLocalMediaElement();

            if (!media) {
                const now = performance.now();

                if (now - state.lastMediaWarning > 5000) {
                    state.lastMediaWarning = now;

                    deps.warn("No local Jellyfin audio element found for karaoke timing.");
                }

                scheduleMediaDiscoveryFrame();
                return;
            }

            deps.ensureMediaWakeHooks(media);

            const frameNow = performance.now();

            const targetInterval = deps.getTargetFrameInterval(media);

            if (
                !state.forceNextFrame &&
                targetInterval <= 19 &&
                state.lastRenderedFrameAt &&
                frameNow - state.lastRenderedFrameAt < targetInterval - 1.25
            ) {
                state.skippedRafFrames += 1;

                scheduleNextFrame(media, false);
                return;
            }

            state.forceNextFrame = false;
            state.lastRenderedFrameAt = frameNow;
            state.renderedFrameCount += 1;

            const ticks = deps.chooseTimelineTicks(media, frameNow);

            if (ticks === null) {
                scheduleNextFrame(media, false);
                return;
            }
            updateMeasuredFps(frameNow);

            deps.maybeRefreshAtmosphere(media, frameNow);

            const timelineLine = deps.findLineIndexAtTicks(ticks);

            const instrumentalGap = deps.findInstrumentalGapAtTicks(ticks);

            const instrumentalGapIndex = instrumentalGap ? instrumentalGap.index : -1;

            /*
             * During a real instrumental break no lyric line is "current". Use
             * the upcoming line only as the neighborhood anchor so the completed
             * lyric becomes past, the next lyric stays future and the synthetic
             * note row owns the visual focus between them.
             */
            const activeLine = instrumentalGap ? instrumentalGap.nextLineIndex : timelineLine;

            let activeLines;

            if (instrumentalGap) {
                activeLines = deps.lyricsPort.resetActiveLineScratch();
            } else {
                activeLines = deps.findActiveLineIndexesAtTicks(ticks, activeLine);
            }

            const activeLineChanged = activeLine !== deps.lyricsPort.snapshot.lastActiveLine;
            const returningFromInstrumental = !instrumentalGap && deps.lyricsPort.snapshot.activeInstrumentalGapIndex >= 0;

            const activeSetChanged =
                activeLineChanged ||
                instrumentalGapIndex !== deps.lyricsPort.snapshot.activeInstrumentalGapIndex ||
                !deps.sameIndexList(activeLines, deps.lyricsPort.snapshot.activeLineIndexes);

            if (activeSetChanged) {
                deps.syncStaticLineStates(activeLine, activeLines, ticks, frameNow, instrumentalGap);
                /* Current/future scaling can change a line's measured edge.
                 * Re-anchor attached backing vocals only at line transitions,
                 * never on the steady-state frame path. */
                deps.queueBackgroundVocalAnchorRefresh();

                /* Diagnostics keep a human-readable signature, but build it only
                 * when the active set changes instead of allocating every frame. */
                deps.lyricsPort.setLastActiveLineSignature(activeLines.join(","));
                deps.lyricsPort.setActiveLineIndexes(activeLines.slice());

                if ((activeLineChanged || returningFromInstrumental) && !instrumentalGap && activeLine >= 0) {
                    // During the break the upcoming line is only a fade anchor.
                    // It still needs a fresh scroll when singing resumes.
                    if (returningFromInstrumental) deps.autoFollow.invalidateTarget();
                    const generation = deps.lyricsPort.snapshot.generation;
                    deps.lifecycle.frame(() => {
                        if (
                            generation !== deps.lyricsPort.snapshot.generation ||
                            activeLine !== deps.lyricsPort.snapshot.lastActiveLine ||
                            deps.hostPort.snapshot.lyricViewHidden
                        )
                            return;
                        deps.focusLyricLineIndex(deps.lyricPlaybackFollowIndex(activeLine), {
                            force: false,
                            behavior: "smooth",
                            reason: "playback-follow",
                        });
                    });
                }
            }

            deps.updateInstrumentalGapVisual(instrumentalGap, ticks);

            deps.updateAtmospherePlaybackState(media);

            if (activeLines.length > 1) {
                deps.lyricsPort.setOverlapFrameCount(deps.lyricsPort.snapshot.overlapFrameCount + 1);
            }

            deps.lyricsPort.setMaxSimultaneousLines(Math.max(deps.lyricsPort.snapshot.maxSimultaneousLines, activeLines.length));

            activeLines.forEach((lineIndex: number) => {
                const current = deps.lyricsPort.snapshot.lineData[lineIndex];

                if (!current) return;

                (current.words || []).forEach((word) => {
                    deps.updateWordVisual(word, ticks, frameNow);
                });
            });

            deps.updateLineHandoffs(ticks, instrumentalGap ? [] : activeLines);

            deps.updateLyricSyncButton();
            scheduleNextFrame(media, false);
        } catch (error) {
            state.rafId = 0;
            state.animationLoopErrors += 1;
            state.lastAnimationLoopError = String(
                error instanceof Error ? error.stack || error.message : String(error || "unknown render error"),
            ).slice(0, 1200);
            deps.warn("Lyric visual frame failed; scheduling recovery:", error);

            /* Background work must never be able to permanently kill ELRC
             * sweep/glow or the instrumental liquid fill. One failed frame is
             * isolated and the lyric loop is restarted on a short timer. */
            if (shouldRunAnimationLoop() && !state.frameTimer) {
                state.animationLoopRecoveries += 1;
                state.frameTimer = deps.lifecycle.timeout(() => {
                    state.frameTimer = 0;
                    wakeAnimationLoop();
                }, LYRIC_FRAME_RECOVERY_MS);
            } else if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("frame-error-inactive");
            }
        }
    }

    function ensureAnimationLoop() {
        if (!shouldRunAnimationLoop()) {
            stopAnimationLoop("ensure-inactive");
            return false;
        }

        scheduleNextFrame(deps.mediaPort.snapshot.mediaElement, true);
        return true;
    }
    return {
        snapshot,
        setForceNextFrame(value: boolean): void {
            state.forceNextFrame = value;
        },
        setLineTransitionCount(value: number): void {
            state.lineTransitionCount = value;
        },
        setLastLineSyncCount(value: number): void {
            state.lastLineSyncCount = value;
        },
        setMaxLineSyncCount(value: number): void {
            state.maxLineSyncCount = value;
        },
        setLastRenderedFrameAt(value: number): void {
            state.lastRenderedFrameAt = value;
        },
        updateMeasuredFps,
        shouldRunAnimationLoop,
        stopAnimationLoop,
        markAnimationLoopRunning,
        scheduleNextFrame,
        scheduleMediaDiscoveryFrame,
        wakeAnimationLoop,
        renderFrame,
        ensureAnimationLoop,
    };
}
