/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { readView } from "../../shared/read-view.ts";
import type { ArtworkLifecyclePort } from "../appearance/ports.ts";
import { LYRIC_VISUAL_WATCHDOG_MS } from "../common/settings.ts";
import type { AutoFollowPort } from "../follow/ports.ts";
import type { RenderLine } from "../lyrics/models.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { FrameSchedulerStatePort } from "../playback/frame-ports.ts";
import { isLyricsPage, ROUTE_RE } from "./host.ts";
import type { HostInstallationState } from "./ports.ts";

interface Dependencies {
    lyricVisualDomHealthy: () => boolean;
    lineRecordHealthy: (lineRecord: RenderLine) => boolean;
    instrumentalGapRowsHealthy: () => boolean;
    maybeRefreshAtmosphere: (media: HTMLMediaElement | null, frameNow: number) => void;
    queueDecoration: () => boolean;
    decorationInProgress: () => boolean;
    refreshAtmosphere: (media: HTMLMediaElement | null, force?: boolean) => Promise<void>;
    resetMotionHandoffs: () => void;
    updateLyricSyncButton: () => void;
    ensureRomanizationToggle: () => HTMLButtonElement | null;
    ensureTimingControls: () => HTMLButtonElement | null;
    removeRomanizationToggle: () => void;
    removeTimingControls: () => void;
    removeTools: () => void;
    cancelDecorationRetry: (resetWindow?: boolean) => void;
    invalidateAtmosphereLoads: (source?: string) => string;
    removeAtmosphereRoot: (source?: string) => void;
    resizeDynamicBackgroundRenderer: () => boolean;
    stopDynamicBackgroundRenderer: (source?: string) => string;
    startDynamicBackgroundRenderer: () => boolean;
    lyricsPort: LyricSessionStatePort;
    framesPort: FrameSchedulerStatePort;
    lifecycle: Lifecycle;
    getLocalMediaElement: (forceProbe?: boolean) => HTMLMediaElement | null;
    shouldRunAnimationLoop: () => boolean;
    wakeAnimationLoop: () => void;
    stopAnimationLoop: (reason?: string) => string;
    artwork: ArtworkLifecyclePort;
    warn: (...args: unknown[]) => void;
    queueMotionGeometryRefresh: (preserveScroll?: boolean) => boolean;
    autoFollow: AutoFollowPort;
    resetPlaybackClock: (media?: HTMLMediaElement | null, frameNow?: number) => void;
}

