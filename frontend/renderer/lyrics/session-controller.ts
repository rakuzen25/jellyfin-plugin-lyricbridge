/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { readView } from "../../shared/read-view.ts";
import type { ArtworkLifecyclePort } from "../appearance/ports.ts";
import { replaceChildren, setText } from "../common/dom.ts";
import type { AutoFollowPort } from "../follow/ports.ts";
import { getCurrentLyricsContainer, isLyricsPage, isLyricsUrl } from "../host/host.ts";
import type { HostInstallationStatePort } from "../host/ports.ts";
import type { FrameSchedulerStatePort } from "../playback/frame-ports.ts";
import { calculateLineBounds as timelineBounds } from "../playback/timeline.ts";
import type { SongPreferencesStatePort } from "../preferences/song-ports.ts";
import type { PronunciationStatePort } from "../pronunciation/ports.ts";
import { detectScriptProfile } from "../pronunciation/text-processing.ts";
import type { CueInput } from "./cue-ranges.ts";
import { createWordGeometry } from "./geometry.ts";
import { createInstrumentalView } from "./instrumental-view.ts";
import { createKaraokeAnimation } from "./karaoke-animation.ts";
import { createPlaybackCoordinator } from "./line-playback.ts";
import { createLyricView } from "./lyric-view.ts";
import type { Accent, RenderGap, RenderLine, RenderWord } from "./models.ts";
import type { LyricInput } from "./payload.ts";
import { cueValue, lyricPayloadIdentity, lyricTimingMode, normalizeLyricsPayload, usableEnhancedCueCount } from "./payload.ts";
import type { LyricSessionState, LyricSessionStatePort } from "./session-ports.ts";
import { createWordModel } from "./word-model.ts";

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
interface Dependencies {
    lyricsPort: LyricSessionStatePort;
    hostPort: HostInstallationStatePort;
    framesPort: FrameSchedulerStatePort;
    pronunciationPort: PronunciationStatePort;
    preferencesPort: SongPreferencesStatePort;
    yieldLyricsWork: () => Promise<void>;
    refreshLyricScrollSpace: (force?: boolean) => void;
    wakeAnimationLoop: () => void;
    controls: { readonly instrumentalSeekCount: number; isTimingPickActive(): boolean };
    autoFollow: AutoFollowPort;
    focusLyricLineIndex: (
        lineIndex: number,
        { force, behavior, reason }?: { force?: boolean; behavior?: ScrollBehavior; reason?: string },
    ) => boolean;
    lyricPlaybackFollowIndex: (lineIndex: number) => number;
    lifecycle: Lifecycle;
    warn: (...args: unknown[]) => void;
    shouldUsePerGlyphMotion: (glyphCount: number) => boolean;
    invalidateAtmosphereLoads: (source?: string) => string;
    stopAnimationLoop: (reason?: string) => string;
    artwork: ArtworkLifecyclePort;
    removeAtmosphereRoot: (source?: string) => void;
    resetTimingInteraction: () => void;
    removeRomanizationToggle: () => void;
    removeTimingControls: () => void;
    removeTools: () => void;
    resetPlaybackClock: (media?: HTMLMediaElement | null, frameNow?: number) => void;
    log: (...args: unknown[]) => void;
    cancelPronunciationRequests: () => void;
    selectSongAccent: (lyrics: LyricInput[], force?: boolean, reason?: string) => void;
    scheduleDynamicBackgroundProbeBurst: (source?: string) => string;
    applySongPreferences: (lyrics?: LyricInput[] | null) => void;
    prepareRomanizationForLyrics: () => void;
    displayLyricForCurrentMode: (lyric: LyricInput) => LyricInput;
    suppressJellyfinLyricAutoFollow: (reason?: string) => boolean;
    ensureRomanizationToggle: () => HTMLButtonElement | null;
    ensureTimingControls: () => HTMLButtonElement | null;
    applyAccentTheme: () => void;
    applyPerformanceProfile: (refreshGeometry?: boolean) => void;
    ensureAnimationLoop: () => boolean;
    currentAccent: () =>
        | Accent
        | Readonly<{
              id: "neutral-fallback";
              name: "Neutral Fallback";
              rgb: "214, 226, 255";
              secondaryRgb: "196, 180, 255";
              tertiaryRgb: "255, 214, 238";
              gain: 0.72;
          }>;
    prefersReducedMotion: () => boolean;
    finiteNumber: (value: unknown, fallback?: number) => number;
    clampTimingOffsetSeconds: (value: unknown) => number;
    projectedMediaSeconds: (media: HTMLMediaElement, frameNow: number) => number;
    getStartTimeTicksFromUrl: (media: HTMLMediaElement | null) => number;
}

