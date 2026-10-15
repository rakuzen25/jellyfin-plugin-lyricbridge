/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type {} from "../shared/runtime.ts";
import type { Accent, RenderGap, RenderLine, SongPreference } from "./models.ts";
import type { LyricInput } from "./payload.ts";
export interface RendererState {
    lyrics: LyricInput[] | null;
    generation: number;
    decoratedGeneration: number;
    lyricsRequestSeq: number;
    lyricsRequestKey: string;
    lyricsRequestKeys: Map<number, string>;
    lyricsAcceptedKey: string;
    lyricsAcceptedSeq: number;
    lyricsStaleResponseDrops: number;
    lineData: RenderLine[];
    rafId: number;
    frameTimer: number;
    animationLoopRunning: boolean;
    animationLoopStarts: number;
    animationLoopStops: number;
    animationLoopErrors: number;
    animationLoopRecoveries: number;
    animationWatchdogRecoveries: number;
    animationWatchdogTimer: number;
    lastAnimationLoopError: string;
    lastMediaWarning: number;
    geometryTimer: number;
    backgroundAnchorTimer: number;
    decorationRetryStartedAt: number;
    decorationRetryCount: number;
    decorationRetryExpiredCount: number;
    lastActiveLine: number;
    lastActiveLineSignature: string;
    activeLineIndexes: number[];
    activeLineScratch: number[];
    handoffLineIndexes: Set<number>;
    retiredLineElements: HTMLElement[];
    lineEndPrefix: number[];
    instrumentalGaps: RenderGap[];
    activeInstrumentalGapIndex: number;
    instrumentalPhaseActiveIndex: number;
    instrumentalPastCount: number;
    instrumentalGapRenderCount: number;
    instrumentalGapMaxDurationTicks: number;
    mediaElement: HTMLMediaElement | null;
    mediaProbeAt: number;
    mediaSwitchCount: number;
    staleMediaEventDrops: number;
    timedCueCount: number;
    lyricTimingMode: string;
    backgroundVocalCount: number;
    overlapFrameCount: number;
    maxSimultaneousLines: number;
    performanceMode: "auto" | "desktop" | "mobile";
    performanceProfile: "desktop" | "mobile";
    performanceFrameCount: number;
    performanceWindowStart: number;
    measuredFps: number;
    lastRenderedFrameAt: number;
    forceNextFrame: boolean;
    pausedSettleUntil: number;
    lyricViewHidden: boolean;
    renderedFrameCount: number;
    watchdogLineCursor: number;
    skippedRafFrames: number;
    lineTransitionCount: number;
    lastLineSyncCount: number;
    maxLineSyncCount: number;
    playbackClockMedia: HTMLMediaElement | null;
    playbackClockSeconds: number;
    playbackClockRawSeconds: number;
    playbackClockFrameNow: number;
    playbackClockCorrectionMs: number;
    playbackClockHardSnaps: number;
    playbackClockSuspended: boolean;
    mediaStartOffsetSource: string;
    mediaStartOffsetTicks: number;
    accentMode: string;
    accent: Accent | null;
    accentSignature: string;
    accentHistory: string[];
    accentBag: string[];
    accentRandomSource: string;
    accentSelectionReason: string;
    accentReplayArmed: boolean;
    shapedWordCount: number;
    scriptProfileCounts: Record<string, number>;
    fontGeometryRefreshCount: number;
    romanizationMode: string;
    romanizationAvailable: boolean;
    romanizationCandidate: boolean;
    romanizationLoadState: string;
    romanizationLoadError: string;
    romanizationSource: string;
    googleRomanizationCache: Map<string, string>;
    googleRomanizationFragmentCache: Map<string, string>;
    googleRomanizationAttempted: Set<string>;
    googleRomanizationRequest: Promise<void> | null;
    googleRomanizationState: string;
    googleRomanizationError: string;
    googleRomanizationLineCount: number;
    romanizationLineCount: number;
    songPreferenceKey: string;
    songPreferences: Record<string, SongPreference>;
    timingOffsetSeconds: number;
    sharedTimingOffsetSeconds: number;
}

/** Every installation owns fresh collections, counters and DOM references. */
export function createRendererState(): RendererState {
    return {
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
        googleRomanizationCache: new Map(),
        googleRomanizationFragmentCache: new Map(),
        googleRomanizationAttempted: new Set(),
        googleRomanizationRequest: null,
        googleRomanizationState: "idle",
        googleRomanizationError: "",
        googleRomanizationLineCount: 0,
        romanizationLineCount: 0,

        songPreferenceKey: "",
        songPreferences: Object.create(null),
        timingOffsetSeconds: 0,
        sharedTimingOffsetSeconds: 0,

        // Dynamic Background state. This build intentionally has one atmosphere engine.
    };
}
