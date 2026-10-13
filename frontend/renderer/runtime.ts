import { requireValue } from "../shared/invariants.ts";
import type {} from "../shared/runtime.ts";
import { createAccentController } from "./accent-controller.ts";
import { createArtworkController } from "./artwork-controller.ts";
import { createControlsPreferences } from "./controls-preferences.ts";
import type { CueInput } from "./cue-ranges.ts";
import type { GeometryWord } from "./geometry.ts";
import { createLyricView } from "./lyric-view.ts";
import type { CueRecord, RenderGap, RenderSegment, RenderWord } from "./models.ts";
import type { LyricInput } from "./payload.ts";
import { createPlaybackCoordinator } from "./playback-coordinator.ts";
import { createPronunciationController } from "./pronunciation-controller.ts";
import { createSongPreferences } from "./song-preferences.ts";
import type { RendererState } from "./state.ts";
function eventElement(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target : null;
}
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

import { ArtworkLoader } from "./artwork-loader.ts";
import { replaceChildren, setText } from "./dom.ts";
import { BASE_WIPE_GRADIENT_EM, createWordGeometry } from "./geometry.ts";
import { detectStockJellyfinTvEnvironment, getCurrentLyricPage, getCurrentLyricsContainer, isLyricsPage, isLyricsUrl, ROUTE_RE } from "./host.ts";
import { createKaraokeAnimation, WORD_PROGRESS_SMOOTH_TAU_MS } from "./karaoke-animation.ts";
import { RendererLifecycle } from "./lifecycle.ts";
import { clamp01 } from "./motion.ts";
import { cueValue, lyricPayloadIdentity, lyricTimingMode, normalizeLyricsPayload, usableEnhancedCueCount } from "./payload.ts";
import { projectClock, resetClock } from "./playback-clock.ts";
import { detectScriptProfile, firstStrongDirection, getGraphemeRanges, getWordRanges, usesWholeShapedMotion } from "./text-processing.ts";
import { nullableTick } from "./ticks.ts";
import { planInstrumentalGaps, calculateLineBounds as timelineBounds } from "./timeline.ts";
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Jellyfin LyricMotion - unofficial Jellyfin Web lyrics enhancement.
 */