/** Owns host installation behavior and its installation lifetime. */
export function createHostInstallation(deps: Dependencies) {
    const state: HostInstallationState = {
        animationWatchdogTimer: 0,
        lyricViewHidden: false,
        watchdogLineCursor: 0,
        fontGeometryRefreshCount: 0,
    };
    const snapshot = readView(state);

    let reducedMotionMediaQuery: MediaQueryList | null = null;

    function lyricWatchdogDomHealthy() {
        if (deps.lyricsPort.snapshot.lyricTimingMode === "plain") return deps.lyricVisualDomHealthy();
        if (deps.lyricsPort.snapshot.decoratedGeneration !== deps.lyricsPort.snapshot.generation || !deps.lyricsPort.snapshot.lineData.length)
            return false;
        for (let i = 0; i < Math.min(12, deps.lyricsPort.snapshot.lineData.length); i++) {
            const line = deps.lyricsPort.snapshot.lineData[state.watchdogLineCursor++ % deps.lyricsPort.snapshot.lineData.length];
            if (!deps.lineRecordHealthy(requireValue(line))) return false;
        }
        return deps.instrumentalGapRowsHealthy();
    }

    function installLyricVisualWatchdog() {
        if (state.animationWatchdogTimer) return;

        state.animationWatchdogTimer = deps.lifecycle.interval(() => {
            if (document.hidden || state.lyricViewHidden || !isLyricsPage()) return;

            // Artwork belongs to the view, including instrumental/missing or
            // still-loading lyrics. Retry late media/art independently of rows.
            const media = deps.getLocalMediaElement(true);
            if (media) deps.maybeRefreshAtmosphere(media, performance.now());
            if (!deps.lyricsPort.snapshot.lyrics) return;

            if (!lyricWatchdogDomHealthy()) {
                deps.lyricsPort.setDecoratedGeneration(-1);
                deps.queueDecoration();
                return;
            }

            if (
                deps.shouldRunAnimationLoop() &&
                !deps.framesPort.snapshot.animationLoopRunning &&
                !deps.framesPort.snapshot.rafId &&
                !deps.framesPort.snapshot.frameTimer
            ) {
                deps.lyricsPort.setAnimationWatchdogRecoveries(deps.lyricsPort.snapshot.animationWatchdogRecoveries + 1);
                deps.wakeAnimationLoop();
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

        const observer = deps.lifecycle.observer((mutations) => {
            if (document.hidden || !isLyricsPage() || !deps.lyricsPort.snapshot.lyrics) return;

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

            if (shouldCheck && !deps.decorationInProgress() && !deps.lyricVisualDomHealthy()) {
                deps.lyricsPort.setDecoratedGeneration(-1);
                deps.stopAnimationLoop("lyric-dom-mutated");
                deps.queueDecoration();
            }

            if (artworkChanged) {
                deps.artwork.requestRefresh();
                const media = deps.getLocalMediaElement(true);
                if (media) {
                    deps.refreshAtmosphere(media, true).catch((error: unknown) =>
                        deps.warn("Dynamic Background artwork mutation refresh failed:", error),
                    );
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
        else deps.lifecycle.on(document, "DOMContentLoaded", startObserver, { once: true });
    }

    function installFontGeometryHooks() {
        const refreshForFonts = () => {
            if (deps.lifecycle.isDisposed) return;
            state.fontGeometryRefreshCount += 1;
            deps.queueMotionGeometryRefresh();
            deps.wakeAnimationLoop();
        };
        document.fonts.ready.then(refreshForFonts).catch(() => {});
        deps.lifecycle.on(document.fonts, "loadingdone", refreshForFonts);
    }

    function installReducedMotionHook() {
        try {
            reducedMotionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

            const refreshForPreferenceChange = () => {
                deps.lyricsPort.setLastActiveLine(-999);
                deps.lyricsPort.setLastActiveLineSignature("");
                deps.lyricsPort.setActiveLineIndexes([]);
                deps.resetMotionHandoffs();
                deps.framesPort.setForceNextFrame(true);

                if (deps.lyricsPort.snapshot.lyrics && isLyricsPage()) {
                    /* Existing grow layers must be rebuilt as plain wipe-only
                     * words (and vice versa) when the OS setting changes. */
                    deps.lyricsPort.setDecoratedGeneration(-1);
                    deps.queueDecoration();
                    deps.queueMotionGeometryRefresh();
                }

                deps.wakeAnimationLoop();
            };

            deps.lifecycle.on(reducedMotionMediaQuery, "change", refreshForPreferenceChange);
        } catch {
            // Keep playback usable if the host refuses preference observation.
        }
    }

    function installRouteHooks() {
        deps.lifecycle.on(window, "hashchange", () => {
            deps.updateLyricSyncButton();
            if (ROUTE_RE.test(location.hash)) {
                deps.queueDecoration();
                deps.ensureRomanizationToggle();
                deps.ensureTimingControls();
                deps.artwork.resetMediaIdentity();
                deps.lyricsPort.setLastActiveLine(-999);
                deps.lyricsPort.setLastActiveLineSignature("");
                deps.lyricsPort.setActiveLineIndexes([]);
                deps.autoFollow.reset("media-change");
                deps.wakeAnimationLoop();
            } else {
                deps.removeRomanizationToggle();
                deps.removeTimingControls();
                deps.removeTools();
                deps.cancelDecorationRetry(true);

                if (deps.lyricsPort.snapshot.geometryTimer) {
                    deps.lifecycle.clearTimeout(deps.lyricsPort.snapshot.geometryTimer);
                    deps.lyricsPort.setGeometryTimer(0);
                }

                deps.invalidateAtmosphereLoads("route-leave");
                deps.stopAnimationLoop("route-leave");
                deps.artwork.cancelProbes();
                deps.removeAtmosphereRoot("route-leave");
            }
        });

        deps.lifecycle.on(
            window,
            "resize",
            () => {
                deps.queueMotionGeometryRefresh();
                deps.resizeDynamicBackgroundRenderer();
                deps.wakeAnimationLoop();
            },
            { passive: true },
        );

        deps.lifecycle.on(
            window,
            "orientationchange",
            () => {
                deps.queueMotionGeometryRefresh();
                deps.resizeDynamicBackgroundRenderer();
                deps.wakeAnimationLoop();
            },
            { passive: true },
        );

        if (window.visualViewport) {
            deps.lifecycle.on(
                window.visualViewport,
                "resize",
                () => {
                    deps.queueMotionGeometryRefresh();
                    deps.resizeDynamicBackgroundRenderer();
                    deps.wakeAnimationLoop();
                },
                { passive: true },
            );
        }

        deps.lifecycle.on(
            document,
            "visibilitychange",
            () => {
                if (document.hidden) {
                    deps.stopAnimationLoop("document-hidden");
                    deps.stopDynamicBackgroundRenderer("document-hidden");
                    return;
                }

                if (deps.lyricsPort.snapshot.lyrics && isLyricsPage() && !deps.lyricVisualDomHealthy()) {
                    deps.queueDecoration();
                }

                deps.resetPlaybackClock(deps.getLocalMediaElement(true), performance.now());
                deps.wakeAnimationLoop();
                deps.startDynamicBackgroundRenderer();
            },
            { passive: true },
        );

        deps.lifecycle.on(
            window,
            "pagehide",
            () => {
                deps.cancelDecorationRetry(true);
                deps.invalidateAtmosphereLoads("pagehide");
                deps.artwork.cancelProbes();
                deps.stopAnimationLoop("pagehide");
                deps.stopDynamicBackgroundRenderer("pagehide");
            },
            { passive: true },
        );

        deps.lifecycle.on(
            window,
            "pageshow",
            () => {
                if (deps.lyricsPort.snapshot.lyrics && isLyricsPage()) {
                    deps.queueDecoration();
                    deps.wakeAnimationLoop();
                    deps.startDynamicBackgroundRenderer();
                }
            },
            { passive: true },
        );
    }
    return {
        snapshot,
        setLyricViewHidden(value: boolean): void {
            state.lyricViewHidden = value;
        },
        motion: {
            get query(): MediaQueryList | null {
                return reducedMotionMediaQuery;
            },
            set query(value: MediaQueryList | null) {
                reducedMotionMediaQuery = value;
            },
        },
        lyricWatchdogDomHealthy,
        installLyricVisualWatchdog,
        installDomObserver,
        installFontGeometryHooks,
        installReducedMotionHook,
        installRouteHooks,
    };
}