/** Owns lyric session behavior and its installation lifetime. */
export function createLyricSession(deps: Dependencies) {
    const state: LyricSessionState = {
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
        animationWatchdogRecoveries: 0,
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
        timedCueCount: 0,
        lyricTimingMode: "none",
        backgroundVocalCount: 0,
        overlapFrameCount: 0,
        maxSimultaneousLines: 1,
        shapedWordCount: 0,
        scriptProfileCounts: {},
    };
    const snapshot = readView(state);

    let acceptedOriginalIdentity = "",
        acceptedOriginalTrack = "";

    const { buildWordRecords, visibleWordLength, canUseGraphemeMotionOverlay, classifyWordMotion } = createWordModel({
        cueEndTicks: (...args) => cueEndTicks(...args),
        prefersReducedMotion: deps.prefersReducedMotion,
    });

    const { prepareWordGeometry } = createWordGeometry({
        visibleWordLength,
        canUseGraphemeMotionOverlay,
        shouldUsePerGlyphMotion: (...args) => deps.shouldUsePerGlyphMotion(...args),
    });

    let geometryRevision = 0;

    async function refreshMotionGeometry(revision = geometryRevision, preserveScroll = false) {
        const generation = state.generation,
            records = state.lineData;
        let batchStart = performance.now();
        for (const line of records) {
            for (const word of line.words || []) {
                if (revision !== geometryRevision || generation !== state.generation || records !== state.lineData || !isLyricsPage()) return;
                prepareWordGeometry(word);
                if (performance.now() - batchStart >= 8) {
                    await deps.yieldLyricsWork();
                    batchStart = performance.now();
                }
            }
        }
        if (revision === geometryRevision && generation === state.generation && records === state.lineData) {
            alignBackgroundVocalAnchors();
            deps.refreshLyricScrollSpace(true);
            deps.wakeAnimationLoop();
            if (
                !preserveScroll &&
                !deps.controls.isTimingPickActive() &&
                state.activeInstrumentalGapIndex < 0 &&
                performance.now() >= deps.autoFollow.suspendedUntil &&
                state.lastActiveLine >= 0
            )
                deps.focusLyricLineIndex(deps.lyricPlaybackFollowIndex(state.lastActiveLine), {
                    force: true,
                    behavior: "auto",
                    reason: "layout-refresh",
                });
        }
    }

    function queueMotionGeometryRefresh(preserveScroll = false) {
        const revision = ++geometryRevision;
        if (!state.lyrics || !isLyricsPage()) {
            if (state.geometryTimer) {
                deps.lifecycle.clearTimeout(state.geometryTimer);
                state.geometryTimer = 0;
            }
            return false;
        }

        deps.lifecycle.clearTimeout(state.geometryTimer);

        state.geometryTimer = deps.lifecycle.timeout(() => {
            state.geometryTimer = 0;

            if (!state.lyrics || !isLyricsPage()) {
                return;
            }

            deps.lifecycle.frame(() => {
                if (!state.lyrics || !isLyricsPage()) {
                    return;
                }

                refreshMotionGeometry(revision, preserveScroll).catch((error: unknown) => deps.warn("Geometry refresh failed", error));
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
            deps.lifecycle.clearTimeout(state.geometryTimer);
            state.geometryTimer = 0;
        }
        if (state.backgroundAnchorTimer) {
            deps.lifecycle.clearTimeout(state.backgroundAnchorTimer);
            state.backgroundAnchorTimer = 0;
        }

        /* Cancel any artwork decode owned by the outgoing track, but never hide
         * or reset the currently rendered field during lyric-payload churn. */
        deps.invalidateAtmosphereLoads(source);
        deps.stopAnimationLoop(source);
        retireDecoratedLines(source === "request-switch");

        if (keepDynamicVisible) {
            const root = deps.artwork.root;
            if (root && root.isConnected && deps.artwork.artwork) {
                root.classList.add("ak-atmosphere-ready");
            }
            document.documentElement.classList.add("ak-lyricmotion-atmosphere-active");
            document.documentElement.classList.add("ak-atmosphere-dynamic-mode");
        } else {
            deps.removeAtmosphereRoot(source);
        }

        state.lyrics = null;
        state.lyricsAcceptedKey = "";
        if (hadLyrics) state.generation += 1;
        state.decoratedGeneration = -1;
        state.lineData = [];
        state.timedCueCount = 0;
        state.lyricTimingMode = "none";
        state.backgroundVocalCount = 0;
        deps.pronunciationPort.setRomanizationAvailable(false);
        deps.pronunciationPort.setRomanizationCandidate(false);
        if (deps.pronunciationPort.snapshot.googleRomanizationCache) {
            deps.pronunciationPort.clearGoogleRomanizationCache();
        }
        if (deps.pronunciationPort.snapshot.googleRomanizationFragmentCache) {
            deps.pronunciationPort.clearGoogleRomanizationFragmentCache();
        }
        if (deps.pronunciationPort.snapshot.googleRomanizationAttempted) {
            deps.pronunciationPort.clearGoogleRomanizationAttempted();
        }
        deps.pronunciationPort.setGoogleRomanizationRequest(null);
        deps.pronunciationPort.setGoogleRomanizationState("idle");
        deps.pronunciationPort.setGoogleRomanizationError("");
        deps.pronunciationPort.setGoogleRomanizationLineCount(0);
        deps.pronunciationPort.setRomanizationLineCount(0);
        deps.preferencesPort.setSongPreferenceKey("");
        deps.preferencesPort.setTimingOffsetSeconds(0);
        deps.resetTimingInteraction();
        if (typeof deps.removeRomanizationToggle === "function") deps.removeRomanizationToggle();
        if (typeof deps.removeTimingControls === "function") deps.removeTimingControls();
        deps.removeTools();
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        resetMotionHandoffs();
        deps.autoFollow.reset("lyrics-cleared", true);
        state.lineEndPrefix = [];
        state.instrumentalGaps = [];
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;
        state.instrumentalGapRenderCount = 0;
        state.instrumentalGapMaxDurationTicks = 0;
        state.overlapFrameCount = 0;
        state.maxSimultaneousLines = 1;
        deps.resetPlaybackClock();

        if (hadLyrics) deps.log(`cleared captured lyrics from ${source}`);
        return hadLyrics;
    }

    function lyricsRequestIdentity(url: string) {
        if (!isLyricsUrl(url)) return "";

        const raw = String(url || "");
        const withoutHash = raw.split("#", 1)[0];
        const queryIndex = requireValue(withoutHash).indexOf("?");
        const rawPath = queryIndex >= 0 ? requireValue(withoutHash).slice(0, queryIndex) : withoutHash;
        const path = requireValue(rawPath)
            .replace(/^https?:\/\/[^/]+/i, "")
            .replace(/\/{2,}/g, "/")
            .toLowerCase();

        return path;
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
            deps.cancelPronunciationRequests();
            clearCapturedLyrics("request-switch");
        }

        return state.lyricsRequestSeq;
    }

    function scheduleLyricVisualRecoveryBurst(generation: number, reason: string = "lyrics") {
        for (const delay of [48, 160, 420]) {
            deps.lifecycle.timeout(() => {
                if (generation !== state.generation || !state.lyrics || document.hidden || !isLyricsPage()) {
                    return;
                }

                if (!lyricVisualDomHealthy()) {
                    queueDecoration();
                    return;
                }

                deps.wakeAnimationLoop();
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
        deps.selectSongAccent(lyrics);

        /* Lyrics and background are independent state machines. Keep the current
         * shader field visible, invalidate only obsolete asynchronous art work,
         * then probe the CURRENT media element several times while Jellyfin swaps
         * its player source. */
        if (trackChanged) {
            deps.invalidateAtmosphereLoads("lyrics-accepted");
            deps.artwork.trackChanged();
            deps.scheduleDynamicBackgroundProbeBurst("lyrics-accepted");
        }

        const cueCount = usableEnhancedCueCount(lyrics);

        state.timedCueCount = cueCount;
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        resetMotionHandoffs();
        deps.autoFollow.reset("lyrics-accepted");
        state.lineEndPrefix = [];
        state.instrumentalGaps = [];
        state.activeInstrumentalGapIndex = -1;
        state.instrumentalPhaseActiveIndex = -1;
        state.instrumentalPastCount = 0;
        state.instrumentalGapRenderCount = 0;
        state.instrumentalGapMaxDurationTicks = 0;
        state.overlapFrameCount = 0;
        state.maxSimultaneousLines = 1;
        deps.resetPlaybackClock();
        deps.applySongPreferences(lyrics);

        deps.log(`captured ${lyrics.length} lyric lines / ${cueCount} usable cues ` + `(${state.lyricTimingMode}) from ${source}`);
        if (typeof deps.prepareRomanizationForLyrics === "function") {
            deps.prepareRomanizationForLyrics();
        }
        queueDecoration();
        scheduleLyricVisualRecoveryBurst(state.generation, "lyrics-accepted");

        if (state.lyricTimingMode === "plain") {
            deps.log("Plain unsynced lyrics detected; applying typography-only presentation.");
        } else if (cueCount === 0) {
            deps.warn("Lyrics loaded without enhanced ELRC cue data.");
        }

        return true;
    }

    function createUntimedSpan(text: string) {
        const span = document.createElement("span");

        const scriptProfile = detectScriptProfile(text);

        span.className = "ak-untimed " + `ak-script-${scriptProfile}`;

        return setText(span, text);
    }

    const calculateLineBounds = (lyric: LyricInput, lineIndex: number, words: RenderWord[], cues: CueInput[], rawTextLength: number) =>
        timelineBounds(state.lyrics, lyric, lineIndex, words, cues, rawTextLength);

    const {
        removeInstrumentalGapRows,
        installInstrumentalGapRows,
        findInstrumentalGapAtTicks,
        instrumentalGapDistanceBand,
        updateInstrumentalGapVisual,
        inspectInstrumentalBreaks,
    } = createInstrumentalView({
        instrumentalSeekCount: () => deps.controls.instrumentalSeekCount,
        lyricsPort: deps.lyricsPort,
        finiteNumber: deps.finiteNumber,
        prefersReducedMotion: deps.prefersReducedMotion,
        smoothstepBetween: (...args) => smoothstepBetween(...args),
    });

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
        invalidateFollowTarget: () => deps.autoFollow.invalidateTarget(),
        displayLyricForCurrentMode: (...args) => deps.displayLyricForCurrentMode(...args),
        lyricsPort: deps.lyricsPort,
        hostPort: deps.hostPort,
        pronunciationPort: deps.pronunciationPort,
        createUntimedSpan: (...args) => createUntimedSpan(...args),
        calculateLineBounds: (...args) => calculateLineBounds(...args),
        cueEndTicks: (...args) => cueEndTicks(...args),
        buildWordRecords: (...args) => buildWordRecords(...args),
        classifyWordMotion: (...args) => classifyWordMotion(...args),
        createWordSpan: (...args) => createWordSpan(...args),
        lifecycle: deps.lifecycle,
        stableHash: (...args) => stableHash(...args),
        removeInstrumentalGapRows: (...args) => removeInstrumentalGapRows(...args),
        resetMotionHandoffs: (...args) => resetMotionHandoffs(...args),
        removeRomanizationToggle: (...args) => deps.removeRomanizationToggle(...args),
        removeTimingControls: (...args) => deps.removeTimingControls(...args),
        stopAnimationLoop: (...args) => deps.stopAnimationLoop(...args),
        suppressJellyfinLyricAutoFollow: (...args) => deps.suppressJellyfinLyricAutoFollow(...args),
        yieldLyricsWork: (...args) => deps.yieldLyricsWork(...args),
        installInstrumentalGapRows: (...args) => installInstrumentalGapRows(...args),
        ensureRomanizationToggle: (...args) => deps.ensureRomanizationToggle(...args),
        ensureTimingControls: (...args) => deps.ensureTimingControls(...args),
        applyAccentTheme: (...args) => deps.applyAccentTheme(...args),
        applyPerformanceProfile: (...args) => deps.applyPerformanceProfile(...args),
        queueMotionGeometryRefresh: (...args) => queueMotionGeometryRefresh(...args),
        ensureAnimationLoop: (...args) => deps.ensureAnimationLoop(...args),
        warn: (...args) => deps.warn(...args),
    });

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

    function sameIndexList(left: readonly number[] | null, right: readonly number[] | null) {
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
    } = createKaraokeAnimation(deps.currentAccent, () => !deps.prefersReducedMotion());

    const { sourceTimelineTicks, chooseTimelineTicks, cueEndTicks, resetMotionHandoffs, syncStaticLineStates, updateLineHandoffs } =
        createPlaybackCoordinator({
            finiteNumber: (...args) => deps.finiteNumber(...args),
            clampTimingOffsetSeconds: (...args) => deps.clampTimingOffsetSeconds(...args),
            preferencesPort: deps.preferencesPort,
            lyricsPort: deps.lyricsPort,
            framesPort: deps.framesPort,
            projectedMediaSeconds: (...args) => deps.projectedMediaSeconds(...args),
            getStartTimeTicksFromUrl: (...args) => deps.getStartTimeTicksFromUrl(...args),
            getJellyfinActiveLineIndex: (...args) => getJellyfinActiveLineIndex(...args),
            findLineIndexAtTicks: (...args) => findLineIndexAtTicks(...args),
            instrumentalGapDistanceBand: (...args) => instrumentalGapDistanceBand(...args),
            motionHandoffActive: (...args) => motionHandoffActive(...args),
            setStaticWordState: (...args) => setStaticWordState(...args),
            resetWordMotion: (...args) => resetWordMotion(...args),
            motionContinuityGain: (...args) => motionContinuityGain(...args),
            updateMotionGlyphs: (...args) => updateMotionGlyphs(...args),
            updateWholeMotion: (...args) => updateWholeMotion(...args),
        });
    return {
        clearHandoffLineIndexes(): void {
            state.handoffLineIndexes.clear();
        },
        resetActiveLineScratch(): number[] {
            state.activeLineScratch.length = 0;
            return state.activeLineScratch;
        },
        snapshot,
        setDecoratedGeneration(value: number): void {
            state.decoratedGeneration = value;
        },
        setAnimationWatchdogRecoveries(value: number): void {
            state.animationWatchdogRecoveries = value;
        },
        setLastActiveLine(value: number): void {
            state.lastActiveLine = value;
        },
        setLastActiveLineSignature(value: string): void {
            state.lastActiveLineSignature = value;
        },
        setActiveLineIndexes(value: number[]): void {
            state.activeLineIndexes = value;
        },
        setGeometryTimer(value: number): void {
            state.geometryTimer = value;
        },
        setInstrumentalPastCount(value: number): void {
            state.instrumentalPastCount = value;
        },
        setInstrumentalPhaseActiveIndex(value: number): void {
            state.instrumentalPhaseActiveIndex = value;
        },
        setInstrumentalGaps(value: RenderGap[]): void {
            state.instrumentalGaps = value;
        },
        setActiveInstrumentalGapIndex(value: number): void {
            state.activeInstrumentalGapIndex = value;
        },
        setInstrumentalGapMaxDurationTicks(value: number): void {
            state.instrumentalGapMaxDurationTicks = value;
        },
        setInstrumentalGapRenderCount(value: number): void {
            state.instrumentalGapRenderCount = value;
        },
        setRetiredLineElements(value: HTMLElement[]): void {
            state.retiredLineElements = value;
        },
        setBackgroundAnchorTimer(value: number): void {
            state.backgroundAnchorTimer = value;
        },
        setBackgroundVocalCount(value: number): void {
            state.backgroundVocalCount = value;
        },
        setLineData(value: RenderLine[]): void {
            state.lineData = value;
        },
        setLineEndPrefix(value: number[]): void {
            state.lineEndPrefix = value;
        },
        setShapedWordCount(value: number): void {
            state.shapedWordCount = value;
        },
        setScriptProfileCounts(value: Record<string, number>): void {
            state.scriptProfileCounts = value;
        },
        appendLineData(...values: RenderLine[]): number {
            return state.lineData.push(...values);
        },
        setScriptProfileCountsEntry(key: string, value: number): void {
            state.scriptProfileCounts[key] = value;
        },
        setDecorationRetryStartedAt(value: number): void {
            state.decorationRetryStartedAt = value;
        },
        setDecorationRetryCount(value: number): void {
            state.decorationRetryCount = value;
        },
        setDecorationRetryExpiredCount(value: number): void {
            state.decorationRetryExpiredCount = value;
        },
        setOverlapFrameCount(value: number): void {
            state.overlapFrameCount = value;
        },
        setMaxSimultaneousLines(value: number): void {
            state.maxSimultaneousLines = value;
        },
        addHandoffLineIndexes(value: number): void {
            state.handoffLineIndexes.add(value);
        },
        removeHandoffLineIndexes(key: number): boolean {
            return state.handoffLineIndexes.delete(key);
        },
        advanceGeneration(delta: number): number {
            const previous = state.generation;
            state.generation += delta;
            return previous;
        },
        buildWordRecords,
        visibleWordLength,
        canUseGraphemeMotionOverlay,
        classifyWordMotion,
        prepareWordGeometry,
        refreshMotionGeometry,
        queueMotionGeometryRefresh,
        createWordSpan,
        stableHash,
        lyricSignature,
        retireDecoratedLines,
        clearCapturedLyrics,
        lyricsRequestIdentity,
        beginLyricsRequest,
        scheduleLyricVisualRecoveryBurst,
        acceptLyricsPayload,
        createUntimedSpan,
        calculateLineBounds,
        removeInstrumentalGapRows,
        installInstrumentalGapRows,
        findInstrumentalGapAtTicks,
        instrumentalGapDistanceBand,
        updateInstrumentalGapVisual,
        inspectInstrumentalBreaks,
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
        getJellyfinActiveLineIndex,
        findLineIndexAtTicks,
        sameIndexList,
        findActiveLineIndexesAtTicks,
        smoothstepBetween,
        glowBucketSteps,
        motionContinuityGain,
        motionHandoffActive,
        updateMotionGlyphs,
        updateWholeMotion,
        resetWordMotion,
        updateWordVisual,
        setStaticWordState,
        sourceTimelineTicks,
        chooseTimelineTicks,
        cueEndTicks,
        resetMotionHandoffs,
        syncStaticLineStates,
        updateLineHandoffs,
    };
}
