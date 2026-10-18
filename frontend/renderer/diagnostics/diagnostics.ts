import type { HostInstallationStatePort } from "../host/ports.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { FrameSchedulerStatePort } from "../playback/frame-ports.ts";
import type { PerformancePolicyStatePort } from "../preferences/performance-ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import {
    DYNAMIC_BACKGROUND_DIRECT_GRACE_MS,
    DYNAMIC_BACKGROUND_DIRECT_LOAD_TIMEOUT_MS,
    DYNAMIC_BACKGROUND_DOM_STABLE_MS,
    DYNAMIC_BACKGROUND_ENGINE,
    DYNAMIC_BACKGROUND_INHERITED_DOM_CONFIRM_MS,
    DYNAMIC_BACKGROUND_INHERITED_DOM_STABLE_MS,
    DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS,
    DYNAMIC_BACKGROUND_NO_ART_RETRY_MS,
    DYNAMIC_BACKGROUND_SOURCE,
    DYNAMIC_BACKGROUND_TRANSITION_MS,
    DYNAMIC_BACKGROUND_UNBOUND_DOM_CONFIRM_MS,
    DYNAMIC_BACKGROUND_WEAK_RECHECK_MS,
    LRC_TARGET_FPS,
    LYRIC_FRAME_RECOVERY_MS,
    LYRIC_VISUAL_WATCHDOG_MS,
    PAUSED_TARGET_FPS,
    PERFORMANCE_TARGET_FPS,
    UNIFIED_RENDERER_SIGNATURE,
} from "../common/settings.ts";
import { BASE_WIPE_GRADIENT_EM } from "../lyrics/geometry.ts";
import { WORD_PROGRESS_SMOOTH_TAU_MS } from "../lyrics/karaoke-animation.ts";
import type { RenderWord } from "../lyrics/models.ts";

import type { ArtworkDiagnosticSnapshot } from "../appearance/ports.ts";
interface Dependencies {
    artworkDiagnostics: () => ArtworkDiagnosticSnapshot;
    lyricsPort: LyricSessionStatePort;
    performancePort: PerformancePolicyStatePort;
    framesPort: FrameSchedulerStatePort;
    hostPort: HostInstallationStatePort;
    version: string;
    renderQuality: () => "standard" | "low-power";
    prefersReducedMotion: () => boolean;
    glowBucketSteps: () => number;
}

