import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { icon as createIcon } from "../../shared/icons.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { elementHasLiveLayout, getCurrentLyricPage, getCurrentLyricsContainer, isLyricsPage } from "../host/host.ts";
import { scrollGeometry } from "./scrolling.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
function eventElement(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target : null;
}
interface OwnedState {
    lyricStockAutoFollowSuppressCount: number;
    lyricStockAutoFollowLastReason: string;
    lyricAutoFollowSuspendedUntil: number;
    lyricAutoFollowLastReason: string;
    lyricAutoFollowManualScrollCount: number;
    lyricAutoFollowLastIndex: number;
    lyricAutoFollowScroller: Element | null;
    lyricAutoFollowTargetTop: number | null;
    lyricAutoFollowBehavior: ScrollBehavior | null;
    lyricAutoFollowLastAt: number;
    lyricAutoFollowScrollCount: number;
    lyricAutoFollowForceCount: number;
    lyricAutoFollowInstalled: boolean;
}
interface Dependencies {
    lyricsPort: LyricSessionStatePort;
    lifecycle: Lifecycle;
    motion: { query: MediaQueryList | null };
    isTimingPickActive: () => boolean;
}
export function createAutoFollow({ lyricsPort, lifecycle, motion, isTimingPickActive }: Dependencies) {
    const owned: OwnedState = {
        lyricStockAutoFollowSuppressCount: 0,
        lyricStockAutoFollowLastReason: "",
        lyricAutoFollowSuspendedUntil: 0,
        lyricAutoFollowLastReason: "",
        lyricAutoFollowManualScrollCount: 0,
        lyricAutoFollowLastIndex: -1,
        lyricAutoFollowScroller: null,
        lyricAutoFollowTargetTop: null,
        lyricAutoFollowBehavior: null,
        lyricAutoFollowLastAt: 0,
        lyricAutoFollowScrollCount: 0,
        lyricAutoFollowForceCount: 0,
        lyricAutoFollowInstalled: false,
    };
    function lyricLineIndexForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return -1;

        const lineElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-enhanced-line");
        if (!lineElement) return -1;

        const lineIndex = Number(lineElement.dataset.akTimingLineIndex);

        return Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lyricsPort.snapshot.lineData.length ? lineIndex : -1;
    }

    function lyricAutoFollowReducedMotion() {
        try {
            if (!motion.query && window.matchMedia) {
                motion.query = window.matchMedia("(prefers-reduced-motion: reduce)");
            }
            return !!(motion.query && motion.query.matches);
        } catch {
            return false;
        }
    }

    function suppressJellyfinLyricAutoFollow(reason: string = "lyric-motion-follow") {
        if (typeof document === "undefined" || !isLyricsPage()) {
            return false;
        }

        /* Jellyfin's lyrics controller disables its private autoScroll state
         * on wheel/touchmove. There is no public controller API for this. A
         * zero-delta synthetic wheel uses that controller path while our own
         * capture listener explicitly ignores the internal event. */
        try {
            const event = new Event("wheel", {
                bubbles: true,
                cancelable: false,
            });
            Object.defineProperty(event, "akLyricMotionInternal", {
                value: true,
            });
            document.dispatchEvent(event);
        } catch {
            return false;
        }

        owned.lyricStockAutoFollowSuppressCount += 1;
        owned.lyricStockAutoFollowLastReason = reason;
        return true;
    }

    let lyricSyncButton: HTMLButtonElement | null = null;
    function updateLyricSyncButton() {
        const show =
            isLyricsPage() &&
            lyricsPort.snapshot.lyrics &&
            lyricsPort.snapshot.lyrics.length &&
            lyricsPort.snapshot.lyricTimingMode !== "plain" &&
            owned.lyricAutoFollowSuspendedUntil === Infinity;
        if (!lyricSyncButton && show) {
            lyricSyncButton = document.createElement("button");
            lyricSyncButton.className = "lb-button lb-sync";
            lyricSyncButton.type = "button";
            const label = document.createElement("span");
            label.className = "lb-action-label";
            label.textContent = "Sync";
            lyricSyncButton.append(createIcon("follow"), label);
            lyricSyncButton.setAttribute("aria-label", "Resume following the playing lyric");
            lyricSyncButton.onclick = () => {
                resumeLyricAutoFollow("sync-button");
                const index = lyricsPort.snapshot.activeLineIndexes[0] ?? lyricsPort.snapshot.lastActiveLine;
                focusLyricLineIndex(index, {
                    force: true,
                    reason: "sync-button",
                });
            };
            document.body.append(lyricSyncButton);
        }
        if (lyricSyncButton) lyricSyncButton.hidden = !show;
    }
    function resumeLyricAutoFollow(reason: string = "resume") {
        owned.lyricAutoFollowSuspendedUntil = 0;
        owned.lyricAutoFollowLastReason = reason;
        updateLyricSyncButton();
    }

    function suspendLyricAutoFollow(reason: string = "manual-scroll", _frameNow: number = performance.now()) {
        owned.lyricAutoFollowSuspendedUntil = Infinity;
        updateLyricSyncButton();
        owned.lyricAutoFollowManualScrollCount += 1;
        owned.lyricAutoFollowLastReason = reason;
    }

    function lyricPlaybackFollowIndex(lineIndex: number) {
        const line = lyricsPort.snapshot.lineData[lineIndex];
        const anchor = line && line.backgroundVocalAnchorLineIndex;
        return line &&
            line.isBackgroundVocal &&
            isFiniteNumber(anchor) &&
            Number.isInteger(anchor) &&
            lyricsPort.snapshot.activeLineIndexes.includes(anchor)
            ? anchor
            : lineIndex;
    }

    function focusLyricLineIndex(
        lineIndex: number,
        { force = false, behavior = "smooth", reason = "playback" }: { force?: boolean; behavior?: ScrollBehavior; reason?: string } = {},
    ) {
        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lyricsPort.snapshot.lineData.length) {
            return false;
        }

        const lineRecord = lyricsPort.snapshot.lineData[lineIndex];
        const element = lineRecord && lineRecord.element;
        if (!element || element.isConnected === false || typeof element.scrollIntoView !== "function") {
            return false;
        }

        const now = performance.now();

        if (!force && (isTimingPickActive() || now < owned.lyricAutoFollowSuspendedUntil)) {
            return false;
        }

        if (!force && owned.lyricAutoFollowLastIndex === lineIndex) {
            return false;
        }

        const resolvedBehavior = lyricAutoFollowReducedMotion() ? "auto" : behavior;

        try {
            refreshLyricScrollSpace();
            const bounds = lyricScrollGeometry(element);
            const rect = element.getBoundingClientRect();
            const delta = (rect.top + rect.bottom) / 2 - bounds.center;
            const target = bounds.scroller.scrollTop + delta;
            // Do not cancel an in-flight smooth scroll with the same destination.
            if (
                reason === "layout-refresh" &&
                owned.lyricAutoFollowLastIndex === lineIndex &&
                owned.lyricAutoFollowScroller === bounds.scroller &&
                Math.abs(target - requireValue(owned.lyricAutoFollowTargetTop)) <= 8 &&
                (Math.abs(delta) <= 8 || (owned.lyricAutoFollowBehavior === "smooth" && now - owned.lyricAutoFollowLastAt < 800))
            )
                return false;
            bounds.scroller.scrollBy({
                top: delta,
                behavior: resolvedBehavior,
            });
            owned.lyricAutoFollowScroller = bounds.scroller;
            owned.lyricAutoFollowTargetTop = target;
            owned.lyricAutoFollowBehavior = resolvedBehavior;
        } catch {
            return false;
        }

        owned.lyricAutoFollowLastIndex = lineIndex;
        owned.lyricAutoFollowLastAt = now;
        owned.lyricAutoFollowScrollCount += 1;
        owned.lyricAutoFollowLastReason = reason;
        if (force) owned.lyricAutoFollowForceCount += 1;
        return true;
    }

    const lyricScrollGeometry = (element: HTMLElement) =>
        scrollGeometry(element, (element) => element instanceof HTMLElement && elementHasLiveLayout(element));
    let scrollSpaceCache:
        | {
              container: HTMLElement;
              records: typeof lyricsPort.snapshot.lineData;
              width: number;
              height: number;
              firstHeight: number;
              lastHeight: number;
              picking: boolean;
          }
        | undefined;
    function refreshLyricScrollSpace(force = false) {
        const container = getCurrentLyricsContainer(true);
        if (!container || !lyricsPort.snapshot.lineData.length) return;
        const first = lyricsPort.snapshot.lineData.find((line) => !line.isBackgroundVocal)?.element;
        const last = [...lyricsPort.snapshot.lineData].reverse().find((line) => !line.isBackgroundVocal)?.element;
        if (!first || !last) return;
        const firstHeight = first.getBoundingClientRect().height;
        const lastHeight = last.getBoundingClientRect().height;
        if (
            !force &&
            scrollSpaceCache?.container === container &&
            scrollSpaceCache.records === lyricsPort.snapshot.lineData &&
            scrollSpaceCache.width === innerWidth &&
            scrollSpaceCache.height === innerHeight &&
            scrollSpaceCache.firstHeight === firstHeight &&
            scrollSpaceCache.lastHeight === lastHeight &&
            scrollSpaceCache.picking === isTimingPickActive()
        )
            return;
        scrollSpaceCache = {
            container,
            records: lyricsPort.snapshot.lineData,
            width: innerWidth,
            height: innerHeight,
            firstHeight,
            lastHeight,
            picking: isTimingPickActive(),
        };
        const bounds = lyricScrollGeometry(first);
        const head = Math.max(0, bounds.center - bounds.scrollTop - firstHeight / 2);
        const tail = Math.max(24, bounds.scrollBottom - bounds.center - lastHeight / 2 + 24);
        for (const [name, value] of [
            ["--ak-scroll-head", head],
            ["--ak-scroll-tail", tail],
        ] satisfies [string, number][]) {
            const text = Math.ceil(value) + "px";
            if (container.style.getPropertyValue(name) !== text) container.style.setProperty(name, text);
        }
    }

    function handleLyricManualScroll(event: Event) {
        if (!isLyricsPage()) return;
        if (event && "akLyricMotionInternal" in event && event.akLyricMotionInternal) return;

        const page = getCurrentLyricPage();
        const target = eventElement(event);
        if (page && target && typeof page.contains === "function" && !(target instanceof Node && page.contains(target))) {
            return;
        }

        suspendLyricAutoFollow(event && event.type ? `manual-${event.type}` : "manual-scroll");
    }

    function installLyricAutoFollowHooks() {
        if (owned.lyricAutoFollowInstalled || typeof document === "undefined") {
            return;
        }

        lifecycle.on(
            document,
            "keydown",
            (event) => {
                if (
                    ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key) &&
                    !eventElement(event)?.closest<HTMLElement>("input,select,textarea,.lb-popup")
                )
                    handleLyricManualScroll(event);
            },
            { passive: true },
        );
        lifecycle.on(
            document,
            "pointerdown",
            (event) => {
                const container = getCurrentLyricsContainer(false);
                if (
                    container &&
                    event.target === container &&
                    (event instanceof MouseEvent ? event.clientX : 0) >= container.getBoundingClientRect().right - 20
                )
                    handleLyricManualScroll(event);
            },
            { passive: true },
        );
        lifecycle.on(document, "wheel", handleLyricManualScroll, {
            capture: true,
            passive: true,
        });
        lifecycle.on(document, "touchmove", handleLyricManualScroll, {
            capture: true,
            passive: true,
        });
        owned.lyricAutoFollowInstalled = true;
    }

    function reset(reason: string, clearGeometry = false) {
        owned.lyricAutoFollowSuspendedUntil = 0;
        owned.lyricAutoFollowLastIndex = -1;
        owned.lyricAutoFollowLastReason = reason;
        if (clearGeometry) {
            owned.lyricAutoFollowLastAt = 0;
            owned.lyricAutoFollowScroller = null;
            owned.lyricAutoFollowTargetTop = null;
            owned.lyricAutoFollowBehavior = null;
            scrollSpaceCache = undefined;
        }
    }
    lifecycle.own(() => {
        lyricSyncButton?.remove();
        lyricSyncButton = null;
    });
    return {
        lyricLineIndexForTarget,
        suppressJellyfinLyricAutoFollow,
        updateLyricSyncButton,
        resumeLyricAutoFollow,
        lyricPlaybackFollowIndex,
        focusLyricLineIndex,
        refreshLyricScrollSpace,
        installLyricAutoFollowHooks,
        reset,
        invalidateTarget() {
            owned.lyricAutoFollowLastIndex = -1;
        },
        get suspendedUntil() {
            return owned.lyricAutoFollowSuspendedUntil;
        },
        diagnostics: () => ({ ...owned }),
    };
}
