/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../shared/invariants.ts";
import type {} from "../shared/runtime.ts";
import type { AnimatedWord } from "./karaoke-animation.ts";
import { elementHasLiveLayout, getCurrentLyricPage, getCurrentLyricsContainer, isLyricsPage } from "./host.ts";
import { RendererLifecycle } from "./lifecycle.ts";
import type { LyricInput } from "./payload.ts";
import { scrollGeometry } from "./scrolling.ts";
import type { RendererState } from "./state.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
function eventElement(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target : null;
}

interface Dependencies {
    state: Pick<
        RendererState,
        | "lyricToolsHost"
        | "lyricToolsBar"
        | "timingPopover"
        | "lyrics"
        | "timingOffsetSeconds"
        | "timingUndo"
        | "sharedTimingOffsetSeconds"
        | "timingControls"
        | "timingPickActive"
        | "lastActiveLine"
        | "lastActiveLineSignature"
        | "activeLineIndexes"
        | "forceNextFrame"
        | "lineData"
        | "songPreferenceKey"
        | "timingOffsetChangeCount"
        | "lyricSeekCount"
        | "instrumentalSeekCount"
        | "lastLyricSeekKind"
        | "lastLyricSeekSourceTicks"
        | "lastLyricSeekMediaSeconds"
        | "lyricStockAutoFollowSuppressCount"
        | "lyricStockAutoFollowLastReason"
        | "lyricTimingMode"
        | "lyricAutoFollowSuspendedUntil"
        | "lyricAutoFollowLastReason"
        | "lyricAutoFollowManualScrollCount"
        | "lyricAutoFollowLastIndex"
        | "lyricAutoFollowScroller"
        | "lyricAutoFollowTargetTop"
        | "lyricAutoFollowBehavior"
        | "lyricAutoFollowLastAt"
        | "lyricAutoFollowScrollCount"
        | "lyricAutoFollowForceCount"
        | "lyricAutoFollowInstalled"
        | "instrumentalGaps"
        | "lyricSeekInteractionInstalled"
        | "timingPickListenerInstalled"
        | "timingPopoverDismissInstalled"
        | "romanizationToggle"
        | "romanizationMode"
        | "romanizationAvailable"
        | "romanizationLineCount"
        | "romanizationToggleCount"
        | "googleRomanizationCache"
        | "googleRomanizationFragmentCache"
        | "googleRomanizationAttempted"
        | "googleRomanizationRequest"
        | "googleRomanizationState"
        | "googleRomanizationError"
        | "googleRomanizationLineCount"
        | "romanizationCandidate"
        | "romanizationLoadState"
        | "romanizationSource"
        | "romanizationLoadError"
    >;
    clampTimingOffsetSeconds: (value: unknown) => number;
    resetWordMotion: (word: AnimatedWord) => void;
    wakeAnimationLoop: () => void;
    persistCurrentSongPreference: () => boolean;
    finiteNumber: (value: unknown, fallback?: number) => number;
    resetPlaybackClock: (media?: HTMLMediaElement | null, frameNow?: number) => void;
    chooseTimelineTicks: (media: HTMLMediaElement | null, frameNow: number) => number | null;
    TICKS_PER_SECOND: 10000000;
    getLocalMediaElement: (forceProbe?: boolean) => HTMLMediaElement | null;
    motion: { query: MediaQueryList | null };
    lifecycle: RendererLifecycle;
    warn: (...args: unknown[]) => void;
    sourceTimelineTicks: (media: HTMLMediaElement | null, frameNow: number, projectClock?: boolean) => number | null;
    createSvgElement: (name: string, attributes?: Record<string, string | number> | null) => SVGElement;
    TIMING_OFFSET_FINE_STEP_SECONDS: 0.1;
    queueDecoration: () => boolean;
    requestGoogleRomanizationForLyrics: () => void;
    lyricsHaveNativeScript: (lyrics: LyricInput[] | null) => boolean;
    loadSongPreferences: () => void;
}
export function createControlsPreferences(dependencies: Dependencies) {
    const {
        state,
        clampTimingOffsetSeconds,
        resetWordMotion,
        wakeAnimationLoop,
        persistCurrentSongPreference,
        finiteNumber,
        resetPlaybackClock,
        chooseTimelineTicks,
        TICKS_PER_SECOND,
        getLocalMediaElement,
        motion,
        lifecycle,
        warn,
        sourceTimelineTicks,
        createSvgElement,
        TIMING_OFFSET_FINE_STEP_SECONDS,
        queueDecoration,
        requestGoogleRomanizationForLyrics,
        lyricsHaveNativeScript,
        loadSongPreferences,
    } = dependencies;
    function removeLyricsToolsHostIfEmpty() {
        const host = state.lyricToolsHost;
        const bar = state.lyricToolsBar;

        if (bar && (!bar.isConnected || !bar.childElementCount)) {
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            state.lyricToolsBar = null;
        }

        if (!host || !host.isConnected) {
            state.lyricToolsHost = null;
            state.lyricToolsBar = null;
            return;
        }

        const hasPopover = !!(state.timingPopover && state.timingPopover.isConnected);
        const hasBar = !!(state.lyricToolsBar && state.lyricToolsBar.isConnected && state.lyricToolsBar.childElementCount);

        if (!hasPopover && !hasBar && host.parentNode) {
            host.parentNode.removeChild(host);
            state.lyricToolsHost = null;
            state.lyricToolsBar = null;
        }
    }

    function ensureLyricsToolsHost() {
        if (!state.lyrics || !isLyricsPage()) return null;
        const page = getCurrentLyricPage();
        if (!page) return null;

        let host = state.lyricToolsHost;
        if (!host || !host.isConnected) {
            host = document.createElement("div");
            host.className = "ak-lyrics-tools";
            host.dataset.akLyricsTools = "1";
            host.setAttribute("role", "group");
            host.setAttribute("aria-label", "Lyric display controls");
            page.appendChild(host);
            state.lyricToolsHost = host;
            state.lyricToolsBar = null;
        } else if (host.parentNode !== page) {
            page.appendChild(host);
        }
        return host;
    }

    function ensureLyricsToolsBar() {
        const host = ensureLyricsToolsHost();
        if (!host) return null;

        let bar = state.lyricToolsBar;
        if (!bar || !bar.isConnected) {
            bar = document.createElement("div");
            bar.className = "ak-lyrics-tools-bar";
            bar.dataset.akOwned = "1";
            host.insertBefore(bar, host.firstChild || null);
            state.lyricToolsBar = bar;
        } else if (bar.parentNode !== host) {
            host.insertBefore(bar, host.firstChild || null);
        }

        window.LyricBridge?.mountTimingBar?.(bar);
        return bar;
    }

    function formatTimingOffset(seconds: number = state.timingOffsetSeconds) {
        const value = Math.abs(seconds) < 0.0001 ? 0 : seconds;
        const sign = value >= 0 ? "+" : "-";
        return `${sign}${Math.abs(value).toFixed(1)}s`;
    }

    function rememberTimingUndo() {
        state.timingUndo = state.timingOffsetSeconds;
    }

    function updateTimingControlsUi() {
        const sharedLabel = state.timingPopover?.querySelector<HTMLElement>(".ak-timing-shared-value");
        if (sharedLabel)
            sharedLabel.textContent =
                "Shared: " +
                state.sharedTimingOffsetSeconds.toFixed(1) +
                " s · Total: " +
                (state.sharedTimingOffsetSeconds + state.timingOffsetSeconds).toFixed(1) +
                " s";
        const controls = state.timingControls;
        if (controls) {
            const valueNode = controls.querySelector<HTMLElement>(".ak-timing-chip-value");
            const value = clampTimingOffsetSeconds(state.timingOffsetSeconds);
            if (valueNode) {
                valueNode.textContent = formatTimingOffset(value);
            }
            controls.dataset.akTimingOffset = value.toFixed(1);
            controls.dataset.akTimingActive = Math.abs(value) >= 0.0001 ? "true" : "false";
            controls.setAttribute("aria-label", `Lyrics timing ${formatTimingOffset(value)}`);
            controls.setAttribute("aria-expanded", state.timingPopover && state.timingPopover.isConnected ? "true" : "false");
            controls.title = `Lyrics timing ${formatTimingOffset(value)}`;
        }

        const popover = state.timingPopover;
        if (!popover) return;

        const current = popover.querySelector<HTMLElement>(".ak-timing-current-value");
        const sync = popover.querySelector<HTMLElement>('[data-ak-timing-action="sync-one"]');
        const reset = popover.querySelector<HTMLButtonElement>('[data-ak-timing-action="reset"]');

        if (current) current.textContent = formatTimingOffset();

        if (sync) {
            sync.textContent = state.timingPickActive ? "Tap lyric to sync…" : "Sync lyric to now";
            sync.dataset.akTimingActive = state.timingPickActive ? "true" : "false";
        }

        if (reset) {
            reset.disabled = Math.abs(state.timingOffsetSeconds) < 0.0001;
        }
    }

    function invalidateTimingPaintState() {
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        state.forceNextFrame = true;
        (state.lineData || []).forEach((line) => {
            (line.words || []).forEach((word) => {
                word.visualProgress = NaN;
                word.lastPaintAt = 0;
                word._akStaticState = "";
                word._akProgressBucket = -1;
                resetWordMotion(word);
            });
        });
        wakeAnimationLoop();
    }

    function setTimingOffsetSeconds(value: unknown, persist = true, rememberUndo = true) {
        const normalized = clampTimingOffsetSeconds(value);
        const changed = Math.abs(normalized - state.timingOffsetSeconds) >= 0.0001;

        if (!changed) {
            updateTimingControlsUi();
            return {
                seconds: state.timingOffsetSeconds,
                display: formatTimingOffset(),
                songKey: state.songPreferenceKey,
            };
        }

        if (rememberUndo) rememberTimingUndo();

        state.timingOffsetSeconds = normalized;
        state.timingOffsetChangeCount += 1;

        /* Jellyfin follows the uncorrected source line on every timeupdate.
         * Once an offset is changed, make LyricMotion the sole scroll owner so
         * the source and corrected targets cannot pull the view up and down. */
        suppressJellyfinLyricAutoFollow("timing-offset-change");

        if (persist) persistCurrentSongPreference();

        invalidateTimingPaintState();
        updateTimingControlsUi();

        return {
            seconds: state.timingOffsetSeconds,
            display: formatTimingOffset(),
            songKey: state.songPreferenceKey,
        };
    }

    function adjustTimingOffsetSeconds(delta: number) {
        return setTimingOffsetSeconds(state.timingOffsetSeconds + finiteNumber(delta, 0), true, true);
    }

    function resetTimingOffsetValue() {
        return setTimingOffsetSeconds(0, true, true);
    }

    function undoTimingOffset() {
        if (state.timingUndo === null) return null;
        const previous = clampTimingOffsetSeconds(state.timingUndo);
        const current = state.timingOffsetSeconds;
        state.timingUndo = null;
        const result = setTimingOffsetSeconds(previous, true, false);
        state.timingUndo = current;
        updateTimingControlsUi();
        return result;
    }

    function timingSourceTicksForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return null;

        const wordElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-word");
        const lineElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-enhanced-line");

        const lineIndex = Number((wordElement && wordElement.dataset.akTimingLineIndex) || (lineElement && lineElement.dataset.akTimingLineIndex));

        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= state.lineData.length) {
            return null;
        }

        const line = state.lineData[lineIndex];

        if (wordElement) {
            const wordIndex = Number(wordElement.dataset.akTimingWordIndex);
            const word = Number.isInteger(wordIndex) && requireValue(line).words ? requireValue(line).words[wordIndex] : null;

            if (word && isFiniteNumber(word.start)) {
                return {
                    ticks: word.start,
                    lineIndex,
                    wordIndex,
                    granularity: "word",
                    text: word.text,
                };
            }
        }

        if (isFiniteNumber(requireValue(line).startTicks)) {
            return {
                ticks: requireValue(line).startTicks,
                lineIndex,
                wordIndex: -1,
                granularity: "line",
                text: requireValue(line).text,
            };
        }

        return null;
    }

    function mediaSeekSecondsForTimelineTicks(media: HTMLMediaElement | null, timelineTicks: number, frameNow: number = performance.now()) {
        if (!media || !isFiniteNumber(timelineTicks)) return null;

        const currentSeconds = Math.max(0, Number(media.currentTime) || 0);
        const now = isFiniteNumber(frameNow) ? frameNow : performance.now();

        /*
         * Resolve the target from the same source timeline that drives lyric
         * painting instead of assuming that media.currentTime is always the
         * original file timeline. This keeps explicit lyric seeking correct
         * with per-song timing correction and Jellyfin StartTimeTicks streams.
         * Resetting the projection first removes interpolation lead from a
         * user-initiated seek, so a click lands on the exact corrected anchor.
         */
        resetPlaybackClock(media, now);

        const currentTimelineTicks = chooseTimelineTicks(media, now);

        if (!isFiniteNumber(currentTimelineTicks)) return null;

        let targetSeconds = currentSeconds + (timelineTicks - currentTimelineTicks) / TICKS_PER_SECOND;

        if (!isFiniteNumber(targetSeconds)) return null;

        targetSeconds = Math.max(0, targetSeconds);

        const duration = Number(media.duration);
        if (isFiniteNumber(duration) && duration > 0) {
            targetSeconds = Math.min(duration, targetSeconds);
        }

        return targetSeconds;
    }

    function seekMediaToTimelineTicks(timelineTicks: number, kind = "lyric") {
        if (!isFiniteNumber(timelineTicks)) return false;

        const media = getLocalMediaElement(true);
        if (!media) return false;

        const frameNow = performance.now();
        const targetSeconds = mediaSeekSecondsForTimelineTicks(media, timelineTicks, frameNow);

        if (!isFiniteNumber(targetSeconds)) return false;

        try {
            media.currentTime = targetSeconds;
        } catch {
            return false;
        }

        resetPlaybackClock(media, frameNow);
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.activeLineIndexes = [];
        state.forceNextFrame = true;
        state.lyricSeekCount += 1;
        if (kind === "instrumental") {
            state.instrumentalSeekCount += 1;
        }
        state.lastLyricSeekKind = kind;
        state.lastLyricSeekSourceTicks = timelineTicks;
        state.lastLyricSeekMediaSeconds = targetSeconds;
        wakeAnimationLoop();
        return true;
    }

    function lyricLineIndexForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return -1;

        const lineElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-enhanced-line");
        if (!lineElement) return -1;

        const lineIndex = Number(lineElement.dataset.akTimingLineIndex);

        return Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < state.lineData.length ? lineIndex : -1;
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

        state.lyricStockAutoFollowSuppressCount += 1;
        state.lyricStockAutoFollowLastReason = reason;
        return true;
    }

    let lyricSyncButton: HTMLButtonElement | null = null;
    function updateLyricSyncButton() {
        const show =
            isLyricsPage() &&
            state.lyrics &&
            state.lyrics.length &&
            state.lyricTimingMode !== "plain" &&
            state.lyricAutoFollowSuspendedUntil === Infinity;
        if (!lyricSyncButton && show) {
            lyricSyncButton = document.createElement("button");
            lyricSyncButton.className = "lb-sync";
            lyricSyncButton.type = "button";
            lyricSyncButton.textContent = "Sync";
            lyricSyncButton.setAttribute("aria-label", "Resume following the playing lyric");
            lyricSyncButton.onclick = () => {
                resumeLyricAutoFollow("sync-button");
                const index = state.activeLineIndexes[0] ?? state.lastActiveLine;
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
        state.lyricAutoFollowSuspendedUntil = 0;
        state.lyricAutoFollowLastReason = reason;
        updateLyricSyncButton();
    }

    function suspendLyricAutoFollow(reason: string = "manual-scroll", _frameNow: number = performance.now()) {
        state.lyricAutoFollowSuspendedUntil = Infinity;
        updateLyricSyncButton();
        state.lyricAutoFollowManualScrollCount += 1;
        state.lyricAutoFollowLastReason = reason;
    }

    function lyricPlaybackFollowIndex(lineIndex: number) {
        const line = state.lineData[lineIndex];
        const anchor = line && line.backgroundVocalAnchorLineIndex;
        return line && line.isBackgroundVocal && isFiniteNumber(anchor) && Number.isInteger(anchor) && state.activeLineIndexes.includes(anchor)
            ? anchor
            : lineIndex;
    }

    function focusLyricLineIndex(
        lineIndex: number,
        { force = false, behavior = "smooth", reason = "playback" }: { force?: boolean; behavior?: ScrollBehavior; reason?: string } = {},
    ) {
        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= state.lineData.length) {
            return false;
        }

        const lineRecord = state.lineData[lineIndex];
        const element = lineRecord && lineRecord.element;
        if (!element || element.isConnected === false || typeof element.scrollIntoView !== "function") {
            return false;
        }

        const now = performance.now();

        if (!force && (state.timingPickActive || now < state.lyricAutoFollowSuspendedUntil)) {
            return false;
        }

        if (!force && state.lyricAutoFollowLastIndex === lineIndex) {
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
                state.lyricAutoFollowLastIndex === lineIndex &&
                state.lyricAutoFollowScroller === bounds.scroller &&
                Math.abs(target - requireValue(state.lyricAutoFollowTargetTop)) <= 8 &&
                (Math.abs(delta) <= 8 || (state.lyricAutoFollowBehavior === "smooth" && now - state.lyricAutoFollowLastAt < 800))
            )
                return false;
            bounds.scroller.scrollBy({
                top: delta,
                behavior: resolvedBehavior,
            });
            state.lyricAutoFollowScroller = bounds.scroller;
            state.lyricAutoFollowTargetTop = target;
            state.lyricAutoFollowBehavior = resolvedBehavior;
        } catch {
            return false;
        }

        state.lyricAutoFollowLastIndex = lineIndex;
        state.lyricAutoFollowLastAt = now;
        state.lyricAutoFollowScrollCount += 1;
        state.lyricAutoFollowLastReason = reason;
        if (force) state.lyricAutoFollowForceCount += 1;
        return true;
    }

    const lyricScrollGeometry = (element: HTMLElement) =>
        scrollGeometry(element, (element) => element instanceof HTMLElement && elementHasLiveLayout(element));
    function refreshLyricScrollSpace() {
        const container = getCurrentLyricsContainer(true);
        if (!container || !state.lineData.length) return;
        const first = state.lineData.find((line) => !line.isBackgroundVocal)?.element;
        const last = [...state.lineData].reverse().find((line) => !line.isBackgroundVocal)?.element;
        if (!first || !last) return;
        const bounds = lyricScrollGeometry(first);
        const firstHeight = first.getBoundingClientRect().height;
        const lastHeight = last.getBoundingClientRect().height;
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
        if (state.lyricAutoFollowInstalled || typeof document === "undefined") {
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
        state.lyricAutoFollowInstalled = true;
    }

    function lyricLineSourceTicksForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return null;

        const lineElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-enhanced-line");
        if (!lineElement) return null;

        const lineIndex = Number(lineElement.dataset.akTimingLineIndex);

        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= state.lineData.length) {
            return null;
        }

        const line = state.lineData[lineIndex];
        return line && isFiniteNumber(line.startTicks) ? line.startTicks : null;
    }

    function instrumentalSourceTicksForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return null;

        const note = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-instrumental-note");
        if (!note) return null;

        const row = note.closest<HTMLElement>(".ak-instrumental-gap-line");
        if (!row) return null;

        const gapIndex = Number(row.dataset.akInstrumentalGap);
        const gap = Number.isInteger(gapIndex) ? state.instrumentalGaps[gapIndex] : null;

        return gap && isFiniteNumber(gap.startTicks) ? gap.startTicks : null;
    }

    function handleLyricSeekClick(event: MouseEvent) {
        if (state.timingPickActive) return;

        const target = eventElement(event);
        if (!(target instanceof Element)) return;

        if (isFiniteNumber(Number(event.button)) && Number(event.button) !== 0) {
            return;
        }

        const instrumentalTicks = instrumentalSourceTicksForTarget(target);

        if (isFiniteNumber(instrumentalTicks)) {
            if (seekMediaToTimelineTicks(instrumentalTicks, "instrumental")) {
                event.preventDefault();
                if (typeof event.stopImmediatePropagation === "function") {
                    event.stopImmediatePropagation();
                } else {
                    event.stopPropagation();
                }
            }
            return;
        }

        const lineIndex = lyricLineIndexForTarget(target);
        if (lineIndex < 0) return;

        /*
         * A lyric click is also an explicit request to resume follow mode.
         * Jellyfin normally performs that bookkeeping inside its own click
         * handler. Corrected-timing clicks are intercepted before Jellyfin, so
         * LyricMotion must restore focus itself or a prior manual scroll can
         * leave playback updating off-screen indefinitely.
         */
        resumeLyricAutoFollow("lyric-click");
        focusLyricLineIndex(lineIndex, {
            force: true,
            behavior: "smooth",
            reason: "lyric-click",
        });

        /*
         * Preserve stock Jellyfin click behavior when no timing correction is
         * active. Once a correction exists, stock seeking still targets the
         * uncorrected lyric timestamp, which makes the renderer land on the
         * previous/next line by exactly the configured offset. Intercept only
         * that corrected case and seek on LyricMotion's adjusted timeline.
         */
        if (Math.abs(state.timingOffsetSeconds + state.sharedTimingOffsetSeconds) < 0.0001) {
            // The stock click handler runs after this capture listener and enables
            // its private follower again. Keep its seek behavior, then relinquish
            // only scrolling before the next playback update.
            Promise.resolve().then(() => suppressJellyfinLyricAutoFollow("lyric-click"));
            return;
        }

        const lineTicks = lyricLineSourceTicksForTarget(target);
        if (!isFiniteNumber(lineTicks)) return;

        if (seekMediaToTimelineTicks(lineTicks, "lyric")) {
            event.preventDefault();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            } else {
                event.stopPropagation();
            }
        }
    }

    function handleLyricSeekKeydown(event: KeyboardEvent) {
        const space = event.key === " " || event.key === "Spacebar" || event.code === "Space";
        if (space && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && isLyricsPage()) {
            const page = getCurrentLyricPage(),
                target = eventElement(event);
            const within =
                page &&
                elementHasLiveLayout(page) &&
                ((target instanceof Node && page.contains(target)) || target === document.body || target === document.documentElement);
            const control = target?.closest?.(
                'button,a,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[role="dialog"],.lb-popup,.lb-search,[role="button"]:not(.ak-instrumental-note):not(.lyricsLine)',
            );
            const dialog = [...document.querySelectorAll<HTMLElement>('.lb-popup,.lb-search,[role="dialog"]')].some(
                (element) => element instanceof HTMLElement && elementHasLiveLayout(element),
            );
            if (within && !control && !dialog) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!event.repeat) {
                    const playback = [...document.querySelectorAll<HTMLElement>(".nowPlayingBar .playPauseButton")].find(
                        (element) => element instanceof HTMLElement && elementHasLiveLayout(element),
                    );
                    if (playback) playback.click();
                    else {
                        const media = getLocalMediaElement();
                        if (media) {
                            if (media.paused) media.play().catch((error: unknown) => warn("Playback could not start", error));
                            else media.pause();
                        }
                    }
                }
                return;
            }
        }
        if (state.timingPickActive) return;

        const key = String((event && event.key) || "");

        if (key !== "Enter") return;

        const target = eventElement(event);
        const instrumentalTicks = instrumentalSourceTicksForTarget(target);

        if (!isFiniteNumber(instrumentalTicks)) {
            const line = target?.closest?.(".lyricsLine");
            if (
                line &&
                !requireValue(target).closest<HTMLElement>('button,a,input,select,textarea,[contenteditable]:not([contenteditable="false"])')
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (line instanceof HTMLElement) line.click();
            }
            return;
        }

        if (seekMediaToTimelineTicks(instrumentalTicks, "instrumental")) {
            event.preventDefault();
            if (typeof event.stopImmediatePropagation === "function") {
                event.stopImmediatePropagation();
            } else {
                event.stopPropagation();
            }
        }
    }

    function installLyricSeekInteractionHooks() {
        if (state.lyricSeekInteractionInstalled || typeof document === "undefined") {
            return;
        }

        /*
         * Capture registration happens before Jellyfin's runtime.bundle.js
         * loads. This lets a corrected lyric click suppress the stock
         * unadjusted seek without replacing Jellyfin's normal zero-offset path.
         */
        lifecycle.on(document, "click", handleLyricSeekClick, true);
        lifecycle.on(document, "keydown", handleLyricSeekKeydown, true);
        state.lyricSeekInteractionInstalled = true;
    }

    function currentUnadjustedTimelineTicks() {
        const media = getLocalMediaElement(true);
        if (!media) return null;

        const frameNow = performance.now();

        /* Sync is a human tap against audible media, so it must use the exact
         * HTML media clock at the click instant. The animation clock normally
         * projects between currentTime samples for smoother painting, but that
         * projection can be ~100-250 ms ahead of the audible anchor and made
         * "Sync lyric to now" save a visibly wrong correction. */
        resetPlaybackClock(media, frameNow);
        return sourceTimelineTicks(media, frameNow, false);
    }

    function stopTimingSyncMode() {
        state.timingPickActive = false;

        if (state.timingPickListenerInstalled && typeof document !== "undefined") {
            lifecycle.off(document, "click", handleTimingPickClick, true);
            state.timingPickListenerInstalled = false;
        }

        const page = getCurrentLyricPage();
        if (page) page.classList.remove("ak-timing-pick-mode");

        updateTimingControlsUi();
    }

    function captureTimingSync(target: EventTarget | null) {
        const source = timingSourceTicksForTarget(target);
        const actualTicks = currentUnadjustedTimelineTicks();

        if (!source || !isFiniteNumber(actualTicks)) {
            return null;
        }

        const sourceSeconds = source.ticks / TICKS_PER_SECOND;
        const actualSeconds = actualTicks / TICKS_PER_SECOND;
        const offsetSeconds = actualSeconds - sourceSeconds - state.sharedTimingOffsetSeconds;

        const result = setTimingOffsetSeconds(offsetSeconds, true, true);

        stopTimingSyncMode();

        return {
            sourceSeconds,
            actualSeconds,
            offsetSeconds: result.seconds,
            lineIndex: source.lineIndex,
            wordIndex: source.wordIndex,
            granularity: source.granularity,
            text: source.text,
        };
    }

    function handleTimingPickClick(event: Event) {
        if (!state.timingPickActive) return;

        const target = eventElement(event);
        if (!(target instanceof Element)) return;

        const lyricTarget = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-word, .ak-enhanced-line");

        if (!lyricTarget) return;

        event.preventDefault();
        if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
        } else {
            event.stopPropagation();
        }

        const captured = captureTimingSync(lyricTarget);
        if (captured) {
            /* The capture-phase listener intentionally suppresses Jellyfin's
             * stock lyric click so it cannot perform an uncorrected seek. That
             * also suppresses Jellyfin's normal resume-auto-scroll side effect,
             * so restore focus explicitly after calibration. */
            resumeLyricAutoFollow("timing-sync");
            focusLyricLineIndex(captured.lineIndex, {
                force: true,
                behavior: "smooth",
                reason: "timing-sync",
            });
            removeTimingPopover();
        }
    }

    function beginTimingSyncMode() {
        state.timingPickActive = true;

        if (!state.timingPickListenerInstalled && typeof document !== "undefined") {
            lifecycle.on(document, "click", handleTimingPickClick, true);
            state.timingPickListenerInstalled = true;
        }

        const page = getCurrentLyricPage();
        if (page) page.classList.add("ak-timing-pick-mode");

        updateTimingControlsUi();

        return { active: true };
    }

    function removeTimingPopover() {
        stopTimingSyncMode();
        removeTimingPopoverDismissListeners();

        const popover = state.timingPopover;
        if (popover && popover.parentNode) {
            popover.parentNode.removeChild(popover);
        }
        state.timingPopover = null;
        updateTimingControlsUi();
        removeLyricsToolsHostIfEmpty();
    }

    function createTimingActionButton(label: string, action: string, className = "") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ak-timing-action ${className}`.trim();
        button.dataset.akTimingAction = action;
        button.textContent = label;
        return button;
    }

    function createSpeechIconSvg() {
        const svg = createSvgElement("svg", {
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            "aria-hidden": "true",
            focusable: "false",
        });
        svg.classList.add("ak-romanization-speech-icon");

        svg.appendChild(
            createSvgElement("path", {
                d: "M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20",
            }),
        );
        svg.appendChild(
            createSvgElement("path", {
                d: "M19.8 17.8a7.5 7.5 0 0 0 .003-10.603",
            }),
        );
        svg.appendChild(
            createSvgElement("path", {
                d: "M17 15a3.5 3.5 0 0 0-.025-4.975",
            }),
        );

        return svg;
    }

    function createTimingIconSvg() {
        const svg = createSvgElement("svg", {
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            "stroke-width": "2",
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            "aria-hidden": "true",
            focusable: "false",
        });
        svg.classList.add("ak-timing-clock-icon");
        svg.appendChild(
            createSvgElement("circle", {
                cx: "12",
                cy: "13",
                r: "8",
            }),
        );
        svg.appendChild(
            createSvgElement("path", {
                d: "M12 9v4l2.5 1.5",
            }),
        );
        svg.appendChild(
            createSvgElement("path", {
                d: "M9 2h6M12 2v3",
            }),
        );
        return svg;
    }

    function handleTimingPopoverDismissPointerDown(event: Event) {
        if (!state.timingPopover || !state.timingPopover.isConnected) {
            removeTimingPopoverDismissListeners();
            return;
        }

        const target = event.target instanceof Element ? event.target : null;
        const insidePopover = !!(
            target &&
            (target instanceof Element ? target : null)?.closest &&
            (target instanceof Element ? target : null)?.closest<HTMLElement>("#ak-lyrics-timing-popover")
        );
        const insideChip = !!(
            target &&
            (target instanceof Element ? target : null)?.closest &&
            (target instanceof Element ? target : null)?.closest<HTMLElement>("#lyrics-timing-display")
        );

        const timingPickTarget = !!(
            state.timingPickActive &&
            target &&
            (target instanceof Element ? target : null)?.closest &&
            (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-word, .ak-enhanced-line")
        );

        /* pointerdown occurs before click. Closing here used to call
         * stopTimingSyncMode(), remove the click listener, and silently cancel
         * the very lyric tap the user was trying to use as the sync anchor. */
        if (!insidePopover && !insideChip && !timingPickTarget) {
            removeTimingPopover();
        }
    }

    function handleTimingPopoverDismissKeyDown(event: KeyboardEvent) {
        if (event && event.key === "Escape") {
            removeTimingPopover();
        }
    }

    function installTimingPopoverDismissListeners() {
        if (state.timingPopoverDismissInstalled) return;
        lifecycle.on(document, "pointerdown", handleTimingPopoverDismissPointerDown, true);
        lifecycle.on(document, "keydown", handleTimingPopoverDismissKeyDown, true);
        state.timingPopoverDismissInstalled = true;
    }

    function removeTimingPopoverDismissListeners() {
        if (!state.timingPopoverDismissInstalled) return;
        lifecycle.off(document, "pointerdown", handleTimingPopoverDismissPointerDown, true);
        lifecycle.off(document, "keydown", handleTimingPopoverDismissKeyDown, true);
        state.timingPopoverDismissInstalled = false;
    }

    function ensureTimingPopover() {
        if (state.timingPopover && state.timingPopover.isConnected) {
            return state.timingPopover;
        }

        const host = ensureLyricsToolsHost();
        if (!host) return null;

        const popover = document.createElement("div");
        popover.id = "ak-lyrics-timing-popover";
        popover.className = "ak-timing-popover";
        popover.dataset.akOwned = "1";
        popover.setAttribute("role", "dialog");
        popover.setAttribute("aria-label", "Lyrics timing assistant");

        const compactRow = document.createElement("div");
        compactRow.className = "ak-timing-compact-row";
        compactRow.appendChild(createTimingActionButton("−0.1", "minus-fine"));

        const current = document.createElement("strong");
        current.className = "ak-timing-current-value";
        compactRow.appendChild(current);

        compactRow.appendChild(createTimingActionButton("+0.1", "plus-fine"));

        const sync = createTimingActionButton("Sync lyric to now", "sync-one", "ak-timing-action-wide ak-timing-action-primary");
        sync.setAttribute("aria-live", "polite");

        const reset = createTimingActionButton("Reset", "reset", "ak-timing-action-wide");

        const timingLabel = document.createElement("div");
        timingLabel.textContent = "Personal timing adjustment";
        timingLabel.className = "ak-timing-shared-description";
        popover.appendChild(timingLabel);
        const sharedLabel = document.createElement("div");
        sharedLabel.className = "ak-timing-shared-value";
        popover.appendChild(sharedLabel);
        popover.appendChild(compactRow);
        popover.appendChild(sync);
        popover.appendChild(reset);

        popover.addEventListener("click", (event) => {
            const button = eventElement(event)?.closest<HTMLElement>("[data-ak-timing-action]") ?? null;

            if (!button) return;

            event.preventDefault();
            event.stopPropagation();

            const action = button.dataset.akTimingAction;

            if (action === "minus-fine") {
                adjustTimingOffsetSeconds(-TIMING_OFFSET_FINE_STEP_SECONDS);
            } else if (action === "plus-fine") {
                adjustTimingOffsetSeconds(TIMING_OFFSET_FINE_STEP_SECONDS);
            } else if (action === "sync-one") {
                beginTimingSyncMode();
            } else if (action === "reset") {
                resetTimingOffsetValue();
            }

            updateTimingControlsUi();
        });

        host.appendChild(popover);
        state.timingPopover = popover;
        installTimingPopoverDismissListeners();
        updateTimingControlsUi();

        return popover;
    }

    function toggleTimingPopover() {
        if (state.timingPopover && state.timingPopover.isConnected) {
            removeTimingPopover();
            return null;
        }

        return ensureTimingPopover();
    }

    function removeTimingControls() {
        removeTimingPopover();

        const controls = state.timingControls;
        if (controls && controls.parentNode) {
            controls.parentNode.removeChild(controls);
        }
        state.timingControls = null;
        removeLyricsToolsHostIfEmpty();
    }

    function ensureTimingControls() {
        if (!state.lyrics || !isLyricsPage()) {
            removeTimingControls();
            return null;
        }

        const bar = ensureLyricsToolsBar();
        if (!bar) return null;

        let controls = state.timingControls instanceof HTMLButtonElement ? state.timingControls : null;

        if (!controls || !controls.isConnected) {
            controls = document.createElement("button");
            controls.type = "button";
            controls.id = "lyrics-timing-display";
            controls.className = "ak-lyrics-timing-chip";
            controls.dataset.akOwned = "1";
            controls.setAttribute("aria-haspopup", "dialog");
            controls.setAttribute("aria-controls", "ak-lyrics-timing-popover");
            controls.setAttribute("aria-expanded", "false");

            const icon = document.createElement("span");
            icon.className = "ak-timing-chip-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.appendChild(createTimingIconSvg());

            const value = document.createElement("span");
            value.className = "ak-timing-chip-value";
            value.setAttribute("aria-live", "polite");

            controls.appendChild(icon);
            controls.appendChild(value);

            controls.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleTimingPopover();
            });

            bar.appendChild(controls);
            state.timingControls = controls;
        } else if (controls.parentNode !== bar) {
            bar.appendChild(controls);
        }

        updateTimingControlsUi();
        return controls;
    }

    function removeRomanizationToggle() {
        const button = state.romanizationToggle;
        if (button && button.parentNode) {
            button.parentNode.removeChild(button);
        }
        state.romanizationToggle = null;
        removeLyricsToolsHostIfEmpty();
    }

    function updateRomanizationToggleUi() {
        const button = state.romanizationToggle;
        if (!button) return;
        const active = state.romanizationMode === "romanized";
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.setAttribute("aria-label", active ? "Show native lyrics" : "Show romanized lyrics");
        button.dataset.akRomanizationMode = active ? "romanized" : "native";
        button.title = active ? "Show native lyrics" : "Show romanized lyrics";
    }

    function ensureRomanizationToggle() {
        if (window.LyricBridge && window.LyricBridge.current) {
            removeRomanizationToggle();
            return null;
        }
        if (!state.romanizationAvailable || !isLyricsPage()) {
            removeRomanizationToggle();
            return null;
        }

        const bar = ensureLyricsToolsBar();
        if (!bar) return null;

        let button = state.romanizationToggle;
        if (!button || !button.isConnected) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "ak-romanization-toggle";
            button.setAttribute("aria-label", "Toggle lyric romanization");

            const icon = document.createElement("span");
            icon.className = "ak-romanization-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.appendChild(createSpeechIconSvg());

            button.appendChild(icon);
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                setRomanizationMode(state.romanizationMode === "romanized" ? "native" : "romanized");
            });

            /* Romanization remains the leading desktop/mobile tool, but the
             * shared toolbar presents both controls as one compact glass bar. */
            bar.insertBefore(button, bar.firstChild || null);
            state.romanizationToggle = button;
        } else if (button.parentNode !== bar) {
            bar.insertBefore(button, bar.firstChild || null);
        }

        updateRomanizationToggleUi();
        return button;
    }

    function redecorateForRomanization() {
        state.romanizationLineCount = 0;
        state.lastActiveLine = -999;
        state.lastActiveLineSignature = "";
        state.lyricAutoFollowLastIndex = -1;
        state.forceNextFrame = true;

        if (state.lyrics && isLyricsPage()) {
            queueDecoration();
        }
        ensureRomanizationToggle();
        wakeAnimationLoop();
    }

    function setRomanizationMode(mode: string) {
        const normalized = mode === "romanized" ? "romanized" : "native";
        if (normalized === "romanized" && !state.romanizationAvailable) {
            return {
                mode: state.romanizationMode,
                available: false,
            };
        }

        if (state.romanizationMode !== normalized) {
            state.romanizationMode = normalized;
            state.romanizationToggleCount += 1;
            persistCurrentSongPreference();
            redecorateForRomanization();
            if (normalized === "romanized") {
                requestGoogleRomanizationForLyrics();
            }
        } else {
            updateRomanizationToggleUi();
            if (normalized === "romanized") {
                requestGoogleRomanizationForLyrics();
            }
        }

        return {
            mode: state.romanizationMode,
            available: state.romanizationAvailable,
        };
    }

    function prepareRomanizationForLyrics() {
        const lyrics = state.lyrics;
        const nativeCandidate = lyricsHaveNativeScript(lyrics);

        state.googleRomanizationCache.clear();
        state.googleRomanizationFragmentCache.clear();
        state.googleRomanizationAttempted.clear();
        state.googleRomanizationRequest = null;
        state.googleRomanizationState = "idle";
        state.googleRomanizationError = "";
        state.googleRomanizationLineCount = 0;
        state.romanizationCandidate = nativeCandidate;
        state.romanizationAvailable = false;
        state.romanizationLineCount = 0;
        removeRomanizationToggle();

        if (!nativeCandidate) {
            if (state.romanizationMode === "romanized") {
                state.romanizationMode = "native";
                persistCurrentSongPreference();
            }
            state.romanizationLoadState = "idle";
            state.romanizationSource = "none";
            return;
        }

        state.romanizationLoadState = "ready";
        state.romanizationLoadError = "";
        state.romanizationAvailable = true;
        state.romanizationSource = "google-dt-rm";
        ensureRomanizationToggle();
        if (state.romanizationMode === "romanized") {
            redecorateForRomanization();
            requestGoogleRomanizationForLyrics();
        }
    }

    loadSongPreferences();

    return {
        removeLyricsToolsHostIfEmpty,
        ensureLyricsToolsHost,
        ensureLyricsToolsBar,
        formatTimingOffset,
        rememberTimingUndo,
        updateTimingControlsUi,
        invalidateTimingPaintState,
        setTimingOffsetSeconds,
        adjustTimingOffsetSeconds,
        resetTimingOffsetValue,
        undoTimingOffset,
        timingSourceTicksForTarget,
        mediaSeekSecondsForTimelineTicks,
        seekMediaToTimelineTicks,
        lyricLineIndexForTarget,
        lyricAutoFollowReducedMotion,
        suppressJellyfinLyricAutoFollow,
        updateLyricSyncButton,
        resumeLyricAutoFollow,
        suspendLyricAutoFollow,
        lyricPlaybackFollowIndex,
        focusLyricLineIndex,
        refreshLyricScrollSpace,
        handleLyricManualScroll,
        installLyricAutoFollowHooks,
        lyricLineSourceTicksForTarget,
        instrumentalSourceTicksForTarget,
        handleLyricSeekClick,
        handleLyricSeekKeydown,
        installLyricSeekInteractionHooks,
        currentUnadjustedTimelineTicks,
        stopTimingSyncMode,
        captureTimingSync,
        handleTimingPickClick,
        beginTimingSyncMode,
        removeTimingPopover,
        createTimingActionButton,
        createSpeechIconSvg,
        createTimingIconSvg,
        handleTimingPopoverDismissPointerDown,
        handleTimingPopoverDismissKeyDown,
        installTimingPopoverDismissListeners,
        removeTimingPopoverDismissListeners,
        ensureTimingPopover,
        toggleTimingPopover,
        removeTimingControls,
        ensureTimingControls,
        removeRomanizationToggle,
        updateRomanizationToggleUi,
        ensureRomanizationToggle,
        redecorateForRomanization,
        setRomanizationMode,
        prepareRomanizationForLyrics,
    };
}
