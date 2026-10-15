import {
    LYRIC_VISUAL_WATCHDOG_MS,
    LYRIC_FRAME_RECOVERY_MS,
    PERFORMANCE_STORAGE_KEY,
    GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
    TIMING_OFFSET_FINE_STEP_SECONDS,
    TIMING_OFFSET_STEP_SECONDS,
    TIMING_OFFSET_MIN_SECONDS,
    TIMING_OFFSET_MAX_SECONDS,
    PERFORMANCE_TARGET_FPS,
    LRC_TARGET_FPS,
    PAUSED_TARGET_FPS,
    MEDIA_DISCOVERY_RETRY_MS,
    PREMIUM_ACCENTS,
} from "./settings.ts";
import { createRendererDiagnostics } from "./diagnostics.ts";
import { detectScriptProfile } from "./text-processing.ts";
import { createWordModel } from "./word-model.ts";
import { createInstrumentalView } from "./instrumental-view.ts";
import { requireValue } from "../shared/invariants.ts";
import type {} from "../shared/runtime.ts";
import { createAccentController } from "./accent-controller.ts";
import { createArtworkController } from "./artwork-controller.ts";
import { createAutoFollow } from "./auto-follow.ts";
import { createControlsPreferences } from "./controls-preferences.ts";
import type { CueInput } from "./cue-ranges.ts";
import { createLyricView } from "./lyric-view.ts";
import type { RenderWord } from "./models.ts";
import type { LyricInput } from "./payload.ts";
import { createPlaybackCoordinator } from "./playback-coordinator.ts";
import { createPronunciationController } from "./pronunciation-controller.ts";
import { createSongPreferences } from "./song-preferences.ts";
import { createRendererState } from "./state.ts";
function eventElement(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target : null;
}
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

