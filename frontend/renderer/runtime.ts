import type {} from "../platform/globals.ts";
import type {} from "../platform/globals.ts";
import type { AccentStatePort } from "./appearance/accent-ports.ts";
import {
    GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
    PREMIUM_ACCENTS,
    TIMING_OFFSET_FINE_STEP_SECONDS,
    TIMING_OFFSET_MAX_SECONDS,
    TIMING_OFFSET_MIN_SECONDS,
    TIMING_OFFSET_STEP_SECONDS,
} from "./common/settings.ts";
import { createRendererDiagnostics } from "./diagnostics/diagnostics.ts";
import { createHostInstallation } from "./host/installation.ts";
import type { HostInstallationStatePort } from "./host/ports.ts";
import type { RenderGap, RenderLine } from "./lyrics/models.ts";
import { createLyricSession } from "./lyrics/session-controller.ts";
import type { LyricSessionStatePort } from "./lyrics/session-ports.ts";
import type { FrameSchedulerStatePort } from "./playback/frame-ports.ts";
import { createFrameScheduler } from "./playback/frame-scheduler.ts";
import { createMediaController } from "./playback/media-controller.ts";
import type { MediaStatePort } from "./playback/media-ports.ts";
import { createPerformancePolicy } from "./preferences/performance-policy.ts";
import type { PerformancePolicyStatePort } from "./preferences/performance-ports.ts";
import type { SongPreferencesStatePort } from "./preferences/song-ports.ts";
import type { PronunciationStatePort } from "./pronunciation/ports.ts";

import { createAccentController } from "./appearance/accent-controller.ts";
import { createArtworkController } from "./appearance/artwork-controller.ts";
import { createAutoFollow } from "./follow/auto-follow.ts";
import { createControlsPreferences } from "./preferences/controls-preferences.ts";
import { createSongPreferences } from "./preferences/song-preferences.ts";
import { createPronunciationController } from "./pronunciation/pronunciation-controller.ts";
function eventElement(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target : null;
}