/** Read-only snapshots for console inspection and lifecycle/performance regressions. */
export function createRendererDiagnostics({
    lyricsPort,
    performancePort,
    framesPort,
    hostPort,
    artworkDiagnostics,
    version: VERSION,
    renderQuality,
    prefersReducedMotion,
    glowBucketSteps,
}: Dependencies) {
    function rendererFingerprint() {
        const words: RenderWord[] = [];

        lyricsPort.snapshot.lineData.forEach((line) => {
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

        lyricsPort.snapshot.lineData.forEach((line) => {
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
            requestedMode: performancePort.snapshot.performanceMode,
            detectedProfile: performancePort.snapshot.performanceProfile,
            fullQuality: performancePort.snapshot.performanceProfile === "desktop" || performancePort.snapshot.performanceProfile === "mobile",
            targetFps: PERFORMANCE_TARGET_FPS[performancePort.snapshot.performanceProfile],
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

    function performanceDiagnostics() {
        const artwork = artworkDiagnostics();
        const current = lyricsPort.snapshot.lineData[lyricsPort.snapshot.lastActiveLine] || null;
        return {
            animationLoopErrors: framesPort.snapshot.animationLoopErrors,
            animationLoopStarts: framesPort.snapshot.animationLoopStarts,
            animationLoopStops: framesPort.snapshot.animationLoopStops,
            lastAnimationLoopError: framesPort.snapshot.lastAnimationLoopError,
            renderedFrameCount: framesPort.snapshot.renderedFrameCount,
            mode: performancePort.snapshot.performanceMode,
            profile: performancePort.snapshot.performanceProfile,
            targetFps:
                lyricsPort.snapshot.timedCueCount > 0
                    ? renderQuality() === "low-power"
                        ? 30
                        : PERFORMANCE_TARGET_FPS[performancePort.snapshot.performanceProfile]
                    : LRC_TARGET_FPS,
            measuredFps: Number(framesPort.snapshot.measuredFps.toFixed(1)),
            timedCueCount: lyricsPort.snapshot.timedCueCount,
            perGlyphMotion: "multiscript-grapheme+whole-shaped",
            playbackClock: "phase-locked-monotonic",
            rafTargetGate: true,
            skippedRafFrames: framesPort.snapshot.skippedRafFrames,
            lyricVisualWatchdogMs: LYRIC_VISUAL_WATCHDOG_MS,
            lyricFrameRecoveryMs: LYRIC_FRAME_RECOVERY_MS,
            instrumentalSvg: "single-path-liquid-clip-v2",
            lineTransitionCount: framesPort.snapshot.lineTransitionCount,
            lastLineSyncCount: framesPort.snapshot.lastLineSyncCount,
            maxLineSyncCount: framesPort.snapshot.maxLineSyncCount,
            activeLineOnlyRendering: false,
            activeSetOnlyRendering: true,
            staticLinesUpdateOnlyOnLineChange: true,
            normalLrcTargetFps: LRC_TARGET_FPS,
            pausedTargetFps: PAUSED_TARGET_FPS,
            adaptiveAlbumAtmosphere: true,
            renderQuality: renderQuality(),
            atmosphereMode: "dynamic-only",
            atmosphereArtwork: artwork.atmosphereArtwork,
            atmosphereSource: artwork.atmosphereSource,
            atmospherePendingKey: artwork.atmospherePendingKey,
            atmospherePendingMs:
                artwork.atmospherePendingSince > 0 ? Number(Math.max(0, performance.now() - artwork.atmospherePendingSince).toFixed(1)) : 0,
            atmosphereTimeoutCount: artwork.atmosphereTimeoutCount,
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
            atmosphereFastInheritedCommits: artwork.atmosphereDynamicFastInheritedCommits,
            atmosphereWeakRecheckMs: DYNAMIC_BACKGROUND_WEAK_RECHECK_MS,
            atmosphereNoArtConfirmMs: DYNAMIC_BACKGROUND_NO_ART_CONFIRM_MS,
            atmosphereNoArtRetryMs: DYNAMIC_BACKGROUND_NO_ART_RETRY_MS,
            atmosphereNoArtwork: artwork.atmosphereDynamicNoArtwork,
            atmosphereWebglFailureCount: artwork.atmosphereDynamicWebglFailureCount,
            atmosphereWebglRetryInMs: Math.max(0, artwork.atmosphereDynamicWebglRetryAt - performance.now()),
            atmosphereAudioCoupled: false,
            atmosphereRendering: artwork.atmosphereDynamicRenderer?.diagnostics() ?? null,
            atmosphereLyricReactive: false,
            atmosphereLiveCssBlur: false,
            atmospherePrebakedBlur: true,
            atmosphereStaleCommitDrops: artwork.atmosphereDynamicStaleCommitDrops,
            atmosphereVisualDedupCount: artwork.atmosphereDynamicVisualDedupCount,
            atmosphereFingerprintFailures: artwork.atmosphereDynamicFingerprintFailures,
            atmosphereDirectLoadFailures: artwork.atmosphereDynamicDirectLoadFailures,
            atmosphereDomFallbackCommits: artwork.atmosphereDynamicDomFallbackCommits,
            atmosphereCrossfadeMs: DYNAMIC_BACKGROUND_TRANSITION_MS,
            geometryAwareSwipe: true,
            connectedScriptPaint: "shaped-spatial-wipe",
            shapedWordCount: lyricsPort.snapshot.shapedWordCount,
            scriptProfileCounts: Object.assign({}, lyricsPort.snapshot.scriptProfileCounts),
            fontGeometryRefreshCount: hostPort.snapshot.fontGeometryRefreshCount,
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
    }
    return { rendererFingerprint, performance: performanceDiagnostics };
}