import { ArtworkLoader } from "./artwork-loader.ts";
import { replaceChildren, setText } from "./dom.ts";
import { createWordGeometry } from "./geometry.ts";
import { detectStockJellyfinTvEnvironment, getCurrentLyricPage, getCurrentLyricsContainer, isLyricsPage, isLyricsUrl, ROUTE_RE } from "./host.ts";
import { createKaraokeAnimation } from "./karaoke-animation.ts";
import { Lifecycle } from "../shared/lifecycle.ts";
import { cueValue, lyricPayloadIdentity, lyricTimingMode, normalizeLyricsPayload, usableEnhancedCueCount } from "./payload.ts";
import { projectClock, resetClock } from "./playback-clock.ts";
import { calculateLineBounds as timelineBounds } from "./timeline.ts";
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
    const lifecycle = new Lifecycle();
    let hookedMedia: HTMLMediaElement | null = null;
    const mediaWakeReleases: (() => void)[] = [];
    lifecycle.own(() => releaseMediaWakeHooks());
    const artworkLoader = new ArtworkLoader(
        () => new Image(),
        () => artwork.recordTimeout(),
    );
    lifecycle.own(() => artworkLoader.dispose());

    let reducedMotionMediaQuery: MediaQueryList | null = null;

    const state = createRendererState();

    function log(...args: unknown[]) {
        console.log("[JellyfinLyricMotion]", ...args);
    }

    function warn(...args: unknown[]) {
        console.warn("[JellyfinLyricMotion]", ...args);
    }

    const { buildWordRecords, visibleWordLength, canUseGraphemeMotionOverlay, classifyWordMotion } = createWordModel({
        cueEndTicks: (...args) => cueEndTicks(...args),
        prefersReducedMotion,
    });

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
                !controls.isTimingPickActive() &&
                state.activeInstrumentalGapIndex < 0 &&
                performance.now() >= autoFollow.suspendedUntil &&
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
        state,
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
            const root = artwork.root;
            if (root && root.isConnected && artwork.artwork) {
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
        resetTimingInteraction();
        if (typeof removeRomanizationToggle === "function") removeRomanizationToggle();
        if (typeof removeTimingControls === "function") removeTimingControls();
        removeTools();
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        resetMotionHandoffs();
        autoFollow.reset("lyrics-cleared", true);
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
            artwork.trackChanged();
            scheduleDynamicBackgroundProbeBurst("lyrics-accepted");
        }

        const cueCount = usableEnhancedCueCount(lyrics);

        state.timedCueCount = cueCount;
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        resetMotionHandoffs();
        autoFollow.reset("lyrics-accepted");
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
        state,
        resetTimingInteraction: () => controls.resetTimingInteraction(),
        lyricSignature: (...args) => lyricSignature(...args),
        stableHash: (...args) => stableHash(...args),
        updateRomanizationToggleUi: (...args) => updateRomanizationToggleUi(...args),
        updateTimingControlsUi: (...args) => updateTimingControlsUi(...args),
    });

    const { cancelPronunciationRequests, lyricsHaveNativeScript, requestGoogleRomanizationForLyrics, displayLyricForCurrentMode } =
        createPronunciationController({
            lifecycle,
            state,
            redecorateForRomanization: (...args) => redecorateForRomanization(...args),
            warn: (...args) => warn(...args),
        });

    const calculateLineBounds = (lyric: LyricInput, lineIndex: number, words: RenderWord[], cues: CueInput[], rawTextLength: number) =>
        timelineBounds(state.lyrics, lyric, lineIndex, words, cues, rawTextLength);
    const autoFollow = createAutoFollow({
        state,
        lifecycle,
        isTimingPickActive: () => controls.isTimingPickActive(),
        motion: {
            get query() {
                return reducedMotionMediaQuery;
            },
            set query(value) {
                reducedMotionMediaQuery = value;
            },
        },
    });
    const {
        suppressJellyfinLyricAutoFollow,
        updateLyricSyncButton,
        lyricPlaybackFollowIndex,
        focusLyricLineIndex,
        refreshLyricScrollSpace,
        installLyricAutoFollowHooks,
    } = autoFollow;
    const controls = createControlsPreferences({
        state,
        clampTimingOffsetSeconds: (...args) => clampTimingOffsetSeconds(...args),
        resetWordMotion: (...args) => resetWordMotion(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        persistCurrentSongPreference: (...args) => persistCurrentSongPreference(...args),
        finiteNumber: (...args) => finiteNumber(...args),
        resetPlaybackClock: (...args) => resetPlaybackClock(...args),
        chooseTimelineTicks: (...args) => chooseTimelineTicks(...args),
        getLocalMediaElement: (...args) => getLocalMediaElement(...args),
        autoFollow,
        lifecycle,
        warn: (...args) => warn(...args),
        sourceTimelineTicks: (...args) => sourceTimelineTicks(...args),
        queueDecoration: (...args) => queueDecoration(...args),
        requestGoogleRomanizationForLyrics: (...args) => requestGoogleRomanizationForLyrics(...args),
        lyricsHaveNativeScript: (...args) => lyricsHaveNativeScript(...args),
        loadSongPreferences: (...args) => loadSongPreferences(...args),
    });
    const {
        formatTimingOffset,
        updateTimingControlsUi,
        invalidateTimingPaintState,
        setTimingOffsetSeconds,
        adjustTimingOffsetSeconds,
        resetTimingOffsetValue,
        undoTimingOffset,
        stopTimingSyncMode,
        beginTimingSyncMode,
        installLyricSeekInteractionHooks,
        removeTimingControls,
        ensureTimingControls,
        removeRomanizationToggle,
        updateRomanizationToggleUi,
        ensureRomanizationToggle,
        redecorateForRomanization,
        setRomanizationMode,
        prepareRomanizationForLyrics,
        resetTimingInteraction,
        removeTools,
    } = controls;

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

    const {
        removeInstrumentalGapRows,
        installInstrumentalGapRows,
        findInstrumentalGapAtTicks,
        instrumentalGapDistanceBand,
        updateInstrumentalGapVisual,
        inspectInstrumentalBreaks,
    } = createInstrumentalView({
        instrumentalSeekCount: () => controls.instrumentalSeekCount,
        state,
        finiteNumber,
        prefersReducedMotion,
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
        invalidateFollowTarget: () => autoFollow.invalidateTarget(),
        displayLyricForCurrentMode: (...args) => displayLyricForCurrentMode(...args),
        state,
        createUntimedSpan: (...args) => createUntimedSpan(...args),
        calculateLineBounds: (...args) => calculateLineBounds(...args),
        cueEndTicks: (...args) => cueEndTicks(...args),
        buildWordRecords: (...args) => buildWordRecords(...args),
        classifyWordMotion: (...args) => classifyWordMotion(...args),
        createWordSpan: (...args) => createWordSpan(...args),
        lifecycle,
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
            artwork.requestRefresh();
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

    const artwork = createArtworkController({
        state,
        applyPerformanceClassToPage: (...args) => applyPerformanceClassToPage(...args),
        artworkLoader,
        lifecycle,
        getLocalMediaElement: (...args) => getLocalMediaElement(...args),
        warn: (...args) => warn(...args),
        prefersReducedMotion: (...args) => prefersReducedMotion(...args),
    });
    const {
        removeAtmosphereRoot,
        invalidateAtmosphereLoads,
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
    } = artwork;

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
                artwork.requestRefresh();
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
                    if (returningFromInstrumental) autoFollow.invalidateTarget();
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
                artwork.requestRefresh();
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
                artwork.resetMediaIdentity();
                state.lastActiveLine = -999;
                state.lastActiveLineSignature = "";
                state.activeLineIndexes = [];
                autoFollow.reset("media-change");
                wakeAnimationLoop();
            } else {
                removeRomanizationToggle();
                removeTimingControls();
                removeTools();
                cancelDecorationRetry(true);

                if (state.geometryTimer) {
                    lifecycle.clearTimeout(state.geometryTimer);
                    state.geometryTimer = 0;
                }

                invalidateAtmosphereLoads("route-leave");
                stopAnimationLoop("route-leave");
                artwork.cancelProbes();
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
                startDynamicBackgroundRenderer();
            },
            { passive: true },
        );

        lifecycle.on(
            window,
            "pagehide",
            () => {
                cancelDecorationRetry(true);
                invalidateAtmosphereLoads("pagehide");
                artwork.cancelProbes();
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
                    startDynamicBackgroundRenderer();
                }
            },
            { passive: true },
        );
    }

    /*
     * LyricBridge is loaded first and passes accepted rich lyric models to this
     * renderer. Transport interception and response ordering belong to the bridge.
     */

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
            artwork.cancelProbes();
            artwork.cancelProbes();
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

    const { rendererFingerprint, performance: performanceDiagnostics } = createRendererDiagnostics({
        artworkDiagnostics: () => artwork.diagnostics(),
        state,
        version: VERSION,
        renderQuality: () => renderQuality,
        prefersReducedMotion,
        glowBucketSteps,
    });

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
            artwork.cancelProbes();
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
            const interaction = controls.diagnostics();
            return {
                mode: state.romanizationMode,
                available: state.romanizationAvailable,
                candidate: state.romanizationCandidate,
                loadState: state.romanizationLoadState,
                loadError: state.romanizationLoadError,
                source: state.romanizationSource,
                transformedLines: state.romanizationLineCount,
                toggleCount: interaction.romanizationToggleCount,
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
            const follow = autoFollow.diagnostics();
            const interaction = controls.diagnostics();
            return {
                seconds: state.timingOffsetSeconds,
                sharedSeconds: state.sharedTimingOffsetSeconds,
                effectiveSeconds: state.timingOffsetSeconds + state.sharedTimingOffsetSeconds,
                display: formatTimingOffset(),
                fineStepSeconds: TIMING_OFFSET_FINE_STEP_SECONDS,
                stepSeconds: TIMING_OFFSET_STEP_SECONDS,
                minSeconds: TIMING_OFFSET_MIN_SECONDS,
                maxSeconds: TIMING_OFFSET_MAX_SECONDS,
                changeCount: interaction.timingOffsetChangeCount,
                syncPickActive: controls.isTimingPickActive(),
                correctedClickSeek: true,
                autoFollow: {
                    suspendedUntil: autoFollow.suspendedUntil,
                    lastIndex: follow.lyricAutoFollowLastIndex,
                    lastAt: follow.lyricAutoFollowLastAt,
                    scrollCount: follow.lyricAutoFollowScrollCount,
                    manualScrollCount: follow.lyricAutoFollowManualScrollCount,
                    forceCount: follow.lyricAutoFollowForceCount,
                    lastReason: follow.lyricAutoFollowLastReason,
                    stockFollowerSuppressed: follow.lyricStockAutoFollowSuppressCount > 0,
                    stockSuppressCount: follow.lyricStockAutoFollowSuppressCount,
                    stockSuppressReason: follow.lyricStockAutoFollowLastReason,
                },
                seekCount: interaction.lyricSeekCount,
                lastSeekKind: interaction.lastLyricSeekKind,
                timelineFingerprint: timingTimelineFingerprint(),
                songKey: state.songPreferenceKey,
            };
        },
        backgroundVocals: inspectBackgroundVocals,
        instrumentalBreaks: inspectInstrumentalBreaks,
        rendererFingerprint,
        performance: performanceDiagnostics,
    });

    window.JellyfinLyricMotion = publicApi;
    const bridgeSnapshot = window.LyricBridge?.rendererSnapshot?.();
    if (bridgeSnapshot) publicApi.applyRichPayload(bridgeSnapshot.payload, bridgeSnapshot.itemId);

    log(`v${VERSION} loaded`);
    return publicApi;
}

export type RendererApi = NonNullable<ReturnType<typeof installRenderer>>;