import type { RendererApi } from "../contracts/renderer.ts";
import { Lifecycle } from "../shared/lifecycle.ts";
import { ArtworkLoader } from "./appearance/artwork-loader.ts";
import { detectStockJellyfinTvEnvironment } from "./host/host.ts";
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
    const lifecycle = new Lifecycle();
    const lyricsPort: LyricSessionStatePort = {
        clearHandoffLineIndexes(): void {
            return lyricSession.clearHandoffLineIndexes();
        },
        resetActiveLineScratch(): number[] {
            return lyricSession.resetActiveLineScratch();
        },
        get snapshot() {
            return lyricSession.snapshot;
        },
        setDecoratedGeneration(value: number): void {
            return lyricSession.setDecoratedGeneration(value);
        },
        setAnimationWatchdogRecoveries(value: number): void {
            return lyricSession.setAnimationWatchdogRecoveries(value);
        },
        setLastActiveLine(value: number): void {
            return lyricSession.setLastActiveLine(value);
        },
        setLastActiveLineSignature(value: string): void {
            return lyricSession.setLastActiveLineSignature(value);
        },
        setActiveLineIndexes(value: number[]): void {
            return lyricSession.setActiveLineIndexes(value);
        },
        setGeometryTimer(value: number): void {
            return lyricSession.setGeometryTimer(value);
        },
        setInstrumentalPastCount(value: number): void {
            return lyricSession.setInstrumentalPastCount(value);
        },
        setInstrumentalPhaseActiveIndex(value: number): void {
            return lyricSession.setInstrumentalPhaseActiveIndex(value);
        },
        setInstrumentalGaps(value: RenderGap[]): void {
            return lyricSession.setInstrumentalGaps(value);
        },
        setActiveInstrumentalGapIndex(value: number): void {
            return lyricSession.setActiveInstrumentalGapIndex(value);
        },
        setInstrumentalGapMaxDurationTicks(value: number): void {
            return lyricSession.setInstrumentalGapMaxDurationTicks(value);
        },
        setInstrumentalGapRenderCount(value: number): void {
            return lyricSession.setInstrumentalGapRenderCount(value);
        },
        setRetiredLineElements(value: HTMLElement[]): void {
            return lyricSession.setRetiredLineElements(value);
        },
        setBackgroundAnchorTimer(value: number): void {
            return lyricSession.setBackgroundAnchorTimer(value);
        },
        setBackgroundVocalCount(value: number): void {
            return lyricSession.setBackgroundVocalCount(value);
        },
        setLineData(value: RenderLine[]): void {
            return lyricSession.setLineData(value);
        },
        setLineEndPrefix(value: number[]): void {
            return lyricSession.setLineEndPrefix(value);
        },
        setShapedWordCount(value: number): void {
            return lyricSession.setShapedWordCount(value);
        },
        setScriptProfileCounts(value: Record<string, number>): void {
            return lyricSession.setScriptProfileCounts(value);
        },
        appendLineData(...values: RenderLine[]): number {
            return lyricSession.appendLineData(...values);
        },
        setScriptProfileCountsEntry(key: string, value: number): void {
            return lyricSession.setScriptProfileCountsEntry(key, value);
        },
        setDecorationRetryStartedAt(value: number): void {
            return lyricSession.setDecorationRetryStartedAt(value);
        },
        setDecorationRetryCount(value: number): void {
            return lyricSession.setDecorationRetryCount(value);
        },
        setDecorationRetryExpiredCount(value: number): void {
            return lyricSession.setDecorationRetryExpiredCount(value);
        },
        setOverlapFrameCount(value: number): void {
            return lyricSession.setOverlapFrameCount(value);
        },
        setMaxSimultaneousLines(value: number): void {
            return lyricSession.setMaxSimultaneousLines(value);
        },
        addHandoffLineIndexes(value: number): void {
            return lyricSession.addHandoffLineIndexes(value);
        },
        removeHandoffLineIndexes(key: number): boolean {
            return lyricSession.removeHandoffLineIndexes(key);
        },
        advanceGeneration(delta: number): number {
            return lyricSession.advanceGeneration(delta);
        },
    };
    const mediaPort: MediaStatePort = {
        get snapshot() {
            return mediaController.snapshot;
        },
    };
    const framesPort: FrameSchedulerStatePort = {
        get snapshot() {
            return frameScheduler.snapshot;
        },
        setForceNextFrame(value: boolean): void {
            return frameScheduler.setForceNextFrame(value);
        },
        setLineTransitionCount(value: number): void {
            return frameScheduler.setLineTransitionCount(value);
        },
        setLastLineSyncCount(value: number): void {
            return frameScheduler.setLastLineSyncCount(value);
        },
        setMaxLineSyncCount(value: number): void {
            return frameScheduler.setMaxLineSyncCount(value);
        },
        setLastRenderedFrameAt(value: number): void {
            return frameScheduler.setLastRenderedFrameAt(value);
        },
    };
    const performancePort: PerformancePolicyStatePort = {
        get snapshot() {
            return performancePolicy.snapshot;
        },
        restorePerformanceMode(value: "auto" | "desktop" | "mobile"): void {
            return performancePolicy.restorePerformanceMode(value);
        },
        setPerformanceProfile(value: "desktop" | "mobile"): void {
            return performancePolicy.setPerformanceProfile(value);
        },
    };
    const hostPort: HostInstallationStatePort = {
        get snapshot() {
            return hostInstallation.snapshot;
        },
        setLyricViewHidden(value: boolean): void {
            return hostInstallation.setLyricViewHidden(value);
        },
    };
    const accentPort: AccentStatePort = {
        get snapshot() {
            return accentController.snapshot;
        },
        setAccentReplayArmed(value: boolean): void {
            return accentController.setAccentReplayArmed(value);
        },
    };
    const pronunciationPort: PronunciationStatePort = {
        get snapshot() {
            return pronunciationController.snapshot;
        },
        setRomanizationLineCount(value: number): void {
            return pronunciationController.setRomanizationLineCount(value);
        },
        setRomanizationMode(value: string): void {
            return pronunciationController.setRomanizationMode(value);
        },
        clearGoogleRomanizationCache(): void {
            return pronunciationController.clearGoogleRomanizationCache();
        },
        clearGoogleRomanizationFragmentCache(): void {
            return pronunciationController.clearGoogleRomanizationFragmentCache();
        },
        clearGoogleRomanizationAttempted(): void {
            return pronunciationController.clearGoogleRomanizationAttempted();
        },
        setGoogleRomanizationRequest(value: Promise<void> | null): void {
            return pronunciationController.setGoogleRomanizationRequest(value);
        },
        setGoogleRomanizationState(value: string): void {
            return pronunciationController.setGoogleRomanizationState(value);
        },
        setGoogleRomanizationError(value: string): void {
            return pronunciationController.setGoogleRomanizationError(value);
        },
        setGoogleRomanizationLineCount(value: number): void {
            return pronunciationController.setGoogleRomanizationLineCount(value);
        },
        setRomanizationCandidate(value: boolean): void {
            return pronunciationController.setRomanizationCandidate(value);
        },
        setRomanizationAvailable(value: boolean): void {
            return pronunciationController.setRomanizationAvailable(value);
        },
        setRomanizationLoadState(value: string): void {
            return pronunciationController.setRomanizationLoadState(value);
        },
        setRomanizationSource(value: string): void {
            return pronunciationController.setRomanizationSource(value);
        },
        setRomanizationLoadError(value: string): void {
            return pronunciationController.setRomanizationLoadError(value);
        },
    };
    const preferencesPort: SongPreferencesStatePort = {
        get snapshot() {
            return songPreferences.snapshot;
        },
        setTimingOffsetSeconds(value: number): void {
            return songPreferences.setTimingOffsetSeconds(value);
        },
        setSharedTimingOffsetSeconds(value: number): void {
            return songPreferences.setSharedTimingOffsetSeconds(value);
        },
        setSongPreferenceKey(value: string): void {
            return songPreferences.setSongPreferenceKey(value);
        },
    };
    let renderQuality: "standard" | "low-power" = "standard";
    try {
        if (localStorage.getItem("lyricbridge.renderer.quality") === "low-power") renderQuality = "low-power";
    } catch {
        /* unavailable storage */
    }
    const lyricSession = createLyricSession({
        lyricsPort: lyricsPort,
        hostPort: hostPort,
        framesPort: framesPort,

        pronunciationPort: pronunciationPort,
        preferencesPort: preferencesPort,
        yieldLyricsWork: (...args) => yieldLyricsWork(...args),
        refreshLyricScrollSpace: (...args) => refreshLyricScrollSpace(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        get controls() {
            return controls;
        },
        get autoFollow() {
            return autoFollow;
        },
        focusLyricLineIndex: (...args) => focusLyricLineIndex(...args),
        lyricPlaybackFollowIndex: (...args) => lyricPlaybackFollowIndex(...args),
        get lifecycle() {
            return lifecycle;
        },
        warn: (...args) => warn(...args),
        shouldUsePerGlyphMotion: (...args) => shouldUsePerGlyphMotion(...args),
        invalidateAtmosphereLoads: (...args) => invalidateAtmosphereLoads(...args),
        stopAnimationLoop: (...args) => stopAnimationLoop(...args),
        get artwork() {
            return artwork;
        },
        removeAtmosphereRoot: (...args) => removeAtmosphereRoot(...args),
        resetTimingInteraction: (...args) => resetTimingInteraction(...args),
        removeRomanizationToggle: (...args) => removeRomanizationToggle(...args),
        removeTimingControls: (...args) => removeTimingControls(...args),
        removeTools: (...args) => removeTools(...args),
        resetPlaybackClock: (...args) => resetPlaybackClock(...args),
        log: (...args) => log(...args),
        cancelPronunciationRequests: (...args) => cancelPronunciationRequests(...args),
        selectSongAccent: (...args) => selectSongAccent(...args),
        scheduleDynamicBackgroundProbeBurst: (...args) => scheduleDynamicBackgroundProbeBurst(...args),
        applySongPreferences: (...args) => applySongPreferences(...args),
        prepareRomanizationForLyrics: (...args) => prepareRomanizationForLyrics(...args),
        displayLyricForCurrentMode: (...args) => displayLyricForCurrentMode(...args),
        suppressJellyfinLyricAutoFollow: (...args) => suppressJellyfinLyricAutoFollow(...args),
        ensureRomanizationToggle: (...args) => ensureRomanizationToggle(...args),
        ensureTimingControls: (...args) => ensureTimingControls(...args),
        applyAccentTheme: (...args) => applyAccentTheme(...args),
        applyPerformanceProfile: (...args) => applyPerformanceProfile(...args),
        ensureAnimationLoop: (...args) => ensureAnimationLoop(...args),
        currentAccent: (...args) => currentAccent(...args),
        prefersReducedMotion: (...args) => prefersReducedMotion(...args),
        finiteNumber: (...args) => finiteNumber(...args),
        clampTimingOffsetSeconds: (...args) => clampTimingOffsetSeconds(...args),
        projectedMediaSeconds: (...args) => projectedMediaSeconds(...args),
        getStartTimeTicksFromUrl: (...args) => getStartTimeTicksFromUrl(...args),
    });
    const {
        queueMotionGeometryRefresh,
        stableHash,
        lyricSignature,
        lyricsRequestIdentity,
        beginLyricsRequest,
        acceptLyricsPayload,
        findInstrumentalGapAtTicks,
        updateInstrumentalGapVisual,
        inspectInstrumentalBreaks,
        decorationInProgress,
        queueBackgroundVocalAnchorRefresh,
        inspectBackgroundVocals,
        lineRecordHealthy,
        instrumentalGapRowsHealthy,
        lyricVisualDomHealthy,
        cancelDecorationRetry,
        queueDecoration,
        isMobileEnvironment,
        findLineIndexAtTicks,
        sameIndexList,
        findActiveLineIndexesAtTicks,
        glowBucketSteps,
        resetWordMotion,
        updateWordVisual,
        sourceTimelineTicks,
        chooseTimelineTicks,
        resetMotionHandoffs,
        syncStaticLineStates,
        updateLineHandoffs,
    } = lyricSession;

    const mediaController = createMediaController({
        currentLyricsItemId: (...args) => currentLyricsItemId(...args),
        mediaItemId: (...args) => mediaItemId(...args),
        accentPort: accentPort,
        lyricsPort: lyricsPort,
        resetPlaybackClock: (...args) => resetPlaybackClock(...args),
        readAccentMode: (...args) => readAccentMode(...args),
        selectSongAccent: (...args) => selectSongAccent(...args),
        get artwork() {
            return artwork;
        },
        scheduleDynamicBackgroundProbeBurst: (...args) => scheduleDynamicBackgroundProbeBurst(...args),
        updateAtmospherePlaybackState: (...args) => updateAtmospherePlaybackState(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        get lifecycle() {
            return lifecycle;
        },
    });
    const { getLocalMediaElement, getStartTimeTicksFromUrl, releaseMediaWakeHooks, ensureMediaWakeHooks } = mediaController;

    lifecycle.own(() => releaseMediaWakeHooks());
    const artworkLoader = new ArtworkLoader(
        () => new Image(),
        () => artwork.recordTimeout(),
    );
    lifecycle.own(() => artworkLoader.dispose());

    const hostInstallation = createHostInstallation({
        lyricVisualDomHealthy: (...args) => lyricVisualDomHealthy(...args),
        lineRecordHealthy: (...args) => lineRecordHealthy(...args),
        instrumentalGapRowsHealthy: (...args) => instrumentalGapRowsHealthy(...args),
        maybeRefreshAtmosphere: (...args) => maybeRefreshAtmosphere(...args),
        queueDecoration: (...args) => queueDecoration(...args),
        decorationInProgress: (...args) => decorationInProgress(...args),
        refreshAtmosphere: (...args) => refreshAtmosphere(...args),
        resetMotionHandoffs: (...args) => resetMotionHandoffs(...args),
        updateLyricSyncButton: (...args) => updateLyricSyncButton(...args),
        ensureRomanizationToggle: (...args) => ensureRomanizationToggle(...args),
        ensureTimingControls: (...args) => ensureTimingControls(...args),
        removeRomanizationToggle: (...args) => removeRomanizationToggle(...args),
        removeTimingControls: (...args) => removeTimingControls(...args),
        removeTools: (...args) => removeTools(...args),
        cancelDecorationRetry: (...args) => cancelDecorationRetry(...args),
        invalidateAtmosphereLoads: (...args) => invalidateAtmosphereLoads(...args),
        removeAtmosphereRoot: (...args) => removeAtmosphereRoot(...args),
        resizeDynamicBackgroundRenderer: (...args) => resizeDynamicBackgroundRenderer(...args),
        stopDynamicBackgroundRenderer: (...args) => stopDynamicBackgroundRenderer(...args),
        startDynamicBackgroundRenderer: (...args) => startDynamicBackgroundRenderer(...args),
        lyricsPort: lyricsPort,
        framesPort: framesPort,
        get lifecycle() {
            return lifecycle;
        },
        getLocalMediaElement: (...args) => getLocalMediaElement(...args),
        shouldRunAnimationLoop: (...args) => shouldRunAnimationLoop(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        stopAnimationLoop: (...args) => stopAnimationLoop(...args),
        get artwork() {
            return artwork;
        },
        warn: (...args) => warn(...args),
        queueMotionGeometryRefresh: (...args) => queueMotionGeometryRefresh(...args),
        get autoFollow() {
            return autoFollow;
        },
        resetPlaybackClock: (...args) => resetPlaybackClock(...args),
    });
    const { motion, installLyricVisualWatchdog, installDomObserver, installFontGeometryHooks, installReducedMotionHook, installRouteHooks } =
        hostInstallation;

    function log(...args: unknown[]) {
        console.log("[JellyfinLyricMotion]", ...args);
    }

    function warn(...args: unknown[]) {
        console.warn("[JellyfinLyricMotion]", ...args);
    }

    const yieldLyricsWork = async () => {
        await lifecycle.sleep();
    };

    const accentController = createAccentController({
        lyricsPort: lyricsPort,
        stableHash: (...args) => stableHash(...args),
        lyricSignature: (...args) => lyricSignature(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
    });
    const { readAccentMode, applyAccentTheme, selectSongAccent, setAccentMode, rerollAccent, currentAccent } = accentController;

    const songPreferences = createSongPreferences({
        lyricsPort: lyricsPort,
        pronunciationPort: pronunciationPort,
        resetTimingInteraction: () => controls.resetTimingInteraction(),
        lyricSignature: (...args) => lyricSignature(...args),
        stableHash: (...args) => stableHash(...args),
        updateRomanizationToggleUi: (...args) => updateRomanizationToggleUi(...args),
        updateTimingControlsUi: (...args) => updateTimingControlsUi(...args),
    });
    const {
        finiteNumber,
        clampTimingOffsetSeconds,
        loadSongPreferences,
        timingTimelineFingerprint,
        applySongPreferences,
        persistCurrentSongPreference,
    } = songPreferences;

    const pronunciationController = createPronunciationController({
        lifecycle,
        lyricsPort: lyricsPort,
        redecorateForRomanization: (...args) => redecorateForRomanization(...args),
        warn: (...args) => warn(...args),
    });
    const { cancelPronunciationRequests, lyricsHaveNativeScript, requestGoogleRomanizationForLyrics, displayLyricForCurrentMode } =
        pronunciationController;

    const autoFollow = createAutoFollow({
        lyricsPort: lyricsPort,
        lifecycle,
        isTimingPickActive: () => controls.isTimingPickActive(),
        motion: {
            get query() {
                return motion.query;
            },
            set query(value) {
                motion.query = value;
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
        lyricsPort: lyricsPort,
        preferencesPort: preferencesPort,
        framesPort: framesPort,
        pronunciationPort: pronunciationPort,
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
            if (!motion.query && window.matchMedia) {
                motion.query = window.matchMedia("(prefers-reduced-motion: reduce)");
            }

            return !!(motion.query && motion.query.matches);
        } catch {
            return false;
        }
    }

    const performancePolicy = createPerformancePolicy({
        framesPort: framesPort,
        lyricsPort: lyricsPort,
        isMobileEnvironment: (...args) => isMobileEnvironment(...args),
        invalidateAtmosphereLoads: (...args) => invalidateAtmosphereLoads(...args),
        get artwork() {
            return artwork;
        },
        rebuildDynamicBackgroundRenderer: (...args) => rebuildDynamicBackgroundRenderer(...args),
        applyAccentTheme: (...args) => applyAccentTheme(...args),
        queueMotionGeometryRefresh: (...args) => queueMotionGeometryRefresh(...args),
        wakeAnimationLoop: (...args) => wakeAnimationLoop(...args),
        prefersReducedMotion: (...args) => prefersReducedMotion(...args),
        get renderQuality() {
            return renderQuality;
        },
        set renderQuality(value) {
            renderQuality = value;
        },
    });
    const {
        readPerformanceMode,
        detectPerformanceProfile,
        applyPerformanceClassToPage,
        applyPerformanceProfile,
        setPerformanceMode,
        shouldUsePerGlyphMotion,
        getTargetFrameInterval,
    } = performancePolicy;

    const frameScheduler = createFrameScheduler({
        hostPort: hostPort,
        mediaPort: mediaPort,
        lyricsPort: lyricsPort,
        get lifecycle() {
            return lifecycle;
        },
        getTargetFrameInterval: (...args) => getTargetFrameInterval(...args),
        queueDecoration: (...args) => queueDecoration(...args),
        getLocalMediaElement: (...args) => getLocalMediaElement(...args),
        warn: (...args) => warn(...args),
        ensureMediaWakeHooks: (...args) => ensureMediaWakeHooks(...args),
        chooseTimelineTicks: (...args) => chooseTimelineTicks(...args),
        maybeRefreshAtmosphere: (...args) => maybeRefreshAtmosphere(...args),
        findLineIndexAtTicks: (...args) => findLineIndexAtTicks(...args),
        findInstrumentalGapAtTicks: (...args) => findInstrumentalGapAtTicks(...args),
        findActiveLineIndexesAtTicks: (...args) => findActiveLineIndexesAtTicks(...args),
        sameIndexList: (...args) => sameIndexList(...args),
        syncStaticLineStates: (...args) => syncStaticLineStates(...args),
        queueBackgroundVocalAnchorRefresh: (...args) => queueBackgroundVocalAnchorRefresh(...args),
        get autoFollow() {
            return autoFollow;
        },
        focusLyricLineIndex: (...args) => focusLyricLineIndex(...args),
        lyricPlaybackFollowIndex: (...args) => lyricPlaybackFollowIndex(...args),
        updateInstrumentalGapVisual: (...args) => updateInstrumentalGapVisual(...args),
        updateAtmospherePlaybackState: (...args) => updateAtmospherePlaybackState(...args),
        updateWordVisual: (...args) => updateWordVisual(...args),
        updateLineHandoffs: (...args) => updateLineHandoffs(...args),
        updateLyricSyncButton: (...args) => updateLyricSyncButton(...args),
    });
    const { shouldRunAnimationLoop, stopAnimationLoop, wakeAnimationLoop, ensureAnimationLoop } = frameScheduler;

    const artwork = createArtworkController({
        mediaPort: mediaPort,
        performancePort: performancePort,

        lyricsPort: lyricsPort,
        hostPort: hostPort,
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

    const resetPlaybackClock = (media: HTMLMediaElement | null = null, frameNow: number = performance.now()) =>
        mediaController.anchorClock(media, frameNow);
    const projectedMediaSeconds = (media: HTMLMediaElement, frameNow: number) => mediaController.projectMediaClock(media, frameNow);

    /*
     * LyricBridge is loaded first and passes accepted rich lyric models to this
     * renderer. Transport interception and response ordering belong to the bridge.
     */

    performancePort.restorePerformanceMode(readPerformanceMode());

    performancePort.setPerformanceProfile(detectPerformanceProfile());
    document.documentElement.classList.toggle("ak-low-power", renderQuality === "low-power");
    lifecycle.own(() => document.documentElement.classList.remove("ak-low-power"));

    // LyricBridge owns lyric transport; this renderer receives accepted payloads.
    lifecycle.on(
        document,
        "viewbeforehide",
        (event) => {
            if (!eventElement(event)?.matches?.(".lyricPage")) return;
            hostPort.setLyricViewHidden(true);
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
            hostPort.setLyricViewHidden(false);
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
        lyricsPort: lyricsPort,
        performancePort: performancePort,
        framesPort: framesPort,
        hostPort: hostPort,
        version: VERSION,
        renderQuality: () => renderQuality,
        prefersReducedMotion,
        glowBucketSteps,
    });

    const publicApi: RendererApi = Object.freeze({
        dispose() {
            if (lifecycle.isDisposed) return;
            lyricsPort.advanceGeneration(1);
            hostPort.setLyricViewHidden(true);
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
            if (itemId && lyricsRequestIdentity("/Audio/" + itemId + "/Lyrics") !== lyricsPort.snapshot.lyricsRequestKey)
                beginLyricsRequest("/Audio/" + itemId + "/Lyrics");
            return acceptLyricsPayload(payload, "lyricbridge-refresh", lyricsPort.snapshot.lyricsRequestSeq);
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
            for (const line of lyricsPort.snapshot.lineData) for (const word of line.words || []) resetWordMotion(word);
            rebuildDynamicBackgroundRenderer("render-quality");
            wakeAnimationLoop();
            return renderQuality;
        },
        renderQuality: () => renderQuality,
        setRomanization: setRomanizationMode,
        romanization() {
            const interaction = controls.diagnostics();
            return {
                mode: pronunciationPort.snapshot.romanizationMode,
                available: pronunciationPort.snapshot.romanizationAvailable,
                candidate: pronunciationPort.snapshot.romanizationCandidate,
                loadState: pronunciationPort.snapshot.romanizationLoadState,
                loadError: pronunciationPort.snapshot.romanizationLoadError,
                source: pronunciationPort.snapshot.romanizationSource,
                transformedLines: pronunciationPort.snapshot.romanizationLineCount,
                toggleCount: interaction.romanizationToggleCount,
                provider: "google-translate-dt-rm",
                networkSources: true,
                googleState: pronunciationPort.snapshot.googleRomanizationState,
                googleError: pronunciationPort.snapshot.googleRomanizationError,
                googleTransformedLines: pronunciationPort.snapshot.googleRomanizationLineCount,
                maxLineLength: GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
                songKey: preferencesPort.snapshot.songPreferenceKey,
            };
        },
        setSharedTimingOffset(seconds: number) {
            const normalized = clampTimingOffsetSeconds(seconds);
            if (preferencesPort.snapshot.sharedTimingOffsetSeconds === normalized) return;
            preferencesPort.setSharedTimingOffsetSeconds(normalized);
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
                seconds: preferencesPort.snapshot.timingOffsetSeconds,
                sharedSeconds: preferencesPort.snapshot.sharedTimingOffsetSeconds,
                effectiveSeconds: preferencesPort.snapshot.timingOffsetSeconds + preferencesPort.snapshot.sharedTimingOffsetSeconds,
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
                songKey: preferencesPort.snapshot.songPreferenceKey,
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

/** @public Preserves the supported type import independently of installation inference. */
