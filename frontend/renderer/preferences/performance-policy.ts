/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { readView } from "../../shared/read-view.ts";
import type { ArtworkLifecyclePort } from "../appearance/ports.ts";
import { LRC_TARGET_FPS, PAUSED_TARGET_FPS, PERFORMANCE_STORAGE_KEY, PERFORMANCE_TARGET_FPS } from "../common/settings.ts";
import { getCurrentLyricPage, isLyricsPage } from "../host/host.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { FrameSchedulerStatePort } from "../playback/frame-ports.ts";
import type { PerformancePolicyState } from "./performance-ports.ts";

interface Dependencies {
    framesPort: FrameSchedulerStatePort;
    lyricsPort: LyricSessionStatePort;
    isMobileEnvironment: () => boolean;
    invalidateAtmosphereLoads: (source?: string) => string;
    artwork: ArtworkLifecyclePort;
    rebuildDynamicBackgroundRenderer: (source?: string) => void;
    applyAccentTheme: () => void;
    queueMotionGeometryRefresh: (preserveScroll?: boolean) => boolean;
    wakeAnimationLoop: () => void;
    prefersReducedMotion: () => boolean;
    renderQuality: "standard" | "low-power";
}

/** Owns performance policy behavior and its installation lifetime. */
export function createPerformancePolicy(deps: Dependencies) {
    const state: PerformancePolicyState = {
        performanceMode: "auto",
        performanceProfile: "desktop",
    };
    const snapshot = readView(state);

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
        return deps.isMobileEnvironment() ? "mobile" : "desktop";
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
            deps.framesPort.setLastRenderedFrameAt(0);
            deps.invalidateAtmosphereLoads("performance-profile-change");
            deps.artwork.requestRefresh();
            deps.rebuildDynamicBackgroundRenderer("performance-profile-change");
        }

        const page = isLyricsPage() ? getCurrentLyricPage() : null;
        applyPerformanceClassToPage(page);
        deps.applyAccentTheme();

        if (refreshGeometry && previous !== state.performanceProfile && deps.lyricsPort.snapshot.lineData.length) {
            deps.queueMotionGeometryRefresh();
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
        deps.wakeAnimationLoop();
        return {
            mode: state.performanceMode,
            profile: state.performanceProfile,
            targetFps: PERFORMANCE_TARGET_FPS[state.performanceProfile],
        };
    }

    function shouldUsePerGlyphMotion(glyphCount: number) {
        return !deps.prefersReducedMotion() && Number(glyphCount) > 0;
    }

    function getTargetFrameInterval(media: HTMLMediaElement | null) {
        if (document.hidden) {
            return 500;
        }

        if (media && media.paused) {
            return 1000 / PAUSED_TARGET_FPS;
        }

        if (deps.lyricsPort.snapshot.timedCueCount === 0 && deps.lyricsPort.snapshot.activeInstrumentalGapIndex < 0) {
            return 1000 / LRC_TARGET_FPS;
        }

        const fps = deps.renderQuality === "low-power" ? 30 : PERFORMANCE_TARGET_FPS[state.performanceProfile] || 30;

        return 1000 / fps;
    }
    return {
        snapshot,
        restorePerformanceMode(value: "auto" | "desktop" | "mobile"): void {
            state.performanceMode = value;
        },
        setPerformanceProfile(value: "desktop" | "mobile"): void {
            state.performanceProfile = value;
        },
        readPerformanceMode,
        detectPerformanceProfile,
        applyPerformanceClassToPage,
        applyPerformanceProfile,
        setPerformanceMode,
        shouldUsePerGlyphMotion,
        getTargetFrameInterval,
    };
}
