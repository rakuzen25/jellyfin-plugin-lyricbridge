/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
/** Public renderer contracts. Keep independent of installation and mutable implementation state. */
type RendererLifecycleSnapshot = {
    readonly disposed: boolean;
    readonly cleanups: number;
    readonly frames: number;
    readonly timers: number;
    readonly intervals: number;
};

type RendererAccent = { id: string; name: string; primaryRgb: string; secondaryRgb: string; tertiaryRgb: string };

type RendererAccentSelection = { mode: string; accent: string; name: string; primaryRgb: string; secondaryRgb: string; tertiaryRgb: string };

type RendererPerformanceSelection = { mode: "auto" | "desktop" | "mobile"; profile: "desktop" | "mobile"; targetFps: 60 };

type RendererRomanizationSelection = { mode: string; available: boolean };

type RendererRomanizationSnapshot = {
    mode: string;
    available: boolean;
    candidate: boolean;
    loadState: string;
    loadError: string;
    source: string;
    transformedLines: number;
    toggleCount: number;
    provider: string;
    networkSources: boolean;
    googleState: string;
    googleError: string;
    googleTransformedLines: number;
    maxLineLength: number;
    songKey: string;
};

type RendererTimingAdjustment = { seconds: number; display: string; songKey: string };

type RendererTimingSync = { active: boolean };

type RendererTimingSnapshot = {
    seconds: number;
    sharedSeconds: number;
    effectiveSeconds: number;
    display: string;
    fineStepSeconds: number;
    stepSeconds: number;
    minSeconds: number;
    maxSeconds: number;
    changeCount: number;
    syncPickActive: boolean;
    correctedClickSeek: boolean;
    autoFollow: {
        suspendedUntil: number;
        lastIndex: number;
        lastAt: number;
        scrollCount: number;
        manualScrollCount: number;
        forceCount: number;
        lastReason: string;
        stockFollowerSuppressed: boolean;
        stockSuppressCount: number;
        stockSuppressReason: string;
    };
    seekCount: number;
    lastSeekKind: string;
    timelineFingerprint: string;
    songKey: string;
};

type RendererBackgroundVocalsSnapshot = {
    detected: number;
    marker: string;
    placement: string;
    lines: {
        lineIndex: number;
        text: string;
        attachment: string | undefined;
        anchorLineIndex: number | null | undefined;
        roleSource: string | null | undefined;
        startSeconds: number;
        endSeconds: number;
    }[];
    cacheHint: string | null;
};

type RendererInstrumentalSnapshot = {
    symbol: string;
    visualRenderer: string;
    transitionModel: string;
    rectangularTextClipArtifact: boolean;
    liquidSurface: string;
    reducedMotionSurface: string;
    seekable: boolean;
    seekTarget: string;
    keyboardActivation: string;
    seekCount: number;
    minimumGapSeconds: number;
    detected: number;
    activeIndex: number;
    active: { startSeconds: number; endSeconds: number; durationSeconds: number; nextLineIndex: number; intro: boolean; progress: number } | null;
    renderCount: number;
    longestSeconds: number;
    gaps: { startSeconds: number; endSeconds: number; durationSeconds: number; nextLineIndex: number; intro: boolean }[];
};

type RendererFingerprintSnapshot = {
    version: string;
    visualSignature: string;
    requestedMode: "auto" | "desktop" | "mobile";
    detectedProfile: "desktop" | "mobile";
    fullQuality: boolean;
    targetFps: 60;
    glowBuckets: number;
    glowRenderer: string;
    segmentSafeMotion: string;
    contextualScriptMotion: string;
    rtlSwipeDirection: string;
    cueTokenization: string;
    atmosphere: string;
    reducedMotionRequested: boolean;
    reducedMotionApplied: boolean;
    geometry: {
        words: number;
        perGlyphWords: number;
        rangeWords: number;
        canvasFallbackWords: number;
        wholeScriptWords: number;
        wholeFallbackWords: number;
    };
    currentWords: {
        text: string;
        motionMode: string;
        paintMode: string;
        geometrySource: string | undefined;
        motionGlyphCount: number;
        glowLayersPerGlyph: number;
    }[];
};

