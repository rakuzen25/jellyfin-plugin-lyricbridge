import type {} from "../../platform/globals.ts";
import type {} from "../../platform/globals.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";

interface Dependencies {
    media: () => HTMLAudioElement | null;
    lifetime: Lifecycle;
}

/** Owns transport controls behavior and its installation lifetime. */
export function createTransportControls(deps: Dependencies) {
    let transportButton: HTMLElement | null = null;

    let transportMountObserver: MutationObserver | null = null;

    let releaseTransportObserver: (() => void) | null = null;

    function updateTransportLyrics() {
        if (!transportButton?.isConnected) transportButton = document.querySelector<HTMLElement>(".nowPlayingBar .openLyricsButton");
        if (!transportButton) return;
        const audio = deps.media();
        const video = document.querySelector("video");
        const music = !!(audio?.currentSrc || audio?.getAttribute("src")) && !(video?.currentSrc && !video.paused && !video.ended);
        transportButton.classList.toggle("lb-transport-lyrics", music);
        transportButton.setAttribute("aria-label", transportButton.title || "Lyrics");
        if (transportMountObserver) {
            releaseTransportObserver?.();
            releaseTransportObserver = null;
            transportMountObserver = null;
        }
    }

    function mountTransportLyrics() {
        updateTransportLyrics();
        if (transportButton?.isConnected || transportMountObserver || !document.body) return;
        const observer = new MutationObserver(updateTransportLyrics);
        transportMountObserver = observer;
        releaseTransportObserver = deps.lifetime.own(() => observer.disconnect());
        transportMountObserver.observe(document.body, { childList: true, subtree: true });
    }
    return {
        updateTransportLyrics,
        mountTransportLyrics,
        get transportButton(): HTMLElement | null {
            return transportButton;
        },
        replaceTransportButton(value: HTMLElement | null) {
            transportButton = value;
        },
        get transportMountObserver(): MutationObserver | null {
            return transportMountObserver;
        },
        replaceTransportMountObserver(value: MutationObserver | null) {
            transportMountObserver = value;
        },
        get releaseTransportObserver(): (() => void) | null {
            return releaseTransportObserver;
        },
        replaceReleaseTransportObserver(value: (() => void) | null) {
            releaseTransportObserver = value;
        },
    };
}