export function installRenderer() {
    "use strict";

    const VERSION = __LYRICBRIDGE_VERSION__;

    /*
     * A duplicated script tag used to create a second DOM observer, route-hook
     * set and animation scheduler even though fetch/XHR wrapping was guarded.
     * Fail closed if LyricMotion is already alive in this page.
     */
    const existingRuntime = window.JellyfinLyricMotion;

    if (existingRuntime && existingRuntime.version) {
        console.warn("[JellyfinLyricMotion]", `duplicate runtime ignored; active version ${existingRuntime.version}`);
        return;
    }

    /*
     * TV POLICY: stock Jellyfin only.
     *
     * LyricMotion is intentionally a desktop/mobile enhancement. Every TV or
     * ten-foot client we can identify exits before network interception, DOM
     * observation, media hooks, styling, atmosphere or animation is installed.
     * Jellyfin therefore owns the complete TV lyrics experience.
     *
     * Keep this detector dependency-free so unsupported TV clients exit
     * before desktop/mobile integration is installed.
     */
    const stockTvEnvironment = detectStockJellyfinTvEnvironment();

    if (stockTvEnvironment.detected) {
        const stockTvApi = Object.freeze({
            version: VERSION,
            enabled: false,
            platform: "tv",
            renderer: "stock-jellyfin",
            reason: "tv-stock-bypass",
            tvFamily: stockTvEnvironment.family,
        });

        window.JellyfinLyricMotion = stockTvApi;

        console.info("[JellyfinLyricMotion]", `v${VERSION}: ${stockTvEnvironment.family} detected; using stock Jellyfin lyrics`);
        return;
    }

    let renderQuality: "standard" | "low-power" = "standard";
    try {
        if (localStorage.getItem("lyricbridge.renderer.quality") === "low-power") renderQuality = "low-power";
    } catch {
        /* unavailable storage */
    }
    let acceptedOriginalIdentity = "",
        acceptedOriginalTrack = "";
    const lifecycle = new RendererLifecycle();
    let hookedMedia: HTMLMediaElement | null = null;
    const mediaWakeReleases: (() => void)[] = [];
    lifecycle.own(() => releaseMediaWakeHooks());
    const artworkLoader = new ArtworkLoader(
        () => new Image(),
        () => state.atmosphereTimeoutCount++,
    );
    lifecycle.own(() => artworkLoader.dispose());
    const TICKS_PER_SECOND = 10000000;
    const INSTRUMENTAL_GAP_MIN_TICKS = 2 * TICKS_PER_SECOND;
    const INSTRUMENTAL_GAP_SYMBOL = "♪";
    const SVG_NS = "http://www.w3.org/2000/svg";
    const INSTRUMENTAL_NOTE_VIEWBOX_WIDTH = 64;
    const INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT = 80;
    const INSTRUMENTAL_GAP_PROGRESS_EPSILON = 0.001;
    const INSTRUMENTAL_WAVE_PERIOD_SECONDS = 1.35;
    const INSTRUMENTAL_WAVE_MAX_AMPLITUDE = 2.35;
    const INSTRUMENTAL_WAVE_SEGMENTS = 20;
    const LYRIC_VISUAL_WATCHDOG_MS = 700;
    const LYRIC_FRAME_RECOVERY_MS = 36;

    let reducedMotionMediaQuery: MediaQueryList | null = null;

    /*
     * Jellyfin's lyric parser can discard Unicode format controls.  The ASCII
     * transport token survives the complete TTML -> ELRC -> Jellyfin path and
     * is removed before the lyric is painted.  The old invisible marker is
     * still accepted so existing local files do not break.
     */

    const UNIFIED_RENDERER_SIGNATURE = "unified-pc-mobile-v3:60fps:multiscript-shaped-wipe:classic-bloom64:atmo-dynamic-kawarp-v325-hotfix";

    // Display-only lyric wipe smoothing.
    // Behaviour adapted from the current am-lyrics renderer.
    const SHORT_WORD_GLOW_MIN_DURATION_MS = 1320;
    const LINE_CLASS_NEIGHBORHOOD = 6;

    /*
     * Phase-locked lyric clock.
     *
     * Some embedded media engines expose currentTime in visible steps even
     * while requestAnimationFrame is healthy. Between trustworthy media-clock
     * samples we advance a monotonic projection, then gently phase-correct it
     * when currentTime moves again. Large jumps still snap immediately.
     */

    // Dynamic Background is the only atmosphere engine in God Mode.
    // It is presentation-only and never changes lyric timing.
    const ATMOSPHERE_ART_MAX_WIDTH = 720;
    const DYNAMIC_BACKGROUND_SOURCE = "chengggit Dynamic Background 3.2.4 + Better Lyrics Kawarp";
    const DYNAMIC_BACKGROUND_ENGINE = "kawarp-domain-warp-hardened";
    const DYNAMIC_BACKGROUND_TRANSITION_MS = 260;
    const DYNAMIC_BACKGROUND_DOM_STABLE_MS = 900;
    const DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS = 1500;
    const DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS = 0;
    const DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS = 0;
    const DYNAMIC_BACKGROUND_DIRECT_GRACE_MS = 700;
    const DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS = 900;
    const DYNAMIC_BACKGROUND_WEAK_RECHECK_MS = 12000;
    const DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS = 2500;
    const DYNAMIC_BACKGROUND_NO_ART_RETRY_MS = 10000;
    const DYNAMIC_BACKGROUND_DIRECT_RETRY_MS = 1500;
    const DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS = 30000;
    const DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS = 300000;
    const DYNAMIC_BACKGROUND_SETTINGS = Object.freeze({
        opacity: 0.75,
        warpIntensity: 1.0,
        blurPasses: 8,
        blurSize: 128,
        animationSpeed: 1.8,
        transitionDuration: DYNAMIC_BACKGROUND_TRANSITION_MS,
        saturation: 1.7,
        dithering: 0,
        tintColor: [0.157, 0.157, 0.235],
        tintIntensity: 0.15,
        scale: 1.0,
        audioResponsive: false,
        pauseOnInactive: true,
    });

    const PERFORMANCE_STORAGE_KEY = "lyricbridge.renderer.performance";

    // PC/mobile-only Google Romanization. Requests begin only after the user
    // selects Romanized view for a native-script song.
    const SONG_PREFERENCES_STORAGE_KEY = "lyricbridge.renderer.songs";
    const GOOGLE_ROMANIZATION_CACHE_MAX_ENTRIES = 1800;
    const GOOGLE_ROMANIZATION_MAX_TEXT_CHARS = 1500;
    const GOOGLE_ROMANIZATION_MAX_RETRIES = 3;
    const GOOGLE_ROMANIZATION_RETRY_DELAY_MS = 1000;
    const GOOGLE_ROMANIZATION_TIMEOUT_MS = 6000;
    const GOOGLE_ROMANIZATION_CONCURRENCY = 3;

    // Per-timeline display synchronization. Positive values delay the lyrics;
    // negative values make lyrics appear earlier. The permanent UI is one
    // compact timing chip; its popover keeps ±0.1 s nudging, one-tap word/line
    // synchronization and Reset out of the main lyric view.
    const TIMING_OFFSET_FINE_STEP_SECONDS = 0.1;
    const TIMING_OFFSET_STEP_SECONDS = 0.5;
    const TIMING_OFFSET_MIN_SECONDS = -15;
    const TIMING_OFFSET_MAX_SECONDS = 15;
    const SONG_PREFERENCES_MAX_ENTRIES = 300;

    const PERFORMANCE_TARGET_FPS = Object.freeze({
        desktop: 60,
        mobile: 60,
    });

    /*
     * Normal LRC only changes at line boundaries, so 20 fps is still very
     * cheap with the active-line-only renderer while cutting worst-case visual
     * line-transition latency from ~100 ms to ~50 ms.
     */
    const LRC_TARGET_FPS = 20;
    const PAUSED_TARGET_FPS = 2;

    /*
     * Lifecycle guards. Decoration retries are deliberately bounded and only
     * exist while a live lyrics route + captured payload are waiting for
     * Jellyfin's DOM. Outside the lyrics page the animation loop is fully
     * dormant instead of polling the whole SPA forever.
     */
    const DECORATION_RETRY_MS = 120;
    const DECORATION_RETRY_WINDOW_MS = 6000;
    const MEDIA_DISCOVERY_RETRY_MS = 250;
    const ATMOSPHERE_IMAGE_TIMEOUT_MS = 6500;

    /*
     * User-requested premium glow palette.
     *
     * IMPORTANT:
     * These colors are used ONLY by the glyph-shaped shadow produced by the
     * am-lyrics-style grow animation. The lyric text and lyric wipe stay white.
     */
    const ACCENT_STORAGE_KEY = "lyricbridge.renderer.accent";

    const ACCENT_HISTORY_STORAGE_KEY = "lyricbridge.renderer.recentAccents";

    /*
     * Compact five-color OLED palette. Each selection keeps a clean primary
     * edge and a complementary outer bloom instead of making every shadow the
     * same hue.
     */
    const PREMIUM_ACCENTS = Object.freeze([
        { id: "ruby", name: "Ruby", rgb: "255, 62, 102", secondaryRgb: "255, 112, 72", tertiaryRgb: "226, 78, 255", gain: 0.99 },
        { id: "solar-yellow", name: "Solar Yellow", rgb: "255, 232, 62", secondaryRgb: "255, 142, 48", tertiaryRgb: "48, 242, 220", gain: 0.49 },
        { id: "emerald", name: "Emerald", rgb: "48, 246, 158", secondaryRgb: "52, 255, 214", tertiaryRgb: "148, 94, 255", gain: 0.55 },
        { id: "sapphire", name: "Sapphire Blue", rgb: "66, 136, 255", secondaryRgb: "72, 222, 255", tertiaryRgb: "255, 92, 194", gain: 0.82 },
        { id: "electric-violet", name: "Electric Violet", rgb: "152, 76, 255", secondaryRgb: "82, 172, 255", tertiaryRgb: "72, 255, 228", gain: 1.0 },
    ]);
    const NEUTRAL_ACCENT = Object.freeze({
        id: "neutral-fallback",
        name: "Neutral Fallback",
        rgb: "214, 226, 255",
        secondaryRgb: "196, 180, 255",
        tertiaryRgb: "255, 214, 238",
        gain: 0.72,
    });

    const state: RendererState = {
        lyrics: null,
        generation: 0,
        decoratedGeneration: -1,
        lyricsRequestSeq: 0,
        lyricsRequestKey: "",
        lyricsRequestKeys: new Map(),
        lyricsAcceptedKey: "",
        lyricsAcceptedSeq: 0,
        lyricsStaleResponseDrops: 0,
        lineData: [],
        rafId: 0,
        frameTimer: 0,
        animationLoopRunning: false,
        animationLoopStarts: 0,
        animationLoopStops: 0,
        animationLoopErrors: 0,
        animationLoopRecoveries: 0,
        animationWatchdogRecoveries: 0,
        animationWatchdogTimer: 0,
        lastAnimationLoopError: "",
        lastMediaWarning: 0,
        geometryTimer: 0,
        backgroundAnchorTimer: 0,
        decorationRetryStartedAt: 0,
        decorationRetryCount: 0,
        decorationRetryExpiredCount: 0,
        lastActiveLine: -999,
        lastActiveLineSignature: "",
        activeLineIndexes: [],
        activeLineScratch: [],
        handoffLineIndexes: new Set(),
        retiredLineElements: [],
        lineEndPrefix: [],
        instrumentalGaps: [],
        activeInstrumentalGapIndex: -1,
        instrumentalPhaseActiveIndex: -1,
        instrumentalPastCount: 0,
        instrumentalGapRenderCount: 0,
        instrumentalGapMaxDurationTicks: 0,
        mediaElement: null,
        mediaProbeAt: 0,
        mediaSwitchCount: 0,
        staleMediaEventDrops: 0,
        timedCueCount: 0,
        lyricTimingMode: "none",
        backgroundVocalCount: 0,
        overlapFrameCount: 0,
        maxSimultaneousLines: 1,

        performanceMode: "auto",
        performanceProfile: "desktop",
        performanceFrameCount: 0,
        performanceWindowStart: 0,
        measuredFps: 0,
        lastRenderedFrameAt: 0,
        forceNextFrame: false,
        pausedSettleUntil: 0,
        lyricViewHidden: false,
        renderedFrameCount: 0,
        watchdogLineCursor: 0,
        skippedRafFrames: 0,
        lineTransitionCount: 0,
        lastLineSyncCount: 0,
        maxLineSyncCount: 0,
        playbackClockMedia: null,
        playbackClockSeconds: 0,
        playbackClockRawSeconds: 0,
        playbackClockFrameNow: 0,
        playbackClockCorrectionMs: 0,
        playbackClockHardSnaps: 0,
        playbackClockSuspended: false,
        mediaStartOffsetSource: "",
        mediaStartOffsetTicks: 0,

        accentMode: "shuffle",
        accent: null,
        accentSignature: "",
        accentHistory: [],
        accentBag: [],
        accentRandomSource: "math-random",
        accentSelectionReason: "initial",
        accentReplayArmed: false,

        shapedWordCount: 0,
        scriptProfileCounts: {},
        fontGeometryRefreshCount: 0,

        romanizationMode: "native",
        romanizationAvailable: false,
        romanizationCandidate: false,
        romanizationLoadState: "idle",
        romanizationLoadError: "",
        romanizationSource: "none",
        romanizationToggle: null,
        googleRomanizationCache: new Map(),
        googleRomanizationFragmentCache: new Map(),
        googleRomanizationAttempted: new Set(),
        googleRomanizationRequest: null,
        googleRomanizationState: "idle",
        googleRomanizationError: "",
        googleRomanizationLineCount: 0,
        romanizationLineCount: 0,
        romanizationToggleCount: 0,

        songPreferenceKey: "",
        songPreferences: Object.create(null),
        lyricToolsHost: null,
        lyricToolsBar: null,
        timingControls: null,
        timingPopover: null,
        timingPopoverDismissInstalled: false,
        timingOffsetSeconds: 0,
        sharedTimingOffsetSeconds: 0,
        timingOffsetChangeCount: 0,
        timingPickActive: false,
        timingUndo: null,
        timingPickListenerInstalled: false,
        lyricSeekInteractionInstalled: false,
        lyricAutoFollowInstalled: false,
        lyricAutoFollowSuspendedUntil: 0,
        lyricAutoFollowLastIndex: -1,
        lyricAutoFollowLastAt: 0,
        lyricAutoFollowScroller: null,
        lyricAutoFollowTargetTop: null,
        lyricAutoFollowBehavior: null,
        lyricAutoFollowScrollCount: 0,
        lyricAutoFollowManualScrollCount: 0,
        lyricAutoFollowForceCount: 0,
        lyricAutoFollowLastReason: "",
        lyricStockAutoFollowSuppressCount: 0,
        lyricStockAutoFollowLastReason: "",
        lyricSeekCount: 0,
        instrumentalSeekCount: 0,
        lastLyricSeekKind: "",
        lastLyricSeekSourceTicks: null,
        lastLyricSeekMediaSeconds: null,

        // Dynamic Background state. This build intentionally has one atmosphere engine.
        atmosphereMode: "dynamic",
        atmosphereRoot: null,
        atmosphereMediaKey: "",
        atmosphereArtwork: "",
        atmosphereSource: "none",
        atmosphereLastCheck: 0,
        atmosphereLoadSeq: 0,
        atmospherePendingKey: "",
        atmospherePendingSince: 0,
        atmosphereTimeoutCount: 0,
        atmosphereFailedKey: "",
        atmosphereFailedAt: 0,
        atmosphereAnalysis: null,
        atmosphereDynamicRenderer: null,
        atmosphereDynamicCanvas: null,
        atmosphereDynamicBaseIndex: 0,
        atmosphereDynamicCurrentArtwork: "",
        atmosphereDynamicCurrentFingerprint: null,
        atmosphereDynamicVisualDedupCount: 0,
        atmosphereDynamicFingerprintFailures: 0,
        atmosphereDynamicIdentityMethod: "none",
        atmosphereDynamicWebglAvailable: null,
        atmosphereDynamicFallbackReason: "",
        atmosphereDynamicContextLossCount: 0,
        atmosphereDynamicTransitionCount: 0,
        atmosphereDynamicInterruptedTransitions: 0,
        atmosphereDynamicResizeCount: 0,
        atmosphereDynamicStaleCommitDrops: 0,
        atmosphereDynamicDirectLoadFailures: 0,
        atmosphereDynamicDomFallbackCommits: 0,
        atmosphereDynamicDirectRetryAt: 0,
        atmosphereDynamicWeakSource: false,
        atmosphereDynamicResolvedKey: "",
        atmosphereDynamicResolvedAt: 0,
        atmosphereDynamicNoArtwork: false,
        atmosphereDynamicNoArtFailures: 0,
        atmosphereDynamicDomBaseline: new Set(),
        atmosphereDynamicDomCandidateSinceByUrl: new Map(),
        atmosphereDynamicFastInheritedCommits: 0,
        atmosphereDynamicMediaStableSince: 0,
        atmosphereDynamicWebglFailureCount: 0,
        atmosphereDynamicWebglRetryAt: 0,
        atmosphereDynamicProbeToken: 0,
        atmosphereDynamicProbeTimers: [],
    };

    function log(...args: unknown[]) {
        console.log("[JellyfinLyricMotion]", ...args);
    }

    function warn(...args: unknown[]) {
        console.warn("[JellyfinLyricMotion]", ...args);
    }

    function cueRecordStart(record: CueRecord) {
        return nullableTick(cueValue(record.cue, "Start", "start")) ?? 0;
    }

    function buildWordRecords(text: string, lineIndex: number, cueRecords: CueRecord[]): RenderWord[] {
        const ranges = getWordRanges(text, cueRecords);

        return ranges.map((range, wordIndex) => {
            const wordLength = Math.max(1, range.end - range.start);
            const segments: RenderSegment[] = [];

            cueRecords.forEach((record, cueIndex) => {
                const overlapStart = Math.max(range.start, record.startPos);
                const overlapEnd = Math.min(range.end, record.endPos);

                if (overlapEnd <= overlapStart) return;

                const start = isFiniteNumber(record.start) ? record.start : cueRecordStart(record);

                const end = isFiniteNumber(record.end) ? record.end : cueEndTicks(lineIndex, cueIndex, record.cue, cueRecords);

                segments.push({
                    cueIndex,
                    startPos: overlapStart - range.start,
                    endPos: overlapEnd - range.start,
                    start,
                    end,
                });
            });

            segments.sort((a, b) => {
                if (a.startPos !== b.startPos) return a.startPos - b.startPos;
                return a.start - b.start;
            });

            /*
             * The word itself is one shaped DOM span. Cue boundaries only
             * control the progress math. Extend the outermost segment to the
             * word edges so punctuation/combining ink never pops in at the
             * final frame.
             */
            if (segments.length) {
                requireValue(segments[0]).startPos = 0;
                requireValue(segments[segments.length - 1]).endPos = wordLength;

                for (let i = 0; i < segments.length - 1; i += 1) {
                    const left = segments[i];
                    const right = segments[i + 1];
                    const boundary = Math.max(
                        requireValue(left).startPos,
                        Math.min(wordLength, (requireValue(left).endPos + requireValue(right).startPos) / 2),
                    );

                    requireValue(left).endPos = boundary;
                    requireValue(right).startPos = boundary;
                }
            }

            const start = segments[0]?.start ?? Number.NaN;
            const end = segments.length ? Math.max(...segments.map((segment) => segment.end)) : Number.NaN;

            const scriptProfile = detectScriptProfile(range.text);

            return {
                lineIndex,
                wordIndex,
                text: range.text,
                startPos: range.start,
                endPos: range.end,
                length: wordLength,
                segments,
                start,
                end,
                scriptProfile,
                paintMode: usesWholeShapedMotion(scriptProfile) ? "shaped" : "spatial",
                isRtl: firstStrongDirection(range.text) === "rtl",
                element: null,
                visualProgress: 0,
                lastPaintAt: Number.NaN,
                motionMode: "none",
                motionGlow: false,
                motionDurationMs: 0,
                motionGlyphs: [],
                wholeMotion: null,
                geometryReady: false,
                geometrySource: "unprepared",
            };
        });
    }

    function visibleWordLength(word: GeometryWord) {
        if (!word || !word.text) return 0;

        return getGraphemeRanges(word.text).filter((range) => /\S/u.test(range.text)).length;
    }

    function canUseGraphemeMotionOverlay(word: RenderWord) {
        if (!word) return false;

        const compact = String(word.text || "").replace(/\s+/g, "");

        if (!compact) return false;

        /* Explicit join controls mean that visual shaping can cross the
         * Unicode grapheme boundary. Keep those words intact. */
        if (compact.indexOf("\u200c") >= 0 || compact.indexOf("\u200d") >= 0) {
            return false;
        }

        /* Arabic-family joining and unknown complex scripts must remain one
         * shaped run. Indic/Dravidian/Bengali/Thai/etc. are safe here because
         * getGraphemeRanges() refuses boundaries after viramas, before marks,
         * inside Hangul clusters or across join controls. That lets an entire
         * akshara/grapheme receive the exact same staggered Classic Bloom used
         * by Latin without splitting conjuncts or vowel marks. */
        return ["arabic", "complex", "universal"].indexOf(word.scriptProfile) < 0;
    }

    function classifyWordMotion(words: RenderWord[]) {
        const reducedMotion = prefersReducedMotion();

        words.forEach((word) => {
            if (reducedMotion || !word.segments.length || !isFiniteNumber(word.start) || !isFiniteNumber(word.end) || word.end <= word.start) {
                word.motionMode = "none";
                word.motionGlow = false;
                word.motionDurationMs = 0;
                return;
            }

            const durationMs = (word.end - word.start) / 10000;
            const wordLen = Math.max(1, visibleWordLength(word));
            const text = word.text || "";

            word.glyphCount = wordLen;

            /*
             * Motion eligibility is language-agnostic.
             *
             * Rendering remains script-aware later:
             * segment-safe scripts -> staggered grapheme layer
             * contextual/complex scripts -> one fully-shaped word
             */
            const canAnimate = !text.includes("-") && wordLen > 0;

            let growable = canAnimate && wordLen <= 7;

            if (growable) {
                if (wordLen <= 1) {
                    growable = durationMs >= 1050 && durationMs >= wordLen * 525;
                } else if (wordLen <= 3) {
                    growable = durationMs >= SHORT_WORD_GLOW_MIN_DURATION_MS + (wordLen - 2) * 140;
                } else {
                    growable = durationMs >= 850 && durationMs >= wordLen * 190;
                }
            }

            /* Motion and bloom are one effect. Words that miss the complete
             * grow/glow eligibility test keep only their neutral timed sweep;
             * a lift without its bloom reads as a stray vertical jump. */
            word.motionMode = growable ? "grow" : "none";

            word.motionGlow = growable;
            word.motionDurationMs = durationMs;

            /*
             * Repo-style dynamic intensity/growth, computed once per word.
             * Per-grapheme position decay is added later for segment-safe overlays.
             */
            const minDuration = 400;
            const maxDuration = 3000;
            const rawDurationProgress = clamp01((durationMs - minDuration) / (maxDuration - minDuration));

            word._motionDurationProgress = rawDurationProgress ** 3;
        });
    }

    const { prepareWordGeometry } = createWordGeometry({ visibleWordLength, canUseGraphemeMotionOverlay, shouldUsePerGlyphMotion });

    let geometryRevision = 0;
    const yieldLyricsWork = async () => {
        await lifecycle.sleep();
    };
    async function refreshMotionGeometry(revision = geometryRevision, preserveScroll = false) {
        const generation = state.generation,
            records = state.lineData;
        let batchStart = performance.now();
        for (const line of records) {
            for (const word of line.words || []) {
                if (revision !== geometryRevision || generation !== state.generation || records !== state.lineData || !isLyricsPage()) return;
                prepareWordGeometry(word);
                if (performance.now() - batchStart >= 8) {
                    await yieldLyricsWork();
                    batchStart = performance.now();
                }
            }
        }
        if (revision === geometryRevision && generation === state.generation && records === state.lineData) {
            alignBackgroundVocalAnchors();
            refreshLyricScrollSpace(true);
            wakeAnimationLoop();
            if (
                !preserveScroll &&
                !state.timingPickActive &&
                state.activeInstrumentalGapIndex < 0 &&
                performance.now() >= state.lyricAutoFollowSuspendedUntil &&
                state.lastActiveLine >= 0
            )
                focusLyricLineIndex(lyricPlaybackFollowIndex(state.lastActiveLine), { force: true, behavior: "auto", reason: "layout-refresh" });
        }
    }

    function queueMotionGeometryRefresh(preserveScroll = false) {
        const revision = ++geometryRevision;
        if (!state.lyrics || !isLyricsPage()) {
            if (state.geometryTimer) {
                lifecycle.clearTimeout(state.geometryTimer);
                state.geometryTimer = 0;
            }
            return false;
        }

        lifecycle.clearTimeout(state.geometryTimer);

        state.geometryTimer = lifecycle.timeout(() => {
            state.geometryTimer = 0;

            if (!state.lyrics || !isLyricsPage()) {
                return;
            }

            lifecycle.frame(() => {
                if (!state.lyrics || !isLyricsPage()) {
                    return;
                }

                refreshMotionGeometry(revision, preserveScroll).catch((error: unknown) => warn("Geometry refresh failed", error));
            });
        }, 40);

        return true;
    }

    function createWordSpan(word: RenderWord) {
        const span = document.createElement("span");

        span.className = "ak-word ak-word-zero";
        span.dataset.akTimingLineIndex = String(word.lineIndex);
        span.dataset.akTimingWordIndex = String(word.wordIndex);

        span.classList.add(`ak-script-${word.scriptProfile}`);

        if (word.paintMode === "shaped") {
            span.classList.add("ak-paint-shaped");
        }

        if (word.isRtl) {
            span.classList.add("ak-word-rtl");
            span.setAttribute("dir", "rtl");
        }

        span.style.setProperty("--ak-word-progress", "0%");

        span.textContent = word.text;

        if (word.motionMode === "grow") {
            word.glowLayers = ["ak-glow-core", "ak-glow-halo"].map((className) => {
                const layer = document.createElement("span");

                layer.className = "ak-glow-layer " + "ak-word-glow-layer " + className;

                layer.setAttribute("aria-hidden", "true");

                layer.textContent = word.text;
                layer.style.opacity = "0";
                span.appendChild(layer);

                return layer;
            });
        }

        word.element = span;

        return span;
    }

    function stableHash(input: string) {
        let hash = 2166136261;

        for (let i = 0; i < input.length; i += 1) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0;
    }

    function lyricSignature(lyrics: LyricInput[]) {
        return lyrics
            .map((lyric) => {
                const text = String(cueValue(lyric, "Text", "text") || "");

                const start = Number(cueValue(lyric, "Start", "start")) || 0;

                return `${start}:${text}`;
            })
            .join("|");
    }

    const { readAccentMode, applyAccentTheme, selectSongAccent, setAccentMode, rerollAccent, currentAccent } = createAccentController({
        ACCENT_STORAGE_KEY,
        PREMIUM_ACCENTS,
        state,
        ACCENT_HISTORY_STORAGE_KEY,
        NEUTRAL_ACCENT,
        stableHash: (...args) => stableHash(...args),
        lyricSignature: (...args) => lyricSignature(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
    });

    function retireDecoratedLines(hide = true) {
        removeInstrumentalGapRows();

        state.lineData.forEach((lineRecord) => {
            const element = lineRecord && lineRecord.element;

            if (!element || !element.isConnected) return;

            try {
                const ownsRenderedChildren = lineHasOwnedLyricNodes(element);

                Array.from(element.classList || [])
                    .filter((name) => name.indexOf("ak-") === 0)
                    .forEach((name) => element.classList.remove(name));

                delete element.dataset.akGeneration;
                delete element.dataset.akLyricIdentity;
                delete element.dataset.akTimingLineIndex;
                delete element.dataset.akVocalRole;
                delete element.dataset.akVocalRoleSource;
                delete element.dataset.akBackgroundAttachment;
                delete element.dataset.akBackgroundAnchorLine;
                element.style.removeProperty("--ak-bg-anchor-offset");

                if (hide) {
                    /* Jellyfin may replace/reuse this node on the next SPA
                     * task. Hide only while a new song response is pending so
                     * the old track cannot flash during the hand-off. */
                    element.style.visibility = "hidden";
                    element.setAttribute("aria-hidden", "true");
                    if (!state.retiredLineElements.includes(element)) {
                        state.retiredLineElements.push(element);
                    }
                } else {
                    /* A completed no-lyrics response must never inherit the
                     * pending-switch hidden state. If the framework has not
                     * replaced our old word spans yet, clear just those owned
                     * children and leave a visible native container for it. */
                    element.style.removeProperty("visibility");
                    element.removeAttribute("aria-hidden");
                    element.removeAttribute("aria-label");
                    element.removeAttribute("dir");
                    if (ownsRenderedChildren) {
                        replaceChildren(element);
                    }
                }
            } catch {
                // A framework-owned node can detach in the middle of cleanup.
            }
        });

        if (!hide && state.retiredLineElements.length) {
            state.retiredLineElements.forEach((element: HTMLElement) => {
                if (!element || !element.isConnected) return;

                try {
                    Array.from(element.classList || [])
                        .filter((name) => name.indexOf("ak-") === 0)
                        .forEach((name) => element.classList.remove(name));
                    element.style.removeProperty("visibility");
                    element.style.removeProperty("--ak-bg-anchor-offset");
                    element.removeAttribute("aria-hidden");
                    element.removeAttribute("aria-label");
                    element.removeAttribute("dir");
                    if (lineHasOwnedLyricNodes(element)) {
                        replaceChildren(element);
                    }
                } catch {
                    // The framework can detach a pending node during cleanup.
                }
            });
            state.retiredLineElements = [];
        }

        const container = getCurrentLyricsContainer(false);

        if (container) {
            container.classList.remove("ak-karaoke-container", "ak-plain-lyrics-container");

            Array.from(container.querySelectorAll<HTMLElement>(".ak-plain-line")).forEach((line) => {
                Array.from(line.classList || [])
                    .filter((name) => name === "ak-plain-line" || name.indexOf("ak-script-") === 0)
                    .forEach((name) => line.classList.remove(name));
                line.removeAttribute("dir");
            });
        }
    }

    function clearCapturedLyrics(source: string = "clear") {
        const hadLyrics = !!state.lyrics || state.lineData.length > 0;
        const keepDynamicVisible = isLyricsPage();

        cancelDecorationRetry(true);
        if (state.geometryTimer) {
            lifecycle.clearTimeout(state.geometryTimer);
            state.geometryTimer = 0;
        }
        if (state.backgroundAnchorTimer) {
            lifecycle.clearTimeout(state.backgroundAnchorTimer);
            state.backgroundAnchorTimer = 0;
        }

        /* Cancel any artwork decode owned by the outgoing track, but never hide
         * or reset the currently rendered field during lyric-payload churn. */
        invalidateAtmosphereLoads(source);
        stopAnimationLoop(source);
        retireDecoratedLines(source === "request-switch");

        if (keepDynamicVisible) {
            const root = state.atmosphereRoot;
            if (root && root.isConnected && state.atmosphereArtwork) {
                root.classList.add("ak-atmosphere-ready");
            }
            document.documentElement.classList.add("ak-lyricmotion-atmosphere-active");
            document.documentElement.classList.add("ak-atmosphere-dynamic-mode");
        } else {
            removeAtmosphereRoot(source);
        }

        state.lyrics = null;
        state.lyricsAcceptedKey = "";
        if (hadLyrics) state.generation += 1;
        state.decoratedGeneration = -1;
        state.lineData = [];
        state.timedCueCount = 0;
        state.lyricTimingMode = "none";
        state.backgroundVocalCount = 0;
        state.romanizationAvailable = false;
        state.romanizationCandidate = false;
        if (state.googleRomanizationCache && typeof state.googleRomanizationCache.clear === "function") {
            state.googleRomanizationCache.clear();
        }
        if (state.googleRomanizationFragmentCache && typeof state.googleRomanizationFragmentCache.clear === "function") {
            state.googleRomanizationFragmentCache.clear();
        }
        if (state.googleRomanizationAttempted && typeof state.googleRomanizationAttempted.clear === "function") {
            state.googleRomanizationAttempted.clear();
        }
        state.googleRomanizationRequest = null;
        state.googleRomanizationState = "idle";
        state.googleRomanizationError = "";
        state.googleRomanizationLineCount = 0;
        state.romanizationLineCount = 0;
        state.songPreferenceKey = "";
        state.timingOffsetSeconds = 0;
        state.timingPickActive = false;
        state.timingUndo = null;
        if (typeof removeRomanizationToggle === "function") removeRomanizationToggle();
        if (typeof removeTimingControls === "function") removeTimingControls();
        if (state.lyricToolsHost && state.lyricToolsHost.parentNode) {
            state.lyricToolsHost.parentNode.removeChild(state.lyricToolsHost);
        }
        state.lyricToolsHost = null;
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        resetMotionHandoffs();
        state.lyricAutoFollowSuspendedUntil = 0;
        state.lyricAutoFollowLastIndex = -1;
        state.lyricAutoFollowLastAt = 0;
        state.lyricAutoFollowScroller = null;
        state.lyricAutoFollowTargetTop = null;
        state.lyricAutoFollowBehavior = null;
        state.lyricAutoFollowLastReason = "lyrics-cleared";
        state.lineEndPrefix = [];
        state.instrumentalGaps = [];
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;
        state.instrumentalGapRenderCount = 0;
        state.instrumentalGapMaxDurationTicks = 0;
        state.overlapFrameCount = 0;
        state.maxSimultaneousLines = 1;
        resetPlaybackClock();

        if (hadLyrics) log(`cleared captured lyrics from ${source}`);
        return hadLyrics;
    }

    function lyricsRequestIdentity(url: string) {
        if (!isLyricsUrl(url)) return "";

        const raw = String(url || "");
        const withoutHash = raw.split("#", 1)[0];
        const queryIndex = requireValue(withoutHash).indexOf("?");
        const rawPath = queryIndex >= 0 ? requireValue(withoutHash).slice(0, queryIndex) : withoutHash;
        const query = queryIndex >= 0 ? requireValue(withoutHash).slice(queryIndex + 1) : "";
        const path = requireValue(rawPath)
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/\/{2,}/g, "/")
            .toLowerCase();

        /*
         * Jellyfin normally carries the item id in the path. Keep an item-id
         * query parameter too for compatibility with alternate client routes,
         * while deliberately ignoring auth/cache query parameters so duplicate
         * requests for the same song share one generation.
         */
        const itemMatch = query.match(/(?:^|&)(?:itemid|item_id)=([^&]+)/i);

        return itemMatch ? `${path}?itemid=${requireValue(itemMatch[1]).toLowerCase()}` : path;
    }

    function beginLyricsRequest(url: string) {
        const key = lyricsRequestIdentity(url);
        if (!key) return 0;

        /* Keep request identity only in normalized form. Do not retain the
         * complete request URL because Jellyfin URLs can contain authentication
         * or cache query parameters that LyricMotion does not need after the
         * interceptor has classified the request. */

        const switchedSong = !!state.lyricsRequestKey && key !== state.lyricsRequestKey;

        /*
         * Every network request receives its own generation token, even when
         * Jellyfin refreshes the same song twice. An earlier response can still
         * populate the UI while a newer refresh is pending, but it can never
         * overwrite a newer response once that newer payload has been accepted.
         */
        state.lyricsRequestSeq += 1;
        state.lyricsRequestKey = key;
        if (switchedSong) {
            /* Drop request identities from the previous track session. This is
             * also an ABA guard: if the user goes A -> B -> A, a very late
             * response from the first A must not match the second A merely
             * because the normalized item URL is identical. */
            state.lyricsRequestKeys.clear();
        }
        state.lyricsRequestKeys.set(state.lyricsRequestSeq, key);
        while (state.lyricsRequestKeys.size > 128) {
            const oldest = state.lyricsRequestKeys.keys().next();
            if (oldest.done) break;
            state.lyricsRequestKeys.delete(oldest.value);
        }

        /*
         * A true track switch clears the previous model immediately. A same-song
         * refresh keeps the current lyrics visible until one of its responses
         * arrives. Sequence ordering still prevents an older response from
         * overwriting a newer response that has already been accepted.
         */
        if (switchedSong) {
            cancelPronunciationRequests();
            clearCapturedLyrics("request-switch");
        }

        return state.lyricsRequestSeq;
    }

    function scheduleLyricVisualRecoveryBurst(generation: number, reason: string = "lyrics") {
        for (const delay of [48, 160, 420]) {
            lifecycle.timeout(() => {
                if (generation !== state.generation || !state.lyrics || document.hidden || !isLyricsPage()) {
                    return;
                }

                if (!lyricVisualDomHealthy()) {
                    queueDecoration();
                    return;
                }

                wakeAnimationLoop();
            }, delay);
        }
        return reason;
    }

    function acceptLyricsPayload(payload: unknown, source: string, requestSeq = 0) {
        if (requestSeq > 0) {
            const requestKey = state.lyricsRequestKeys.get(requestSeq) || "";

            const wrongSong = requestKey ? requestKey !== state.lyricsRequestKey : requestSeq !== state.lyricsRequestSeq;

            const olderThanAccepted = requestSeq < state.lyricsAcceptedSeq;

            if (wrongSong || olderThanAccepted) {
                state.lyricsStaleResponseDrops += 1;
                return false;
            }

            state.lyricsAcceptedSeq = requestSeq;
            state.lyricsAcceptedKey = state.lyricsRequestKey;
        }

        const lyrics = normalizeLyricsPayload(payload);

        if (!lyrics) {
            clearCapturedLyrics(source);
            return true;
        }

        const identity = lyricPayloadIdentity(lyrics);
        if (state.lyrics && identity === acceptedOriginalIdentity && state.lyricsRequestKey === acceptedOriginalTrack) {
            state.lyrics = lyrics;
            window.LyricBridge?.refreshRows();
            if (state.decoratedGeneration !== state.generation || !state.lineData[0]?.element.isConnected) queueDecoration();
            return true;
        }
        const trackChanged = state.lyricsRequestKey !== acceptedOriginalTrack;
        acceptedOriginalIdentity = identity;
        acceptedOriginalTrack = state.lyricsRequestKey;
        state.lyrics = lyrics;
        state.generation += 1;
        state.decoratedGeneration = -1;
        state.lyricTimingMode = lyricTimingMode(lyrics);
        selectSongAccent(lyrics);

        /* Lyrics and background are independent state machines. Keep the current
         * shader field visible, invalidate only obsolete asynchronous art work,
         * then probe the CURRENT media element several times while Jellyfin swaps
         * its player source. */
        if (trackChanged) {
            invalidateAtmosphereLoads("lyrics-accepted");
            state.atmosphereFailedKey = "";
            state.atmosphereLastCheck = 0;
            scheduleDynamicBackgroundProbeBurst("lyrics-accepted");
        }

        const cueCount = usableEnhancedCueCount(lyrics);

        state.timedCueCount = cueCount;
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        resetMotionHandoffs();
        state.lyricAutoFollowSuspendedUntil = 0;
        state.lyricAutoFollowLastIndex = -1;
        state.lyricAutoFollowLastReason = "lyrics-accepted";
        state.lineEndPrefix = [];
        state.instrumentalGaps = [];
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;
        state.instrumentalGapRenderCount = 0;
        state.instrumentalGapMaxDurationTicks = 0;
        state.overlapFrameCount = 0;
        state.maxSimultaneousLines = 1;
        resetPlaybackClock();
        applySongPreferences(lyrics);

        log(`captured ${lyrics.length} lyric lines / ${cueCount} usable cues ` + `(${state.lyricTimingMode}) from ${source}`);
        if (typeof prepareRomanizationForLyrics === "function") {
            prepareRomanizationForLyrics();
        }
        queueDecoration();
        scheduleLyricVisualRecoveryBurst(state.generation, "lyrics-accepted");

        if (state.lyricTimingMode === "plain") {
            log("Plain unsynced lyrics detected; applying typography-only presentation.");
        } else if (cueCount === 0) {
            warn("Lyrics loaded without enhanced ELRC cue data.");
        }

        return true;
    }

    function createUntimedSpan(text: string) {
        const span = document.createElement("span");

        const scriptProfile = detectScriptProfile(text);

        span.className = "ak-untimed " + `ak-script-${scriptProfile}`;

        return setText(span, text);
    }

    const {
        finiteNumber,
        clampTimingOffsetSeconds,
        loadSongPreferences,
        timingTimelineFingerprint,
        applySongPreferences,
        persistCurrentSongPreference,
    } = createSongPreferences({
        TIMING_OFFSET_MIN_SECONDS,
        TIMING_OFFSET_MAX_SECONDS,
        state,
        SONG_PREFERENCES_STORAGE_KEY,
        lyricSignature: (...args) => lyricSignature(...args),
        stableHash: (...args) => stableHash(...args),
        SONG_PREFERENCES_MAX_ENTRIES,
        updateRomanizationToggleUi: (...args) => updateRomanizationToggleUi(...args),
        updateTimingControlsUi: (...args) => updateTimingControlsUi(...args),
    });

    const { cancelPronunciationRequests, lyricsHaveNativeScript, requestGoogleRomanizationForLyrics, displayLyricForCurrentMode } =
        createPronunciationController({
            lifecycle,
            GOOGLE_ROMANIZATION_TIMEOUT_MS,
            GOOGLE_ROMANIZATION_MAX_RETRIES,
            GOOGLE_ROMANIZATION_RETRY_DELAY_MS,
            state,
            GOOGLE_ROMANIZATION_CACHE_MAX_ENTRIES,
            GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
            GOOGLE_ROMANIZATION_CONCURRENCY,
            redecorateForRomanization: (...args) => redecorateForRomanization(...args),
            warn: (...args) => warn(...args),
        });

    const calculateLineBounds = (lyric: LyricInput, lineIndex: number, words: RenderWord[], cues: CueInput[], rawTextLength: number) =>
        timelineBounds(state.lyrics, lyric, lineIndex, words, cues, rawTextLength);
    const {
        formatTimingOffset,
        updateTimingControlsUi,
        invalidateTimingPaintState,
        setTimingOffsetSeconds,
        adjustTimingOffsetSeconds,
        resetTimingOffsetValue,
        undoTimingOffset,
        suppressJellyfinLyricAutoFollow,
        updateLyricSyncButton,
        lyricPlaybackFollowIndex,
        focusLyricLineIndex,
        refreshLyricScrollSpace,
        installLyricAutoFollowHooks,
        installLyricSeekInteractionHooks,
        stopTimingSyncMode,
        beginTimingSyncMode,
        removeTimingControls,
        ensureTimingControls,
        removeRomanizationToggle,
        updateRomanizationToggleUi,
        ensureRomanizationToggle,
        redecorateForRomanization,
        setRomanizationMode,
        prepareRomanizationForLyrics,
    } = createControlsPreferences({
        state,
        clampTimingOffsetSeconds: (...args) => clampTimingOffsetSeconds(...args),
        resetWordMotion: (...args) => resetWordMotion(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        persistCurrentSongPreference: (...args) => persistCurrentSongPreference(...args),
        finiteNumber: (...args) => finiteNumber(...args),
        resetPlaybackClock: (...args) => resetPlaybackClock(...args),
        chooseTimelineTicks: (...args) => chooseTimelineTicks(...args),
        TICKS_PER_SECOND,
        getLocalMediaElement: (...args) => getLocalMediaElement(...args),
        motion: {
            get query() {
                return reducedMotionMediaQuery;
            },
            set query(value) {
                reducedMotionMediaQuery = value;
            },
        },
        lifecycle,
        warn: (...args) => warn(...args),
        sourceTimelineTicks: (...args) => sourceTimelineTicks(...args),
        TIMING_OFFSET_FINE_STEP_SECONDS,
        queueDecoration: (...args) => queueDecoration(...args),
        requestGoogleRomanizationForLyrics: (...args) => requestGoogleRomanizationForLyrics(...args),
        lyricsHaveNativeScript: (...args) => lyricsHaveNativeScript(...args),
        loadSongPreferences: (...args) => loadSongPreferences(...args),
    });

    function createSvgElement(name: string, attributes: Record<string, string | number> | null = null) {
        const node = document.createElementNS(SVG_NS, name);

        if (attributes) {
            Object.entries(attributes).forEach(([key, value]) => {
                node.setAttribute(key, String(value));
            });
        }

        return node;
    }

    const INSTRUMENTAL_NOTE_PATH =
        "M18.15 72.25C10.90 72.25 5.75 68.35 5.75 62.85" +
        "C5.75 56.75 12.10 51.55 20.25 51.55" +
        "C24.55 51.55 28.15 52.70 30.75 54.60" +
        "V13.45C30.75 11.65 32.20 10.20 34.00 10.20H37.05" +
        "C47.90 10.20 56.20 15.10 59.10 23.35" +
        "C60.55 27.45 60.10 31.60 58.00 35.00" +
        "C53.35 31.30 47.05 29.10 38.55 28.70V59.10" +
        "C38.55 66.65 29.80 72.25 18.15 72.25Z";

    function appendInstrumentalNoteShape(parent: SVGElement, className = "") {
        if (!parent) return;

        /* One closed silhouette is used for base paint, liquid paint and clip.
         * The previous ellipse+rect+flag construction could expose seams at
         * fractional scaling and made the moving clip look broken in Chromium. */
        const shape = createSvgElement("path", {
            d: INSTRUMENTAL_NOTE_PATH,
            "fill-rule": "nonzero",
            "clip-rule": "nonzero",
        });

        if (className) shape.setAttribute("class", className);
        parent.appendChild(shape);
    }

    function prefersReducedMotion() {
        if (renderQuality === "low-power") return true;
        try {
            if (!reducedMotionMediaQuery && window.matchMedia) {
                reducedMotionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
            }

            return !!(reducedMotionMediaQuery && reducedMotionMediaQuery.matches);
        } catch {
            return false;
        }
    }

    function instrumentalWaveMotionAllowed() {
        return !prefersReducedMotion();
    }

    function instrumentalWaveGeometry(gap: RenderGap, progress: number, ticks: number | null = null) {
        const normalized = clamp01(finiteNumber(progress, 0));
        const baseY = INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT * (1 - normalized);

        /*
         * The liquid surface remains alive through most of the break, then
         * intentionally settles before the next vocal arrives. Motion is
         * derived from media time, not a free-running CSS timer, so pause and
         * seek are deterministic. Reduced-motion clients receive the
         * same fill progression with a flat surface.
         */
        const riseIn = smoothstepBetween(0.015, 0.09, normalized);
        const flattenOut = 1 - smoothstepBetween(0.68, 0.98, normalized);
        const amplitude = instrumentalWaveMotionAllowed() ? INSTRUMENTAL_WAVE_MAX_AMPLITUDE * riseIn * flattenOut : 0;

        const elapsedSeconds = gap ? Math.max(0, (finiteNumber(ticks, gap.startTicks) - gap.startTicks) / TICKS_PER_SECOND) : 0;
        const phase = (elapsedSeconds / INSTRUMENTAL_WAVE_PERIOD_SECONDS) * Math.PI * 2;

        const points = [];
        for (let index = 0; index <= INSTRUMENTAL_WAVE_SEGMENTS; index += 1) {
            const ratio = index / INSTRUMENTAL_WAVE_SEGMENTS;
            const x = INSTRUMENTAL_NOTE_VIEWBOX_WIDTH * ratio;
            const y = Math.max(0, Math.min(INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT, baseY + amplitude * Math.sin(phase + ratio * Math.PI * 2)));

            points.push([x, y]);
        }

        const surfacePath = points
            .map((point, index: number) => `${index ? "L" : "M"}${requireValue(point[0]).toFixed(3)} ${requireValue(point[1]).toFixed(3)}`)
            .join(" ");
        const fillPath =
            `${surfacePath} ` +
            `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
            `L0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} Z`;

        return {
            baseY,
            amplitude,
            phase,
            fillPath,
            surfacePath,
        };
    }

    function setInstrumentalGapFill(gap: RenderGap, progress: number, ticks: number | null = null) {
        if (!gap || !gap.element) return 0;

        const normalized = clamp01(finiteNumber(progress, 0));
        const geometry = instrumentalWaveGeometry(gap, normalized, ticks);

        if (gap.fillClipElement) {
            gap.fillClipElement.setAttribute("d", geometry.fillPath);
        }

        if (gap.surfaceElement) {
            gap.surfaceElement.setAttribute("d", geometry.surfacePath);
            gap.surfaceElement.style.opacity = normalized > 0.02 && normalized < 0.992 ? "1" : "0";
        }

        gap.lastProgress = normalized;
        gap.lastWavePhase = geometry.phase;
        gap.lastWaveAmplitude = geometry.amplitude;
        return normalized;
    }

    function setInstrumentalGapPhase(gap: RenderGap | null | undefined, phase: string) {
        if (!gap || !gap.element || gap.visualPhase === phase) {
            return false;
        }

        gap.visualPhase = phase;
        gap.element.classList.toggle("ak-future", phase === "future");
        gap.element.classList.toggle("ak-active", phase === "active");
        gap.element.classList.toggle("ak-past", phase === "past");

        if (phase === "future") {
            setInstrumentalGapFill(gap, 0);
        } else if (phase === "past") {
            setInstrumentalGapFill(gap, 1);
        }

        return true;
    }

    function instrumentalPastCountAtTicks(ticks: number) {
        const gaps = state.instrumentalGaps;
        if (!gaps.length) return 0;

        const now = finiteNumber(ticks, 0);
        let low = 0;
        let high = gaps.length;

        /* Upper-bound search on endTicks: number of fully completed gaps. */
        while (low < high) {
            const middle = (low + high) >> 1;
            if (requireValue(gaps[middle]).endTicks <= now) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return low;
    }

    function syncInstrumentalGapPhases(ticks: number, activeGap: RenderGap | null = null) {
        const gaps = state.instrumentalGaps;
        if (!gaps.length) {
            state.instrumentalPastCount = 0;
            state.instrumentalPhaseActiveIndex = -1;
            return;
        }

        const pastCount = instrumentalPastCountAtTicks(ticks);
        const previousPastCount = Math.max(0, Math.min(gaps.length, state.instrumentalPastCount || 0));
        const activeIndex = activeGap ? finiteNumber(activeGap.index, -1) : -1;
        const previousActiveIndex = finiteNumber(state.instrumentalPhaseActiveIndex, -1);

        /*
         * Normal playback crosses at most one boundary at a time. Update only
         * rows whose phase can have changed instead of rescanning every
         * instrumental row on every animation frame. Arbitrary seeks remain
         * correct because the changed past/future range is replayed here.
         */
        if (pastCount > previousPastCount) {
            for (let index = previousPastCount; index < pastCount; index += 1) {
                if (index !== activeIndex) {
                    setInstrumentalGapPhase(gaps[index], "past");
                }
            }
        } else if (pastCount < previousPastCount) {
            for (let index = pastCount; index < previousPastCount; index += 1) {
                if (index !== activeIndex) {
                    setInstrumentalGapPhase(gaps[index], "future");
                }
            }
        }

        if (previousActiveIndex >= 0 && previousActiveIndex < gaps.length && previousActiveIndex !== activeIndex) {
            setInstrumentalGapPhase(gaps[previousActiveIndex], previousActiveIndex < pastCount ? "past" : "future");
        }

        if (activeIndex >= 0 && activeIndex < gaps.length) {
            setInstrumentalGapPhase(gaps[activeIndex], "active");
        }

        state.instrumentalPastCount = pastCount;
        state.instrumentalPhaseActiveIndex = activeIndex;
    }

    function createInstrumentalGapRow(gap: RenderGap) {
        if (!gap) return null;

        const row = document.createElement("div");
        row.className = "ak-instrumental-gap-line ak-future";
        row.dataset.akInstrumentalGap = String(gap.index);
        row.dataset.akInstrumentalNextLine = String(gap.nextLineIndex);

        const note = document.createElement("span");
        note.className = "ak-instrumental-note";
        note.setAttribute("role", "button");
        note.setAttribute("tabindex", "0");
        note.setAttribute("aria-label", `Seek to start of ${Math.max(0, gap.durationTicks / TICKS_PER_SECOND).toFixed(1)} second instrumental break`);
        note.setAttribute("title", "Enter or click to seek to the instrumental break; Space plays or pauses");

        const svg = createSvgElement("svg", {
            class: "ak-instrumental-note-svg",
            viewBox: `0 0 ${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT}`,
            "aria-hidden": "true",
            focusable: "false",
            role: "presentation",
        });

        const defs = createSvgElement("defs");
        const idRoot = `ak-instrumental-${state.generation}-${gap.index}`;
        const fillClipId = `${idRoot}-fill`;
        const shapeClipId = `${idRoot}-shape`;

        const fillClip = createSvgElement("clipPath", {
            id: fillClipId,
            clipPathUnits: "userSpaceOnUse",
        });
        const fillWave = createSvgElement("path", {
            d:
                `M0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
                `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
                `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` +
                `L0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} Z`,
        });
        fillClip.appendChild(fillWave);

        const shapeClip = createSvgElement("clipPath", {
            id: shapeClipId,
            clipPathUnits: "userSpaceOnUse",
        });
        appendInstrumentalNoteShape(shapeClip);

        defs.appendChild(fillClip);
        defs.appendChild(shapeClip);
        svg.appendChild(defs);

        const base = createSvgElement("g", {
            class: "ak-instrumental-note-base-vector",
        });
        appendInstrumentalNoteShape(base);
        svg.appendChild(base);

        const liquid = createSvgElement("g", {
            class: "ak-instrumental-note-liquid",
            "clip-path": `url(#${fillClipId})`,
        });
        appendInstrumentalNoteShape(liquid);
        svg.appendChild(liquid);

        const surface = createSvgElement("path", {
            class: "ak-instrumental-note-surface",
            d: `M0 ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT} ` + `L${INSTRUMENTAL_NOTE_VIEWBOX_WIDTH} ${INSTRUMENTAL_NOTE_VIEWBOX_HEIGHT}`,
            "clip-path": `url(#${shapeClipId})`,
        });
        svg.appendChild(surface);

        note.appendChild(svg);
        row.appendChild(note);

        gap.element = row;
        gap.fillClipElement = fillWave;
        gap.surfaceElement = surface;
        gap.visualPhase = "future";
        gap.lastProgress = 0;
        setInstrumentalGapFill(gap, 0);

        return row;
    }

    function removeInstrumentalGapRows(container: HTMLElement | null = null) {
        state.instrumentalGaps.forEach((gap) => {
            const element = gap && gap.element;

            if (element && element.parentNode) {
                try {
                    element.parentNode.removeChild(element);
                } catch {
                    // Framework-owned lyric DOM can disappear during cleanup.
                }
            }
        });

        const root = container || getCurrentLyricsContainer(true);

        if (root && typeof root.querySelectorAll === "function") {
            try {
                Array.from(root.querySelectorAll<HTMLElement>(".ak-instrumental-gap-line")).forEach((element: HTMLElement) => {
                    if (element.parentNode) {
                        element.parentNode.removeChild(element);
                    }
                });
            } catch {
                // Best-effort stale-row cleanup only.
            }
        }

        state.instrumentalGaps = [];
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;
    }

    function installInstrumentalGapRows(container: HTMLElement | null) {
        removeInstrumentalGapRows(container);

        const gaps = planInstrumentalGaps(state.lineData);

        gaps.forEach((gap) => {
            const nextLine = state.lineData[gap.nextLineIndex];
            const nextElement = nextLine && nextLine.element;
            const parent = nextElement && nextElement.parentNode;

            if (!parent) return;

            const row = createInstrumentalGapRow(gap);

            if (!row) return;

            /*
             * Follow the upcoming lyric's base direction so mixed LTR/RTL
             * songs place the synthetic note on the same reading lane instead
             * of inheriting only the document direction.
             */
            try {
                const direction = String(nextElement.getAttribute("dir") || "").toLowerCase();
                if (direction === "rtl" || direction === "ltr") {
                    row.setAttribute("dir", direction);
                }
            } catch {
                // Direction is visual-only; never block lyric decoration.
            }

            parent.insertBefore(row, nextElement);
        });

        state.instrumentalGaps = gaps.filter((gap) => !!gap.element);
        state.instrumentalGaps.forEach((gap, index: number) => {
            gap.index = index;
            if (gap.element) {
                gap.element.dataset.akInstrumentalGap = String(index);
            }
        });
        state.instrumentalGapMaxDurationTicks = state.instrumentalGaps.reduce((maximum, gap) => Math.max(maximum, gap.durationTicks), 0);
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;

        return state.instrumentalGaps;
    }

    function findInstrumentalGapInList(gaps: RenderGap[], ticks: number) {
        if (!gaps || !gaps.length) return null;

        let low = 0;
        let high = gaps.length - 1;
        let candidate = -1;

        while (low <= high) {
            const middle = (low + high) >> 1;
            const gap = gaps[middle];

            if (requireValue(gap).startTicks <= ticks) {
                candidate = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        if (candidate < 0) return null;

        const gap = gaps[candidate];

        return ticks >= requireValue(gap).startTicks && ticks < requireValue(gap).endTicks ? gap : null;
    }

    function findInstrumentalGapAtTicks(ticks: number) {
        return findInstrumentalGapInList(state.instrumentalGaps, ticks);
    }

    function instrumentalGapProgress(gap: RenderGap, ticks: number) {
        if (!gap) return 0;

        const duration = Math.max(1, finiteNumber(gap.durationTicks, 0));

        return Math.max(0, Math.min(1, (finiteNumber(ticks, gap.startTicks) - gap.startTicks) / duration));
    }

    function instrumentalGapDistanceBand(lineIndex: number, nextLineIndex: number) {
        const center = nextLineIndex - 0.5;
        const distance = Math.abs(lineIndex - center);

        /*
         * No lyric line is the visual focus during an instrumental gap.
         * Returning near/near2 here used to keep the lines immediately around
         * the synthetic note too bright, making the completed lyric compete
         * with the progress indicator. Preserve only the far-distance fade;
         * the normal past/future phase opacity handles nearby lyrics.
         */
        if (distance >= 4.5) return "far";
        return "middle";
    }

    function updateInstrumentalGapVisual(gap: RenderGap | null | undefined, ticks: number) {
        const nextIndex = gap ? gap.index : -1;
        const previousIndex = state.activeInstrumentalGapIndex;

        if (previousIndex !== nextIndex) {
            if (gap) {
                state.instrumentalGapRenderCount += 1;
            }
            state.activeInstrumentalGapIndex = nextIndex;
        }

        /*
         * Synthetic note rows remain visible as dim future/past lyric items,
         * just like the surrounding text. This prevents the indicator from
         * popping into existence at the exact gap boundary and also makes
         * seek-back/seek-forward state deterministic.
         */
        syncInstrumentalGapPhases(ticks, gap ?? null);

        if (!gap || !gap.element || !gap.element.isConnected || !gap.element.parentNode) {
            return 0;
        }

        const progress = instrumentalGapProgress(gap, ticks);

        const currentTicks = finiteNumber(ticks, gap.startTicks);
        const playbackAdvanced = gap.lastRenderTicks !== currentTicks;
        const animatedSurface = instrumentalWaveMotionAllowed();

        if (
            gap.lastProgress < 0 ||
            Math.abs(progress - gap.lastProgress) >= INSTRUMENTAL_GAP_PROGRESS_EPSILON ||
            (animatedSurface && playbackAdvanced)
        ) {
            setInstrumentalGapFill(gap, progress, currentTicks);
            gap.lastRenderTicks = currentTicks;
        }

        return progress;
    }

    function inspectInstrumentalBreaks() {
        const active = state.instrumentalGaps[state.activeInstrumentalGapIndex] || null;

        return {
            symbol: INSTRUMENTAL_GAP_SYMBOL,
            visualRenderer: "inline-svg-liquid-wave-v3",
            transitionModel: "future-active-past",
            rectangularTextClipArtifact: false,
            liquidSurface: "media-time-wave+progressive-flattening",
            reducedMotionSurface: "flat",
            seekable: true,
            seekTarget: "gap-start",
            keyboardActivation: "enter-seek-space-playback",
            seekCount: state.instrumentalSeekCount,
            minimumGapSeconds: INSTRUMENTAL_GAP_MIN_TICKS / TICKS_PER_SECOND,
            detected: state.instrumentalGaps.length,
            activeIndex: state.activeInstrumentalGapIndex,
            active: active
                ? {
                      startSeconds: Number((active.startTicks / TICKS_PER_SECOND).toFixed(3)),
                      endSeconds: Number((active.endTicks / TICKS_PER_SECOND).toFixed(3)),
                      durationSeconds: Number((active.durationTicks / TICKS_PER_SECOND).toFixed(3)),
                      nextLineIndex: active.nextLineIndex,
                      intro: !!active.isIntro,
                      progress: active.lastProgress >= 0 ? Number(active.lastProgress.toFixed(4)) : 0,
                  }
                : null,
            renderCount: state.instrumentalGapRenderCount,
            longestSeconds: Number((state.instrumentalGapMaxDurationTicks / TICKS_PER_SECOND).toFixed(3)),
            gaps: state.instrumentalGaps.map((gap) => ({
                startSeconds: Number((gap.startTicks / TICKS_PER_SECOND).toFixed(3)),
                endSeconds: Number((gap.endTicks / TICKS_PER_SECOND).toFixed(3)),
                durationSeconds: Number((gap.durationTicks / TICKS_PER_SECOND).toFixed(3)),
                nextLineIndex: gap.nextLineIndex,
                intro: !!gap.isIntro,
            })),
        };
    }

    const {
        decorationInProgress,
        alignBackgroundVocalAnchors,
        queueBackgroundVocalAnchorRefresh,
        inspectBackgroundVocals,
        lineHasOwnedLyricNodes,
        lineRecordHealthy,
        instrumentalGapRowsHealthy,
        lyricVisualDomHealthy,
        cancelDecorationRetry,
        queueDecoration,
        isMobileEnvironment,
    } = createLyricView({
        displayLyricForCurrentMode: (...args) => displayLyricForCurrentMode(...args),
        state,
        createUntimedSpan: (...args) => createUntimedSpan(...args),
        calculateLineBounds: (...args) => calculateLineBounds(...args),
        cueEndTicks: (...args) => cueEndTicks(...args),
        buildWordRecords: (...args) => buildWordRecords(...args),
        classifyWordMotion: (...args) => classifyWordMotion(...args),
        createWordSpan: (...args) => createWordSpan(...args),
        lifecycle,
        TICKS_PER_SECOND,
        stableHash: (...args) => stableHash(...args),
        removeInstrumentalGapRows: (...args) => removeInstrumentalGapRows(...args),
        resetMotionHandoffs: (...args) => resetMotionHandoffs(...args),
        removeRomanizationToggle: (...args) => removeRomanizationToggle(...args),
        removeTimingControls: (...args) => removeTimingControls(...args),
        stopAnimationLoop: (...args) => stopAnimationLoop(...args),
        suppressJellyfinLyricAutoFollow: (...args) => suppressJellyfinLyricAutoFollow(...args),
        yieldLyricsWork: (...args) => yieldLyricsWork(...args),
        installInstrumentalGapRows: (...args) => installInstrumentalGapRows(...args),
        ensureRomanizationToggle: (...args) => ensureRomanizationToggle(...args),
        ensureTimingControls: (...args) => ensureTimingControls(...args),
        applyAccentTheme: (...args) => applyAccentTheme(...args),
        applyPerformanceProfile: (...args) => applyPerformanceProfile(...args),
        queueMotionGeometryRefresh: (...args) => queueMotionGeometryRefresh(...args),
        ensureAnimationLoop: (...args) => ensureAnimationLoop(...args),
        warn: (...args) => warn(...args),
        DECORATION_RETRY_WINDOW_MS,
        DECORATION_RETRY_MS,
    });

    function readPerformanceMode() {
        try {
            const stored = localStorage.getItem(PERFORMANCE_STORAGE_KEY);
            if (stored === "auto" || stored === "desktop" || stored === "mobile") {
                return stored;
            }
        } catch {
            // Ignore storage failure.
        }
        return "auto";
    }

    function detectPerformanceProfile(): "desktop" | "mobile" {
        if (state.performanceMode && state.performanceMode !== "auto") {
            return state.performanceMode;
        }
        return isMobileEnvironment() ? "mobile" : "desktop";
    }

    function applyPerformanceClassToPage(page: HTMLElement | null) {
        if (!page) return;
        for (const name of ["desktop", "mobile"]) {
            page.classList.remove(`ak-perf-${name}`);
        }
        page.classList.add(`ak-perf-${state.performanceProfile}`);
    }

    function applyPerformanceProfile(refreshGeometry = true) {
        const previous = state.performanceProfile;
        state.performanceProfile = detectPerformanceProfile();

        if (previous !== state.performanceProfile) {
            state.lastRenderedFrameAt = 0;
            invalidateAtmosphereLoads("performance-profile-change");
            state.atmosphereLastCheck = 0;
            rebuildDynamicBackgroundRenderer("performance-profile-change");
        }

        const page = isLyricsPage() ? getCurrentLyricPage() : null;
        applyPerformanceClassToPage(page);
        applyAccentTheme();

        if (refreshGeometry && previous !== state.performanceProfile && state.lineData.length) {
            queueMotionGeometryRefresh();
        }
    }

    function setPerformanceMode(mode: string) {
        const normalized = String(mode || "")
            .trim()
            .toLowerCase();
        if (normalized !== "auto" && normalized !== "desktop" && normalized !== "mobile") {
            throw new Error('Performance mode must be: "auto", "desktop", or "mobile".');
        }
        state.performanceMode = normalized;
        try {
            localStorage.setItem(PERFORMANCE_STORAGE_KEY, normalized);
        } catch {
            /* ignore */
        }
        applyPerformanceProfile(true);
        wakeAnimationLoop();
        return {
            mode: state.performanceMode,
            profile: state.performanceProfile,
            targetFps: PERFORMANCE_TARGET_FPS[state.performanceProfile],
        };
    }

    function shouldUsePerGlyphMotion(glyphCount: number) {
        return !prefersReducedMotion() && Number(glyphCount) > 0;
    }

    function getTargetFrameInterval(media: HTMLMediaElement | null) {
        if (document.hidden) {
            return 500;
        }

        if (media && media.paused) {
            return 1000 / PAUSED_TARGET_FPS;
        }

        if (state.timedCueCount === 0 && state.activeInstrumentalGapIndex < 0) {
            return 1000 / LRC_TARGET_FPS;
        }

        const fps = renderQuality === "low-power" ? 30 : PERFORMANCE_TARGET_FPS[state.performanceProfile] || 30;

        return 1000 / fps;
    }

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

    const {
        readAtmosphereMode,
        removeAtmosphereRoot,
        invalidateAtmosphereLoads,
        clearDynamicProbeTimers,
        scheduleDynamicBackgroundProbeBurst,
        mediaItemId,
        currentLyricsItemId,
        updateAtmospherePlaybackState,
        startDynamicBackgroundRenderer,
        stopDynamicBackgroundRenderer,
        rebuildDynamicBackgroundRenderer,
        resizeDynamicBackgroundRenderer,
        refreshAtmosphere,
        maybeRefreshAtmosphere,
    } = createArtworkController({
        state,
        applyPerformanceClassToPage: (...args) => applyPerformanceClassToPage(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        artworkLoader,
        lifecycle,
        getLocalMediaElement: (...args) => getLocalMediaElement(...args),
        warn: (...args) => warn(...args),
        ATMOSPHERE_ART_MAX_WIDTH,
        DYNAMIC_BACKGROUND_DOM_STABLE_MS,
        DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
        DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS,
        DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS,
        ATMOSPHERE_IMAGE_TIMEOUT_MS,
        prefersReducedMotion: (...args) => prefersReducedMotion(...args),
        DYNAMIC_BACKGROUND_SETTINGS,
        DYNAMIC_BACKGROUND_WEBGL_RETRY_MAX_MS,
        DYNAMIC_BACKGROUND_WEBGL_RETRY_BASE_MS,
        DYNAMIC_BACKGROUND_SOURCE,
        DYNAMIC_BACKGROUND_ENGINE,
        DYNAMIC_BACKGROUND_TRANSITION_MS,
        DYNAMIC_BACKGROUND_WEAK_RECHECK_MS,
        DYNAMIC_BACKGROUND_NO_ART_RETRY_MS,
        DYNAMIC_BACKGROUND_DIRECT_GRACE_MS,
        DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS,
        DYNAMIC_BACKGROUND_DIRECT_RETRY_MS,
        DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS,
    });

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

        const expectedItemId = currentLyricsItemId();
        const candidateItemId = mediaItemId(element).toLowerCase();
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
            resetPlaybackClock(media, now);
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

    function getJellyfinActiveLineIndex() {
        const container = getCurrentLyricsContainer(false);

        if (!container) return -1;

        let lines: HTMLElement[];

        try {
            lines = Array.from(container.querySelectorAll<HTMLElement>(".lyricsLine"));
        } catch {
            return -1;
        }

        if (!lines.length) return -1;

        /*
         * Jellyfin's lyric view has changed active-line markers across web
         * releases and custom skins. This probe intentionally recognises only
         * generic stock-style state markers and never our own `ak-current`
         * class. If no trustworthy marker exists, chooseTimelineTicks() falls
         * back to the StartTimeTicks-adjusted source timeline. That fallback is
         * safer than guessing from layout position and, importantly, prevents
         * the historical ReferenceError in this transcode-only branch.
         */
        const selectors = ['[aria-current="true"]', '[data-current="true"]', '[data-active="true"]', ".current", ".active", ".selected"];

        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index];
            if (!line || typeof line.matches !== "function") continue;

            try {
                if (selectors.some((selector) => line.matches(selector))) {
                    return index;
                }
            } catch {
                return -1;
            }
        }

        return -1;
    }

    function findLineIndexAtTicks(ticks: number) {
        if (!state.lineData || !state.lineData.length) return -1;

        let low = 0;
        let high = state.lineData.length - 1;
        let result = -1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const start = Number(requireValue(state.lineData[mid]).startTicks);

            if (isFiniteNumber(start) && start <= ticks) {
                result = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return result;
    }

    function sameIndexList(left: number[] | null, right: number[] | null) {
        if (left === right) return true;
        if (!left || !right || left.length !== right.length) return false;

        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return false;
        }

        return true;
    }

    function findActiveLineIndexesAtTicks(ticks: number, presentationLine: number) {
        const active = state.activeLineScratch || (state.activeLineScratch = []);
        active.length = 0;

        if (presentationLine < 0 || !state.lineData.length) {
            return active;
        }

        const upper = Math.min(presentationLine, state.lineData.length - 1);

        for (let index = upper; index >= 0; index -= 1) {
            if (index < upper && requireValue(state.lineEndPrefix[index]) <= ticks) {
                break;
            }

            const line = state.lineData[index];
            const start = Number(requireValue(line).startTicks);
            const end = Number(requireValue(line).endTicks);

            if (isFiniteNumber(start) && isFiniteNumber(end) && start <= ticks && ticks < end) {
                active.push(index);
            }
        }

        active.reverse();

        const presentationRecord = state.lineData[presentationLine];
        const presentationTrustedEnd = Number(presentationRecord && presentationRecord.trustedEndTicks);
        const presentationCanRemainCurrent = !isFiniteNumber(presentationTrustedEnd) || ticks < presentationTrustedEnd;

        if (!active.includes(presentationLine) && presentationLine >= 0 && presentationLine < state.lineData.length && presentationCanRemainCurrent) {
            /* The presentation line is the upper bound, so after reversing the
             * descending scan it belongs at the end of this ascending list. */
            active.push(presentationLine);
        }

        return active;
    }

    const resetPlaybackClock = (media: HTMLMediaElement | null = null, frameNow: number = performance.now()) => resetClock(state, media, frameNow);
    const projectedMediaSeconds = (media: HTMLMediaElement, frameNow: number) => projectClock(state, media, frameNow);
    const {
        smoothstepBetween,
        glowBucketSteps,
        motionContinuityGain,
        motionHandoffActive,
        updateMotionGlyphs,
        updateWholeMotion,
        resetWordMotion,
        updateWordVisual,
        setStaticWordState,
    } = createKaraokeAnimation(currentAccent, () => !prefersReducedMotion());
    const { sourceTimelineTicks, chooseTimelineTicks, cueEndTicks, resetMotionHandoffs, syncStaticLineStates, updateLineHandoffs } =
        createPlaybackCoordinator({
            finiteNumber: (...args) => finiteNumber(...args),
            TICKS_PER_SECOND,
            clampTimingOffsetSeconds: (...args) => clampTimingOffsetSeconds(...args),
            state,
            projectedMediaSeconds: (...args) => projectedMediaSeconds(...args),
            getStartTimeTicksFromUrl: (...args) => getStartTimeTicksFromUrl(...args),
            getJellyfinActiveLineIndex: (...args) => getJellyfinActiveLineIndex(...args),
            findLineIndexAtTicks: (...args) => findLineIndexAtTicks(...args),
            instrumentalGapDistanceBand: (...args) => instrumentalGapDistanceBand(...args),
            motionHandoffActive: (...args) => motionHandoffActive(...args),
            setStaticWordState: (...args) => setStaticWordState(...args),
            resetWordMotion: (...args) => resetWordMotion(...args),
            LINE_CLASS_NEIGHBORHOOD,
            motionContinuityGain: (...args) => motionContinuityGain(...args),
            updateMotionGlyphs: (...args) => updateMotionGlyphs(...args),
            updateWholeMotion: (...args) => updateWholeMotion(...args),
        });

    function shouldRunAnimationLoop() {
        return (
            !document.hidden &&
            !state.lyricViewHidden &&
            (!(state.mediaElement?.paused || state.mediaElement?.ended) || performance.now() < state.pausedSettleUntil || state.forceNextFrame) &&
            !!state.lyrics &&
            state.lineData.length > 0 &&
            isLyricsPage()
        );
    }

    function stopAnimationLoop(reason: string = "idle") {
        const wasRunning = state.animationLoopRunning || !!state.rafId || !!state.frameTimer;

        if (state.rafId) {
            try {
                lifecycle.cancelFrame(state.rafId);
            } catch {
                // Ignore incomplete embedded-browser cancellation APIs.
            }
            state.rafId = 0;
        }

        if (state.frameTimer) {
            lifecycle.clearTimeout(state.frameTimer);
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

        const interval = immediate ? 0 : getTargetFrameInterval(media);

        if (interval <= 19) {
            state.rafId = lifecycle.frame(renderFrame);
            return;
        }

        const delay = Math.max(0, interval - 8);

        state.frameTimer = lifecycle.timeout(() => {
            state.frameTimer = 0;

            if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("timer-inactive");
                return;
            }

            state.rafId = lifecycle.frame(renderFrame);
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

        state.frameTimer = lifecycle.timeout(() => {
            state.frameTimer = 0;

            if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("media-discovery-inactive");
                return;
            }

            state.rafId = lifecycle.frame(renderFrame);
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
            lifecycle.clearTimeout(state.frameTimer);
            state.frameTimer = 0;
        }

        scheduleNextFrame(state.mediaElement, true);
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
                state.accentReplayArmed = true;
            } else if (type === "emptied") {
                state.accentReplayArmed = false;
            } else if ((type === "play" || type === "playing") && state.accentReplayArmed) {
                const replayedFromStart = (Number(media.currentTime) || 0) < 2;

                state.accentReplayArmed = false;

                if (replayedFromStart && state.lyrics && readAccentMode() === "shuffle") {
                    selectSongAccent(state.lyrics, true, "replay");
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
                state.atmosphereLastCheck = 0;
                scheduleDynamicBackgroundProbeBurst(`media-${type}`);
            }

            const replayFromBeginning = (type === "play" || type === "playing") && (Number(media.currentTime) || 0) < 0.75;

            const frameNow = performance.now();

            if (type === "seeking" || type === "seeked" || type === "loadedmetadata" || type === "emptied" || replayFromBeginning) {
                state.lastActiveLine = -999;
                state.lastActiveLineSignature = "";
                state.activeLineIndexes = [];
            }

            if (type !== "timeupdate") {
                resetPlaybackClock(media, frameNow);
            }

            if (type !== "timeupdate") updateAtmospherePlaybackState(media);
            if (type !== "timeupdate" || !media.paused) wakeAnimationLoop();
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
                lifecycle.on(media, eventName, handleMediaWake, {
                    passive: true,
                }),
            );
        }
    }

    function renderFrame() {
        try {
            state.rafId = 0;

            if (!shouldRunAnimationLoop()) {
                stopAnimationLoop("render-inactive");
                return;
            }

            const firstDecoratedLine = state.lineData[0] && state.lineData[0].element;

            /*
             * Full DOM ownership validation is mutation/watchdog driven so the
             * 60 fps path stays O(1). The observer invalidates
             * decoratedGeneration immediately when Jellyfin replaces children.
             */
            if (state.decoratedGeneration !== state.generation || !firstDecoratedLine || !firstDecoratedLine.isConnected) {
                state.decoratedGeneration = -1;
                queueDecoration();
                stopAnimationLoop("stale-lyric-dom");
                return;
            }

            const media = getLocalMediaElement();

            if (!media) {
                const now = performance.now();

                if (now - state.lastMediaWarning > 5000) {
                    state.lastMediaWarning = now;

                    warn("No local Jellyfin audio element found for karaoke timing.");
                }

                scheduleMediaDiscoveryFrame();
                return;
            }

            ensureMediaWakeHooks(media);

            const frameNow = performance.now();

            const targetInterval = getTargetFrameInterval(media);

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

            const ticks = chooseTimelineTicks(media, frameNow);

            if (ticks === null) {
                scheduleNextFrame(media, false);
                return;
            }
            updateMeasuredFps(frameNow);

            maybeRefreshAtmosphere(media, frameNow);

            const timelineLine = findLineIndexAtTicks(ticks);

            const instrumentalGap = findInstrumentalGapAtTicks(ticks);

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
                activeLines = state.activeLineScratch || (state.activeLineScratch = []);
                activeLines.length = 0;
            } else {
                activeLines = findActiveLineIndexesAtTicks(ticks, activeLine);
            }

            const activeLineChanged = activeLine !== state.lastActiveLine;
            const returningFromInstrumental = !instrumentalGap && state.activeInstrumentalGapIndex >= 0;

            const activeSetChanged =
                activeLineChanged ||
                instrumentalGapIndex !== state.activeInstrumentalGapIndex ||
                !sameIndexList(activeLines, state.activeLineIndexes);

            if (activeSetChanged) {
                syncStaticLineStates(activeLine, activeLines, ticks, frameNow, instrumentalGap);
                /* Current/future scaling can change a line's measured edge.
                 * Re-anchor attached backing vocals only at line transitions,
                 * never on the steady-state frame path. */
                queueBackgroundVocalAnchorRefresh();

                /* Diagnostics keep a human-readable signature, but build it only
                 * when the active set changes instead of allocating every frame. */
                state.lastActiveLineSignature = activeLines.join(",");
                state.activeLineIndexes = activeLines.slice();

                if ((activeLineChanged || returningFromInstrumental) && !instrumentalGap && activeLine >= 0) {
                    // During the break the upcoming line is only a fade anchor.
                    // It still needs a fresh scroll when singing resumes.
                    if (returningFromInstrumental) state.lyricAutoFollowLastIndex = -1;
                    const generation = state.generation;
                    lifecycle.frame(() => {
                        if (generation !== state.generation || activeLine !== state.lastActiveLine || state.lyricViewHidden) return;
                        focusLyricLineIndex(lyricPlaybackFollowIndex(activeLine), {
                            force: false,
                            behavior: "smooth",
                            reason: "playback-follow",
                        });
                    });
                }
            }

            updateInstrumentalGapVisual(instrumentalGap, ticks);

            updateAtmospherePlaybackState(media);

            if (activeLines.length > 1) {
                state.overlapFrameCount += 1;
            }

            state.maxSimultaneousLines = Math.max(state.maxSimultaneousLines, activeLines.length);

            activeLines.forEach((lineIndex: number) => {
                const current = state.lineData[lineIndex];

                if (!current) return;

                (current.words || []).forEach((word) => {
                    updateWordVisual(word, ticks, frameNow);
                });
            });

            updateLineHandoffs(ticks, instrumentalGap ? [] : activeLines);

            updateLyricSyncButton();
            scheduleNextFrame(media, false);
        } catch (error) {
            state.rafId = 0;
            state.animationLoopErrors += 1;
            state.lastAnimationLoopError = String(
                error instanceof Error ? error.stack || error.message : String(error || "unknown render error"),
            ).slice(0, 1200);
            warn("Lyric visual frame failed; scheduling recovery:", error);

            /* Background work must never be able to permanently kill ELRC
             * sweep/glow or the instrumental liquid fill. One failed frame is
             * isolated and the lyric loop is restarted on a short timer. */
            if (shouldRunAnimationLoop() && !state.frameTimer) {
                state.animationLoopRecoveries += 1;
                state.frameTimer = lifecycle.timeout(() => {
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

        scheduleNextFrame(state.mediaElement, true);
        return true;
    }

    function lyricWatchdogDomHealthy() {
        if (state.lyricTimingMode === "plain") return lyricVisualDomHealthy();
        if (state.decoratedGeneration !== state.generation || !state.lineData.length) return false;
        for (let i = 0; i < Math.min(12, state.lineData.length); i++) {
            const line = state.lineData[state.watchdogLineCursor++ % state.lineData.length];
            if (!lineRecordHealthy(requireValue(line))) return false;
        }
        return instrumentalGapRowsHealthy();
    }

    function installLyricVisualWatchdog() {
        if (state.animationWatchdogTimer) return;

        state.animationWatchdogTimer = lifecycle.interval(() => {
            if (document.hidden || state.lyricViewHidden || !isLyricsPage()) return;

            // Artwork belongs to the view, including instrumental/missing or
            // still-loading lyrics. Retry late media/art independently of rows.
            const media = getLocalMediaElement(true);
            if (media) maybeRefreshAtmosphere(media, performance.now());
            if (!state.lyrics) return;

            if (!lyricWatchdogDomHealthy()) {
                state.decoratedGeneration = -1;
                queueDecoration();
                return;
            }

            if (shouldRunAnimationLoop() && !state.animationLoopRunning && !state.rafId && !state.frameTimer) {
                state.animationWatchdogRecoveries += 1;
                wakeAnimationLoop();
            }
        }, LYRIC_VISUAL_WATCHDOG_MS);
    }

    function installDomObserver() {
        const lyricSelector = ".lyricPage, .lyricsContainer, .lyricsLine";

        const touchesLyricDom = (node: Node) => {
            if (!node) return false;
            const element = node instanceof Element ? node : node.parentElement;
            if (!element) return false;
            // Bridge status and settings are siblings of lyrics, not native lyric mutations.
            if (element.closest(".lb-tools,.lb-popup,.lb-search")) return false;

            if (typeof element.matches === "function" && element.matches(lyricSelector)) {
                return true;
            }

            if (typeof element.closest === "function") {
                if (
                    element.closest<HTMLElement>(".lyricsLine") ||
                    element.closest<HTMLElement>(".lyricsContainer") ||
                    element.closest<HTMLElement>(".lyricPage")
                ) {
                    return true;
                }
            }

            return typeof element.querySelector === "function" && !!element.querySelector<HTMLElement>(lyricSelector);
        };

        const artworkSelector = [
            ".nowPlayingBar img",
            ".nowPlayingPage img",
            ".nowPlayingInfoContainer img",
            ".detailImageContainer img",
            '.nowPlayingBar [style*="background-image"]',
            '.nowPlayingPage [style*="background-image"]',
            '.nowPlayingInfoContainer [style*="background-image"]',
            '.detailImageContainer [style*="background-image"]',
        ].join(",");

        const touchesArtworkDom = (node: Node) => {
            if (!node) return false;
            const element = node instanceof Element ? node : node.parentElement;
            if (!element) return false;
            if (typeof element.matches === "function" && element.matches(artworkSelector)) {
                return true;
            }
            if (
                String(element.tagName || "").toUpperCase() === "IMG" &&
                typeof element.closest === "function" &&
                element.closest<HTMLElement>(".nowPlayingBar,.nowPlayingPage,.nowPlayingInfoContainer,.detailImageContainer")
            ) {
                return true;
            }
            return typeof element.querySelector === "function" && !!element.querySelector<HTMLElement>(artworkSelector);
        };

        const observer = lifecycle.observer((mutations) => {
            if (document.hidden || !isLyricsPage() || !state.lyrics) return;

            let shouldCheck = false;
            let artworkChanged = false;

            for (const mutation of mutations) {
                if (mutation.type === "attributes") {
                    if (touchesArtworkDom(mutation.target)) {
                        artworkChanged = true;
                    }
                    continue;
                }

                if (mutation.type === "characterData") {
                    if (touchesLyricDom(mutation.target)) {
                        shouldCheck = true;
                    }
                    continue;
                }

                if (mutation.type !== "childList") continue;
                if (touchesLyricDom(mutation.target)) {
                    shouldCheck = true;
                }
                if (touchesArtworkDom(mutation.target)) {
                    artworkChanged = true;
                }

                const changedNodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
                if (changedNodes.some(touchesLyricDom)) {
                    shouldCheck = true;
                }
                if (changedNodes.some(touchesArtworkDom)) {
                    artworkChanged = true;
                }
            }

            if (shouldCheck && !decorationInProgress() && !lyricVisualDomHealthy()) {
                state.decoratedGeneration = -1;
                stopAnimationLoop("lyric-dom-mutated");
                queueDecoration();
            }

            if (artworkChanged) {
                state.atmosphereLastCheck = 0;
                const media = getLocalMediaElement(true);
                if (media) {
                    refreshAtmosphere(media, true).catch((error: unknown) => warn("Dynamic Background artwork mutation refresh failed:", error));
                }
            }
        });

        const startObserver = () =>
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                /* Per-frame lyric transforms also mutate `style`, so do not
                 * observe that attribute globally. The 700 ms visual watchdog
                 * continuously probes CSS background artwork without adding a
                 * mutation record for every animated glyph. */
                attributeFilter: ["src", "srcset"],
            });

        if (document.documentElement) startObserver();
        else lifecycle.on(document, "DOMContentLoaded", startObserver, { once: true });
    }

    function installFontGeometryHooks() {
        const refreshForFonts = () => {
            if (lifecycle.isDisposed) return;
            state.fontGeometryRefreshCount += 1;
            queueMotionGeometryRefresh();
            wakeAnimationLoop();
        };
        document.fonts.ready.then(refreshForFonts).catch(() => {});
        lifecycle.on(document.fonts, "loadingdone", refreshForFonts);
    }

    function installReducedMotionHook() {
        try {
            reducedMotionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

            const refreshForPreferenceChange = () => {
                state.lastActiveLine = -999;
                state.lastActiveLineSignature = "";
                state.activeLineIndexes = [];
                resetMotionHandoffs();
                state.forceNextFrame = true;

                if (state.lyrics && isLyricsPage()) {
                    /* Existing grow layers must be rebuilt as plain wipe-only
                     * words (and vice versa) when the OS setting changes. */
                    state.decoratedGeneration = -1;
                    queueDecoration();
                    queueMotionGeometryRefresh();
                }

                wakeAnimationLoop();
            };

            lifecycle.on(reducedMotionMediaQuery, "change", refreshForPreferenceChange);
        } catch {
            // Keep playback usable if the host refuses preference observation.
        }
    }

    function installRouteHooks() {
        lifecycle.on(window, "hashchange", () => {
            updateLyricSyncButton();
            if (ROUTE_RE.test(location.hash)) {
                queueDecoration();
                ensureRomanizationToggle();
                ensureTimingControls();
                state.atmosphereMediaKey = "";
                state.lastActiveLine = -999;
                state.lastActiveLineSignature = "";
                state.activeLineIndexes = [];
                state.lyricAutoFollowSuspendedUntil = 0;
                state.lyricAutoFollowLastIndex = -1;
                wakeAnimationLoop();
            } else {
                removeRomanizationToggle();
                removeTimingControls();
                if (state.lyricToolsHost && state.lyricToolsHost.parentNode) {
                    state.lyricToolsHost.parentNode.removeChild(state.lyricToolsHost);
                }
                state.lyricToolsHost = null;
                cancelDecorationRetry(true);

                if (state.geometryTimer) {
                    lifecycle.clearTimeout(state.geometryTimer);
                    state.geometryTimer = 0;
                }

                invalidateAtmosphereLoads("route-leave");
                stopAnimationLoop("route-leave");
                clearDynamicProbeTimers();
                state.atmosphereDynamicProbeToken += 1;
                removeAtmosphereRoot("route-leave");
            }
        });

        lifecycle.on(
            window,
            "resize",
            () => {
                queueMotionGeometryRefresh();
                resizeDynamicBackgroundRenderer();
                wakeAnimationLoop();
            },
            { passive: true },
        );

        lifecycle.on(
            window,
            "orientationchange",
            () => {
                queueMotionGeometryRefresh();
                resizeDynamicBackgroundRenderer();
                wakeAnimationLoop();
            },
            { passive: true },
        );

        if (window.visualViewport) {
            lifecycle.on(
                window.visualViewport,
                "resize",
                () => {
                    queueMotionGeometryRefresh();
                    resizeDynamicBackgroundRenderer();
                    wakeAnimationLoop();
                },
                { passive: true },
            );
        }

        lifecycle.on(
            document,
            "visibilitychange",
            () => {
                if (document.hidden) {
                    stopAnimationLoop("document-hidden");
                    stopDynamicBackgroundRenderer("document-hidden");
                    return;
                }

                if (state.lyrics && isLyricsPage() && !lyricVisualDomHealthy()) {
                    queueDecoration();
                }

                resetPlaybackClock(getLocalMediaElement(true), performance.now());
                wakeAnimationLoop();
                if (state.atmosphereMode === "dynamic") startDynamicBackgroundRenderer();
            },
            { passive: true },
        );

        lifecycle.on(
            window,
            "pagehide",
            () => {
                cancelDecorationRetry(true);
                invalidateAtmosphereLoads("pagehide");
                clearDynamicProbeTimers();
                state.atmosphereDynamicProbeToken += 1;
                stopAnimationLoop("pagehide");
                stopDynamicBackgroundRenderer("pagehide");
            },
            { passive: true },
        );

        lifecycle.on(
            window,
            "pageshow",
            () => {
                if (state.lyrics && isLyricsPage()) {
                    queueDecoration();
                    wakeAnimationLoop();
                    if (state.atmosphereMode === "dynamic") startDynamicBackgroundRenderer();
                }
            },
            { passive: true },
        );
    }

    /*
     * LyricBridge is loaded first and passes accepted rich lyric models to this
     * renderer. Transport interception and response ordering belong to the bridge.
     */
    state.atmosphereMode = readAtmosphereMode();

    state.performanceMode = readPerformanceMode();

    state.performanceProfile = detectPerformanceProfile();
    document.documentElement.classList.toggle("ak-low-power", renderQuality === "low-power");
    lifecycle.own(() => document.documentElement.classList.remove("ak-low-power"));

    // LyricBridge owns lyric transport; this renderer receives accepted payloads.
    lifecycle.on(
        document,
        "viewbeforehide",
        (event) => {
            if (!eventElement(event)?.matches?.(".lyricPage")) return;
            state.lyricViewHidden = true;
            invalidateAtmosphereLoads("lyrics-view-hidden");
            clearDynamicProbeTimers();
            state.atmosphereDynamicProbeToken += 1;
            stopAnimationLoop("lyrics-view-hidden");
            stopDynamicBackgroundRenderer("lyrics-view-hidden");
        },
        true,
    );
    lifecycle.on(
        document,
        "viewshow",
        (event) => {
            if (!eventElement(event)?.matches?.(".lyricPage")) return;
            state.lyricViewHidden = false;
            queueMotionGeometryRefresh();
            wakeAnimationLoop();
            const media = getLocalMediaElement(true);
            if (media) maybeRefreshAtmosphere(media, performance.now());
            resizeDynamicBackgroundRenderer();
            updateAtmospherePlaybackState(media);
        },
        true,
    );
    installLyricSeekInteractionHooks();
    installLyricAutoFollowHooks();
    installDomObserver();
    installRouteHooks();
    installFontGeometryHooks();
    installReducedMotionHook();
    installLyricVisualWatchdog();

    function rendererFingerprint() {
        const words: RenderWord[] = [];

        state.lineData.forEach((line) => {
            (line.words || []).forEach((word) => words.push(word));
        });

        const geometry = {
            words: words.length,
            perGlyphWords: 0,
            rangeWords: 0,
            canvasFallbackWords: 0,
            wholeScriptWords: 0,
            wholeFallbackWords: 0,
        };

        words.forEach((word) => {
            const source = word.geometrySource || "unprepared";

            if (word.motionGlyphs && word.motionGlyphs.length) {
                geometry.perGlyphWords += 1;
            }

            if (source === "range") geometry.rangeWords += 1;
            else if (source === "canvas-fallback") {
                geometry.canvasFallbackWords += 1;
            } else if (source === "whole-joining-or-profile") {
                geometry.wholeScriptWords += 1;
            } else if (source.indexOf("whole-") === 0) {
                geometry.wholeFallbackWords += 1;
            }
        });

        const reducedMotionRequested = prefersReducedMotion();

        const currentWords: {
            text: string;
            motionMode: string;
            paintMode: string;
            geometrySource: string | undefined;
            motionGlyphCount: number;
            glowLayersPerGlyph: number;
        }[] = [];

        state.lineData.forEach((line) => {
            if (!line.element.classList.contains("ak-current") && !line.element.classList.contains("ak-overlap-current")) {
                return;
            }

            (line.words || []).forEach((word) => {
                currentWords.push({
                    text: word.text,
                    motionMode: word.motionMode,
                    paintMode: word.paintMode,
                    geometrySource: word.geometrySource,
                    motionGlyphCount: (word.motionGlyphs || []).length,
                    glowLayersPerGlyph: word.motionGlyphs && word.motionGlyphs[0] ? (word.motionGlyphs[0].glowLayers || []).length : 0,
                });
            });
        });

        return {
            version: VERSION,
            visualSignature: UNIFIED_RENDERER_SIGNATURE,
            requestedMode: state.performanceMode,
            detectedProfile: state.performanceProfile,
            fullQuality: state.performanceProfile === "desktop" || state.performanceProfile === "mobile",
            targetFps: PERFORMANCE_TARGET_FPS[state.performanceProfile],
            glowBuckets: glowBucketSteps(),
            glowRenderer: "classic-bloom-prepainted-core+halo",
            segmentSafeMotion: "per-grapheme-with-measured-fallback",
            contextualScriptMotion: "grapheme-safe-akshara-bloom+whole-joining-fallback",
            rtlSwipeDirection: "per-word-natural-reading-direction",
            cueTokenization: "source-preserved-for-cjk-thai-lao-khmer-myanmar",
            atmosphere: "kawarp-webgl:128px-preblur:domain-warp:260ms-godmode-transition",
            reducedMotionRequested,
            reducedMotionApplied: reducedMotionRequested,
            geometry,
            currentWords,
        };
    }

    const publicApi = Object.freeze({
        dispose() {
            if (lifecycle.isDisposed) return;
            state.generation++;
            state.lyricViewHidden = true;
            stopTimingSyncMode();
            removeTimingControls();
            removeRomanizationToggle();
            cancelDecorationRetry(true);
            invalidateAtmosphereLoads("dispose");
            clearDynamicProbeTimers();
            stopAnimationLoop("dispose");
            removeAtmosphereRoot("dispose");
            lifecycle.dispose();
            if (window.JellyfinLyricMotion === publicApi) delete window.JellyfinLyricMotion;
        },
        lifecycleResources: () => lifecycle.resourceCount,
        lifecycleDiagnostics: () => lifecycle.snapshot(),
        artworkPendingLoads: () => artworkLoader.pendingCount,

        version: VERSION,
        refreshLayout: queueMotionGeometryRefresh,
        redecorate: queueDecoration,
        beginTrack(itemId: string) {
            return beginLyricsRequest("/Audio/" + itemId + "/Lyrics");
        },
        applyRichPayload(payload: unknown, itemId?: string) {
            if (itemId && lyricsRequestIdentity("/Audio/" + itemId + "/Lyrics") !== state.lyricsRequestKey)
                beginLyricsRequest("/Audio/" + itemId + "/Lyrics");
            return acceptLyricsPayload(payload, "lyricbridge-refresh", state.lyricsRequestSeq);
        },
        accents() {
            return PREMIUM_ACCENTS.map((accent) => ({
                id: accent.id,
                name: accent.name,
                primaryRgb: accent.rgb,
                secondaryRgb: accent.secondaryRgb,
                tertiaryRgb: accent.tertiaryRgb,
            }));
        },
        setAccent: setAccentMode,
        nextAccent: rerollAccent,
        setPerformance: setPerformanceMode,
        setRenderQuality(quality: "standard" | "low-power") {
            if (quality !== "standard" && quality !== "low-power") throw new Error("Unknown rendering quality");
            renderQuality = quality;
            try {
                localStorage.setItem("lyricbridge.renderer.quality", quality);
            } catch {
                /* unavailable storage */
            }
            document.documentElement.classList.toggle("ak-low-power", quality === "low-power");
            for (const line of state.lineData) for (const word of line.words || []) resetWordMotion(word);
            rebuildDynamicBackgroundRenderer("render-quality");
            wakeAnimationLoop();
            return renderQuality;
        },
        renderQuality: () => renderQuality,
        setRomanization: setRomanizationMode,
        romanization() {
            return {
                mode: state.romanizationMode,
                available: state.romanizationAvailable,
                candidate: state.romanizationCandidate,
                loadState: state.romanizationLoadState,
                loadError: state.romanizationLoadError,
                source: state.romanizationSource,
                transformedLines: state.romanizationLineCount,
                toggleCount: state.romanizationToggleCount,
                provider: "google-translate-dt-rm",
                networkSources: true,
                googleState: state.googleRomanizationState,
                googleError: state.googleRomanizationError,
                googleTransformedLines: state.googleRomanizationLineCount,
                maxLineLength: GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
                songKey: state.songPreferenceKey,
            };
        },
        setSharedTimingOffset(seconds: number) {
            const normalized = clampTimingOffsetSeconds(seconds);
            if (state.sharedTimingOffsetSeconds === normalized) return;
            state.sharedTimingOffsetSeconds = normalized;
            suppressJellyfinLyricAutoFollow("shared-timing-change");
            invalidateTimingPaintState();
            updateTimingControlsUi();
            wakeAnimationLoop();
        },
        setTimingOffset: setTimingOffsetSeconds,
        adjustTimingOffset: adjustTimingOffsetSeconds,
        resetTimingOffset() {
            return resetTimingOffsetValue();
        },
        startTimingSync() {
            return beginTimingSyncMode();
        },
        undoTiming() {
            return undoTimingOffset();
        },
        timing() {
            return {
                seconds: state.timingOffsetSeconds,
                sharedSeconds: state.sharedTimingOffsetSeconds,
                effectiveSeconds: state.timingOffsetSeconds + state.sharedTimingOffsetSeconds,
                display: formatTimingOffset(),
                fineStepSeconds: TIMING_OFFSET_FINE_STEP_SECONDS,
                stepSeconds: TIMING_OFFSET_STEP_SECONDS,
                minSeconds: TIMING_OFFSET_MIN_SECONDS,
                maxSeconds: TIMING_OFFSET_MAX_SECONDS,
                changeCount: state.timingOffsetChangeCount,
                syncPickActive: state.timingPickActive,
                correctedClickSeek: true,
                autoFollow: {
                    suspendedUntil: state.lyricAutoFollowSuspendedUntil,
                    lastIndex: state.lyricAutoFollowLastIndex,
                    lastAt: state.lyricAutoFollowLastAt,
                    scrollCount: state.lyricAutoFollowScrollCount,
                    manualScrollCount: state.lyricAutoFollowManualScrollCount,
                    forceCount: state.lyricAutoFollowForceCount,
                    lastReason: state.lyricAutoFollowLastReason,
                    stockFollowerSuppressed: state.lyricStockAutoFollowSuppressCount > 0,
                    stockSuppressCount: state.lyricStockAutoFollowSuppressCount,
                    stockSuppressReason: state.lyricStockAutoFollowLastReason,
                },
                seekCount: state.lyricSeekCount,
                lastSeekKind: state.lastLyricSeekKind,
                timelineFingerprint: timingTimelineFingerprint(),
                songKey: state.songPreferenceKey,
            };
        },
        backgroundVocals: inspectBackgroundVocals,
        instrumentalBreaks: inspectInstrumentalBreaks,
        rendererFingerprint,
        performance() {
            const current = state.lineData[state.lastActiveLine] || null;
            return {
                animationLoopErrors: state.animationLoopErrors,
                animationLoopStarts: state.animationLoopStarts,
                animationLoopStops: state.animationLoopStops,
                lastAnimationLoopError: state.lastAnimationLoopError,
                renderedFrameCount: state.renderedFrameCount,
                mode: state.performanceMode,
                profile: state.performanceProfile,
                targetFps:
                    state.timedCueCount > 0
                        ? renderQuality === "low-power"
                            ? 30
                            : PERFORMANCE_TARGET_FPS[state.performanceProfile]
                        : LRC_TARGET_FPS,
                measuredFps: Number(state.measuredFps.toFixed(1)),
                timedCueCount: state.timedCueCount,
                perGlyphMotion: "multiscript-grapheme+whole-shaped",
                playbackClock: "phase-locked-monotonic",
                rafTargetGate: true,
                skippedRafFrames: state.skippedRafFrames,
                lyricVisualWatchdogMs: LYRIC_VISUAL_WATCHDOG_MS,
                lyricFrameRecoveryMs: LYRIC_FRAME_RECOVERY_MS,
                instrumentalSvg: "single-path-liquid-clip-v2",
                lineTransitionCount: state.lineTransitionCount,
                lastLineSyncCount: state.lastLineSyncCount,
                maxLineSyncCount: state.maxLineSyncCount,
                activeLineOnlyRendering: false,
                activeSetOnlyRendering: true,
                staticLinesUpdateOnlyOnLineChange: true,
                normalLrcTargetFps: LRC_TARGET_FPS,
                pausedTargetFps: PAUSED_TARGET_FPS,
                adaptiveAlbumAtmosphere: true,
                renderQuality,
                atmosphereMode: "dynamic-only",
                atmosphereArtwork: state.atmosphereArtwork,
                atmosphereSource: state.atmosphereSource,
                atmospherePendingKey: state.atmospherePendingKey,
                atmospherePendingMs:
                    state.atmospherePendingSince > 0 ? Number(Math.max(0, performance.now() - state.atmospherePendingSince).toFixed(1)) : 0,
                atmosphereTimeoutCount: state.atmosphereTimeoutCount,
                atmosphereDynamicPort: "chengggit-dynamic-background+kawarp-hardened+godmode-state-machine",
                atmosphereDynamicSource: DYNAMIC_BACKGROUND_SOURCE,
                atmosphereDynamicEngine: DYNAMIC_BACKGROUND_ENGINE,
                atmosphereDynamicTransitionMs: DYNAMIC_BACKGROUND_TRANSITION_MS,
                atmosphereColorExtraction: "none-direct-artwork-texture",
                atmosphereVisualIdentity: "24x24-rgb+edge-perceptual-fingerprint",
                atmosphereSameAlbumContinuity: true,
                atmosphereLyricLifecycleIndependent: true,
                atmosphereLatestMediaCommitOnly: true,
                atmosphereDomFallbackStabilityDelayMs: DYNAMIC_BACKGROUND_DOM_STABLE_MS,
                atmosphereUnboundDomConfirmMs: DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
                atmosphereInheritedDomStableMs: DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS,
                atmosphereInheritedDomConfirmMs: DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS,
                atmosphereDirectGraceMs: DYNAMIC_BACKGROUND_DIRECT_GRACE_MS,
                atmosphereDirectLoadTimeoutMs: DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS,
                atmosphereFastInheritedCommits: state.atmosphereDynamicFastInheritedCommits,
                atmosphereWeakRecheckMs: DYNAMIC_BACKGROUND_WEAK_RECHECK_MS,
                atmosphereNoArtConfirmMs: DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS,
                atmosphereNoArtRetryMs: DYNAMIC_BACKGROUND_NO_ART_RETRY_MS,
                atmosphereNoArtwork: state.atmosphereDynamicNoArtwork,
                atmosphereWebglFailureCount: state.atmosphereDynamicWebglFailureCount,
                atmosphereWebglRetryInMs: Math.max(0, state.atmosphereDynamicWebglRetryAt - performance.now()),
                atmosphereAudioCoupled: false,
                atmosphereRendering: state.atmosphereDynamicRenderer?.diagnostics() ?? null,
                atmosphereLyricReactive: false,
                atmosphereLiveCssBlur: false,
                atmospherePrebakedBlur: true,
                atmosphereStaleCommitDrops: state.atmosphereDynamicStaleCommitDrops,
                atmosphereVisualDedupCount: state.atmosphereDynamicVisualDedupCount,
                atmosphereFingerprintFailures: state.atmosphereDynamicFingerprintFailures,
                atmosphereDirectLoadFailures: state.atmosphereDynamicDirectLoadFailures,
                atmosphereDomFallbackCommits: state.atmosphereDynamicDomFallbackCommits,
                atmosphereCrossfadeMs: DYNAMIC_BACKGROUND_TRANSITION_MS,
                geometryAwareSwipe: true,
                connectedScriptPaint: "shaped-spatial-wipe",
                shapedWordCount: state.shapedWordCount,
                scriptProfileCounts: Object.assign({}, state.scriptProfileCounts),
                fontGeometryRefreshCount: state.fontGeometryRefreshCount,
                wipeBaseEm: BASE_WIPE_GRADIENT_EM,
                swipeSmoothingMs: WORD_PROGRESS_SMOOTH_TAU_MS,
                currentMotionPlan: current
                    ? (current.words || []).map((word) => ({
                          word: word.text,
                          motion: word.motionMode,
                          glow: word.motionGlow,
                          scriptProfile: word.scriptProfile,
                          paintMode: word.paintMode,
                          durationMs: Math.round(word.motionDurationMs),
                          geometryReady: word.geometryReady,
                          geometrySource: word.geometrySource,
                          glyphOverlay: !!(word.motionGlyphs && word.motionGlyphs.length),
                      }))
                    : [],
                graphemeSafeCueSplitting: true,
                userToasts: false,
            };
        },
    });

    window.JellyfinLyricMotion = publicApi;
    const bridgeSnapshot = window.LyricBridge?.rendererSnapshot?.();
    if (bridgeSnapshot) publicApi.applyRichPayload(bridgeSnapshot.payload, bridgeSnapshot.itemId);
    /* Maintained console alias; both globals own the same installation. */

    log(`v${VERSION} loaded`);
    return publicApi;
}

export type RendererApi = NonNullable<ReturnType<typeof installRenderer>>;