export type RendererPerformanceSnapshot = {
    animationLoopErrors: number;
    animationLoopStarts: number;
    animationLoopStops: number;
    lastAnimationLoopError: string;
    renderedFrameCount: number;
    mode: "auto" | "desktop" | "mobile";
    profile: "desktop" | "mobile";
    targetFps: number;
    measuredFps: number;
    timedCueCount: number;
    perGlyphMotion: string;
    playbackClock: string;
    rafTargetGate: boolean;
    skippedRafFrames: number;
    lyricVisualWatchdogMs: number;
    lyricFrameRecoveryMs: number;
    instrumentalSvg: string;
    lineTransitionCount: number;
    lastLineSyncCount: number;
    maxLineSyncCount: number;
    activeLineOnlyRendering: boolean;
    activeSetOnlyRendering: boolean;
    staticLinesUpdateOnlyOnLineChange: boolean;
    normalLrcTargetFps: number;
    pausedTargetFps: number;
    adaptiveAlbumAtmosphere: boolean;
    renderQuality: "standard" | "low-power";
    atmosphereMode: string;
    atmosphereArtwork: string;
    atmosphereSource: string;
    atmospherePendingKey: string;
    atmospherePendingMs: number;
    atmosphereTimeoutCount: number;
    atmosphereDynamicPort: string;
    atmosphereDynamicSource: string;
    atmosphereDynamicEngine: string;
    atmosphereDynamicTransitionMs: number;
    atmosphereColorExtraction: string;
    atmosphereVisualIdentity: string;
    atmosphereSameAlbumContinuity: boolean;
    atmosphereLyricLifecycleIndependent: boolean;
    atmosphereLatestMediaCommitOnly: boolean;
    atmosphereDomFallbackStabilityDelayMs: number;
    atmosphereUnboundDomConfirmMs: number;
    atmosphereInheritedDomStableMs: number;
    atmosphereInheritedDomConfirmMs: number;
    atmosphereDirectGraceMs: number;
    atmosphereDirectLoadTimeoutMs: number;
    atmosphereFastInheritedCommits: number;
    atmosphereWeakRecheckMs: number;
    atmosphereNoArtConfirmMs: number;
    atmosphereNoArtRetryMs: number;
    atmosphereNoArtwork: boolean;
    atmosphereWebglFailureCount: number;
    atmosphereWebglRetryInMs: number;
    atmosphereAudioCoupled: boolean;
    atmosphereRendering: {
        engine: string;
        running: boolean;
        targetFps: number;
        renderedFrames: number;
        webgl: boolean;
        blurSize: number;
        blurPasses: number;
        warpIntensity: number;
        animationSpeed: number;
        transitionDurationMs: number;
        transitionCurve: string;
        saturation: number;
        dithering: number;
        scale: number;
        warpWidth: number;
        warpHeight: number;
        renderWidth: number;
        renderHeight: number;
        transitioning: boolean;
        transitionSerial: number;
        completedTransitions: number;
        interruptedTransitions: number;
        accumulatedTime: number;
        contextLost: boolean;
    } | null;
    atmosphereLyricReactive: boolean;
    atmosphereLiveCssBlur: boolean;
    atmospherePrebakedBlur: boolean;
    atmosphereStaleCommitDrops: number;
    atmosphereVisualDedupCount: number;
    atmosphereFingerprintFailures: number;
    atmosphereDirectLoadFailures: number;
    atmosphereDomFallbackCommits: number;
    atmosphereCrossfadeMs: number;
    geometryAwareSwipe: boolean;
    connectedScriptPaint: string;
    shapedWordCount: number;
    scriptProfileCounts: Record<string, number>;
    fontGeometryRefreshCount: number;
    wipeBaseEm: number;
    swipeSmoothingMs: number;
    currentMotionPlan: {
        word: string;
        motion: string;
        glow: boolean;
        scriptProfile: string;
        paintMode: string;
        durationMs: number;
        geometryReady: boolean | undefined;
        geometrySource: string | undefined;
        glyphOverlay: boolean;
    }[];
    graphemeSafeCueSplitting: boolean;
    userToasts: boolean;
};

export interface RendererApi {
    readonly dispose: () => void;
    readonly lifecycleResources: () => number;
    readonly lifecycleDiagnostics: () => RendererLifecycleSnapshot;
    readonly artworkPendingLoads: () => number;
    readonly version: string;
    readonly refreshLayout: (preserveScroll?: boolean) => boolean;
    readonly redecorate: () => boolean;
    readonly beginTrack: (itemId: string) => number;
    readonly applyRichPayload: (payload: unknown, itemId?: string) => boolean;
    readonly accents: () => RendererAccent[];
    readonly setAccent: (mode: string) => RendererAccentSelection;
    readonly nextAccent: () => RendererAccentSelection;
    readonly setPerformance: (mode: string) => RendererPerformanceSelection;
    readonly setRenderQuality: (quality: "standard" | "low-power") => "standard" | "low-power";
    readonly renderQuality: () => "standard" | "low-power";
    readonly setRomanization: (mode: string) => RendererRomanizationSelection;
    readonly romanization: () => RendererRomanizationSnapshot;
    readonly setSharedTimingOffset: (seconds: number) => void;
    readonly setTimingOffset: (value: unknown, persist?: boolean, rememberUndo?: boolean) => RendererTimingAdjustment;
    readonly adjustTimingOffset: (delta: number) => RendererTimingAdjustment;
    readonly resetTimingOffset: () => RendererTimingAdjustment;
    readonly startTimingSync: () => RendererTimingSync;
    readonly undoTiming: () => RendererTimingAdjustment | null;
    readonly timing: () => RendererTimingSnapshot;
    readonly backgroundVocals: () => RendererBackgroundVocalsSnapshot;
    readonly instrumentalBreaks: () => RendererInstrumentalSnapshot;
    readonly rendererFingerprint: () => RendererFingerprintSnapshot;
    readonly performance: () => RendererPerformanceSnapshot;
}

/** Optional capabilities preserve late installation and stock-TV bypass. */
export type RendererBridgePort = Pick<RendererApi, "version"> &
    Partial<
        Pick<
            RendererApi,
            | "beginTrack"
            | "refreshLayout"
            | "applyRichPayload"
            | "setSharedTimingOffset"
            | "timing"
            | "setTimingOffset"
            | "renderQuality"
            | "setRenderQuality"
        >
    >;
export type RendererPort = Pick<RendererApi, "version"> & Partial<RendererApi> & { enabled?: boolean };
