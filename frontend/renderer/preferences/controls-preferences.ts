import { TICKS_PER_SECOND, TIMING_OFFSET_FINE_STEP_SECONDS } from "../common/settings.ts";
import type { AutoFollowPort } from "../follow/ports.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { FrameSchedulerStatePort } from "../playback/frame-ports.ts";
import type { PronunciationStatePort } from "../pronunciation/ports.ts";
import type { SongPreferencesStatePort } from "./song-ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { icon as createIcon, type IconName } from "../../shared/icons.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";

import { elementHasLiveLayout, getCurrentLyricPage, isLyricsPage } from "../host/host.ts";
import type { AnimatedWord } from "../lyrics/karaoke-animation.ts";
import type { LyricInput } from "../lyrics/payload.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
function eventElement(event: Event): HTMLElement | null {
    return event.target instanceof HTMLElement ? event.target : null;
}

interface OwnedState {
    lyricToolsHost: HTMLElement | null;
    lyricToolsBar: HTMLElement | null;
    timingControls: HTMLElement | null;
    timingPopover: HTMLElement | null;
    timingPopoverDismissInstalled: boolean;
    timingPickActive: boolean;
    timingPickListenerInstalled: boolean;
    lyricSeekInteractionInstalled: boolean;
    romanizationToggle: HTMLButtonElement | null;
    romanizationToggleCount: number;
    timingOffsetChangeCount: number;
    lyricSeekCount: number;
    instrumentalSeekCount: number;
    lastLyricSeekKind: string;
    timingUndo: number | null;
}

interface Dependencies {
    lyricsPort: LyricSessionStatePort;
    preferencesPort: SongPreferencesStatePort;
    framesPort: FrameSchedulerStatePort;
    pronunciationPort: PronunciationStatePort;
    clampTimingOffsetSeconds: (value: unknown) => number;
    resetWordMotion: (word: AnimatedWord) => void;
    wakeAnimationLoop: () => void;
    persistCurrentSongPreference: () => boolean;
    finiteNumber: (value: unknown, fallback?: number) => number;
    resetPlaybackClock: (media?: HTMLMediaElement | null, frameNow?: number) => void;
    chooseTimelineTicks: (media: HTMLMediaElement | null, frameNow: number) => number | null;
    getLocalMediaElement: (forceProbe?: boolean) => HTMLMediaElement | null;
    autoFollow: AutoFollowPort;
    lifecycle: Lifecycle;
    warn: (...args: unknown[]) => void;
    sourceTimelineTicks: (media: HTMLMediaElement | null, frameNow: number, projectClock?: boolean) => number | null;
    queueDecoration: () => boolean;
    requestGoogleRomanizationForLyrics: () => void;
    lyricsHaveNativeScript: (lyrics: LyricInput[] | null) => boolean;
    loadSongPreferences: () => void;
}
export function createControlsPreferences(dependencies: Dependencies) {
    const {
        lyricsPort,
        preferencesPort,
        framesPort,
        pronunciationPort,
        clampTimingOffsetSeconds,
        resetWordMotion,
        wakeAnimationLoop,
        persistCurrentSongPreference,
        finiteNumber,
        resetPlaybackClock,
        chooseTimelineTicks,
        getLocalMediaElement,
        autoFollow,
        lifecycle,
        warn,
        sourceTimelineTicks,
        queueDecoration,
        requestGoogleRomanizationForLyrics,
        lyricsHaveNativeScript,
        loadSongPreferences,
    } = dependencies;
    const { lyricLineIndexForTarget, suppressJellyfinLyricAutoFollow, resumeLyricAutoFollow, focusLyricLineIndex } = autoFollow;
    const owned: OwnedState = {
        lyricToolsHost: null,
        lyricToolsBar: null,
        timingControls: null,
        timingPopover: null,
        timingPopoverDismissInstalled: false,
        timingPickActive: false,
        timingPickListenerInstalled: false,
        lyricSeekInteractionInstalled: false,
        romanizationToggle: null,
        romanizationToggleCount: 0,
        timingOffsetChangeCount: 0,
        lyricSeekCount: 0,
        instrumentalSeekCount: 0,
        lastLyricSeekKind: "",
        timingUndo: null,
    };
    function removeLyricsToolsHostIfEmpty() {
        const host = owned.lyricToolsHost;
        const bar = owned.lyricToolsBar;

        if (bar && (!bar.isConnected || !bar.childElementCount)) {
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            owned.lyricToolsBar = null;
        }

        if (!host || !host.isConnected) {
            owned.lyricToolsHost = null;
            owned.lyricToolsBar = null;
            return;
        }

        const hasPopover = !!(owned.timingPopover && owned.timingPopover.isConnected);
        const hasBar = !!(owned.lyricToolsBar && owned.lyricToolsBar.isConnected && owned.lyricToolsBar.childElementCount);

        if (!hasPopover && !hasBar && host.parentNode) {
            host.parentNode.removeChild(host);
            owned.lyricToolsHost = null;
            owned.lyricToolsBar = null;
        }
    }

    function ensureLyricsToolsHost() {
        if (!lyricsPort.snapshot.lyrics || !isLyricsPage()) return null;
        const page = getCurrentLyricPage();
        if (!page) return null;

        let host = owned.lyricToolsHost;
        if (!host || !host.isConnected) {
            host = document.createElement("div");
            host.className = "ak-lyrics-tools";
            host.dataset.akLyricsTools = "1";
            host.setAttribute("role", "group");
            host.setAttribute("aria-label", "Lyric display controls");
            page.appendChild(host);
            owned.lyricToolsHost = host;
            owned.lyricToolsBar = null;
        } else if (host.parentNode !== page) {
            page.appendChild(host);
        }
        return host;
    }

    function ensureLyricsToolsBar() {
        const host = ensureLyricsToolsHost();
        if (!host) return null;

        let bar = owned.lyricToolsBar;
        if (!bar || !bar.isConnected) {
            bar = document.createElement("div");
            bar.className = "ak-lyrics-tools-bar";
            bar.dataset.akOwned = "1";
            host.insertBefore(bar, host.firstChild || null);
            owned.lyricToolsBar = bar;
        } else if (bar.parentNode !== host) {
            host.insertBefore(bar, host.firstChild || null);
        }

        window.LyricBridge?.mountTimingBar?.(bar);
        return bar;
    }

    function formatTimingOffset(seconds: number = preferencesPort.snapshot.timingOffsetSeconds) {
        const value = Math.abs(seconds) < 0.0001 ? 0 : seconds;
        const sign = value >= 0 ? "+" : "-";
        return `${sign}${Math.abs(value).toFixed(1)}s`;
    }

    function rememberTimingUndo() {
        owned.timingUndo = preferencesPort.snapshot.timingOffsetSeconds;
    }

    function updateTimingControlsUi() {
        const sharedLabel = owned.timingPopover?.querySelector<HTMLElement>(".ak-timing-shared-value");
        if (sharedLabel)
            sharedLabel.textContent =
                "Shared: " +
                preferencesPort.snapshot.sharedTimingOffsetSeconds.toFixed(1) +
                " s · Total: " +
                (preferencesPort.snapshot.sharedTimingOffsetSeconds + preferencesPort.snapshot.timingOffsetSeconds).toFixed(1) +
                " s";
        const controls = owned.timingControls;
        if (controls) {
            const valueNode = controls.querySelector<HTMLElement>(".ak-timing-chip-value");
            const value = clampTimingOffsetSeconds(preferencesPort.snapshot.timingOffsetSeconds);
            if (valueNode) {
                valueNode.textContent = formatTimingOffset(value);
            }
            controls.dataset.akTimingOffset = value.toFixed(1);
            controls.dataset.akTimingActive = Math.abs(value) >= 0.0001 ? "true" : "false";
            controls.setAttribute("aria-label", `Lyrics timing ${formatTimingOffset(value)}`);
            controls.setAttribute("aria-expanded", owned.timingPopover && owned.timingPopover.isConnected ? "true" : "false");
            controls.title = `Lyrics timing ${formatTimingOffset(value)}`;
        }

        const popover = owned.timingPopover;
        if (!popover) return;

        const current = popover.querySelector<HTMLElement>(".ak-timing-current-value");
        const sync = popover.querySelector<HTMLElement>('[data-ak-timing-action="sync-one"]');
        const reset = popover.querySelector<HTMLButtonElement>('[data-ak-timing-action="reset"]');

        if (current) current.textContent = formatTimingOffset();

        if (sync) {
            const label = sync.querySelector(".lb-action-label");
            if (label) label.textContent = owned.timingPickActive ? "Tap lyric to sync…" : "Sync lyric to now";
            sync.setAttribute("aria-pressed", String(owned.timingPickActive));
            sync.dataset.akTimingActive = owned.timingPickActive ? "true" : "false";
        }

        if (reset) {
            reset.disabled = Math.abs(preferencesPort.snapshot.timingOffsetSeconds) < 0.0001;
        }
    }

    function invalidateTimingPaintState() {
        lyricsPort.setLastActiveLine(-999);
        lyricsPort.setLastActiveLineSignature("");
        lyricsPort.setActiveLineIndexes([]);
        framesPort.setForceNextFrame(true);
        (lyricsPort.snapshot.lineData || []).forEach((line) => {
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
        const changed = Math.abs(normalized - preferencesPort.snapshot.timingOffsetSeconds) >= 0.0001;

        if (!changed) {
            updateTimingControlsUi();
            return {
                seconds: preferencesPort.snapshot.timingOffsetSeconds,
                display: formatTimingOffset(),
                songKey: preferencesPort.snapshot.songPreferenceKey,
            };
        }

        if (rememberUndo) rememberTimingUndo();

        preferencesPort.setTimingOffsetSeconds(normalized);
        owned.timingOffsetChangeCount += 1;

        /* Jellyfin follows the uncorrected source line on every timeupdate.
         * Once an offset is changed, make LyricMotion the sole scroll owner so
         * the source and corrected targets cannot pull the view up and down. */
        suppressJellyfinLyricAutoFollow("timing-offset-change");

        if (persist) persistCurrentSongPreference();

        invalidateTimingPaintState();
        updateTimingControlsUi();

        return {
            seconds: preferencesPort.snapshot.timingOffsetSeconds,
            display: formatTimingOffset(),
            songKey: preferencesPort.snapshot.songPreferenceKey,
        };
    }

    function adjustTimingOffsetSeconds(delta: number) {
        return setTimingOffsetSeconds(preferencesPort.snapshot.timingOffsetSeconds + finiteNumber(delta, 0), true, true);
    }

    function resetTimingOffsetValue() {
        return setTimingOffsetSeconds(0, true, true);
    }

    function undoTimingOffset() {
        if (owned.timingUndo === null) return null;
        const previous = clampTimingOffsetSeconds(owned.timingUndo);
        const current = preferencesPort.snapshot.timingOffsetSeconds;
        owned.timingUndo = null;
        const result = setTimingOffsetSeconds(previous, true, false);
        owned.timingUndo = current;
        updateTimingControlsUi();
        return result;
    }

    function timingSourceTicksForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return null;

        const wordElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-word");
        const lineElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-enhanced-line");

        const lineIndex = Number((wordElement && wordElement.dataset.akTimingLineIndex) || (lineElement && lineElement.dataset.akTimingLineIndex));

        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lyricsPort.snapshot.lineData.length) {
            return null;
        }

        const line = lyricsPort.snapshot.lineData[lineIndex];

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
        lyricsPort.setLastActiveLine(-999);
        lyricsPort.setLastActiveLineSignature("");
        lyricsPort.setActiveLineIndexes([]);
        framesPort.setForceNextFrame(true);
        owned.lyricSeekCount += 1;
        if (kind === "instrumental") {
            owned.instrumentalSeekCount += 1;
        }
        owned.lastLyricSeekKind = kind;
        wakeAnimationLoop();
        return true;
    }

    function lyricLineSourceTicksForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return null;

        const lineElement = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-enhanced-line");
        if (!lineElement) return null;

        const lineIndex = Number(lineElement.dataset.akTimingLineIndex);

        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lyricsPort.snapshot.lineData.length) {
            return null;
        }

        const line = lyricsPort.snapshot.lineData[lineIndex];
        return line && isFiniteNumber(line.startTicks) ? line.startTicks : null;
    }

    function instrumentalSourceTicksForTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) return null;

        const note = (target instanceof Element ? target : null)?.closest<HTMLElement>(".ak-instrumental-note");
        if (!note) return null;

        const row = note.closest<HTMLElement>(".ak-instrumental-gap-line");
        if (!row) return null;

        const gapIndex = Number(row.dataset.akInstrumentalGap);
        const gap = Number.isInteger(gapIndex) ? lyricsPort.snapshot.instrumentalGaps[gapIndex] : null;

        return gap && isFiniteNumber(gap.startTicks) ? gap.startTicks : null;
    }

    function handleLyricSeekClick(event: MouseEvent) {
        if (owned.timingPickActive) return;

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
        if (Math.abs(preferencesPort.snapshot.timingOffsetSeconds + preferencesPort.snapshot.sharedTimingOffsetSeconds) < 0.0001) {
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
        if (owned.timingPickActive) return;

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
        if (owned.lyricSeekInteractionInstalled || typeof document === "undefined") {
            return;
        }

        /*
         * Capture registration happens before Jellyfin's runtime.bundle.js
         * loads. This lets a corrected lyric click suppress the stock
         * unadjusted seek without replacing Jellyfin's normal zero-offset path.
         */
        lifecycle.on(document, "click", handleLyricSeekClick, true);
        lifecycle.on(document, "keydown", handleLyricSeekKeydown, true);
        owned.lyricSeekInteractionInstalled = true;
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
        owned.timingPickActive = false;

        if (owned.timingPickListenerInstalled && typeof document !== "undefined") {
            lifecycle.off(document, "click", handleTimingPickClick, true);
            owned.timingPickListenerInstalled = false;
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
        const offsetSeconds = actualSeconds - sourceSeconds - preferencesPort.snapshot.sharedTimingOffsetSeconds;

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
        if (!owned.timingPickActive) return;

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
        owned.timingPickActive = true;

        if (!owned.timingPickListenerInstalled && typeof document !== "undefined") {
            lifecycle.on(document, "click", handleTimingPickClick, true);
            owned.timingPickListenerInstalled = true;
        }

        const page = getCurrentLyricPage();
        if (page) page.classList.add("ak-timing-pick-mode");

        updateTimingControlsUi();

        return { active: true };
    }

    function removeTimingPopover() {
        stopTimingSyncMode();
        removeTimingPopoverDismissListeners();

        const popover = owned.timingPopover;
        if (popover && popover.parentNode) {
            popover.parentNode.removeChild(popover);
        }
        owned.timingPopover = null;
        updateTimingControlsUi();
        removeLyricsToolsHostIfEmpty();
    }

    function createTimingActionButton(label: string, action: string, glyph: IconName, className = "", iconOnly = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `lb-button ak-timing-action ${className}`.trim();
        button.dataset.akTimingAction = action;
        button.append(createIcon(glyph));
        if (iconOnly) {
            button.classList.add("lb-icon-button");
            button.setAttribute("aria-label", label);
            button.dataset.tooltip = label;
            button.title = label;
        } else {
            const text = document.createElement("span");
            text.className = "lb-action-label";
            text.textContent = label;
            button.append(text);
        }
        return button;
    }

    function handleTimingPopoverDismissPointerDown(event: Event) {
        if (!owned.timingPopover || !owned.timingPopover.isConnected) {
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
            owned.timingPickActive &&
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
        if (owned.timingPopoverDismissInstalled) return;
        lifecycle.on(document, "pointerdown", handleTimingPopoverDismissPointerDown, true);
        lifecycle.on(document, "keydown", handleTimingPopoverDismissKeyDown, true);
        owned.timingPopoverDismissInstalled = true;
    }

    function removeTimingPopoverDismissListeners() {
        if (!owned.timingPopoverDismissInstalled) return;
        lifecycle.off(document, "pointerdown", handleTimingPopoverDismissPointerDown, true);
        lifecycle.off(document, "keydown", handleTimingPopoverDismissKeyDown, true);
        owned.timingPopoverDismissInstalled = false;
    }

    function ensureTimingPopover() {
        if (owned.timingPopover && owned.timingPopover.isConnected) {
            return owned.timingPopover;
        }

        const host = ensureLyricsToolsHost();
        if (!host) return null;

        const popover = document.createElement("div");
        popover.id = "ak-lyrics-timing-popover";
        popover.className = "ak-timing-popover";
        popover.dataset.akOwned = "1";
        popover.setAttribute("role", "dialog");
        popover.setAttribute("aria-label", "Lyrics timing assistant");
        const heading = document.createElement("h2");
        heading.className = "ak-timing-heading";
        heading.textContent = "Adjust timing";
        const header = document.createElement("header");
        header.className = "lb-popup-header";
        const close = createTimingActionButton("Close", "close", "close", "", true);
        header.append(heading, close);
        popover.appendChild(header);

        const compactRow = document.createElement("div");
        compactRow.className = "ak-timing-compact-row";
        compactRow.appendChild(createTimingActionButton("Decrease timing by 0.1 seconds", "minus-fine", "minus", "", true));

        const current = document.createElement("strong");
        current.className = "ak-timing-current-value";
        compactRow.appendChild(current);

        compactRow.appendChild(createTimingActionButton("Increase timing by 0.1 seconds", "plus-fine", "plus", "", true));

        const sync = createTimingActionButton("Sync lyric to now", "sync-one", "sync", "ak-timing-action-wide lb-primary");
        sync.setAttribute("aria-live", "polite");

        const reset = createTimingActionButton("Reset", "reset", "reset", "ak-timing-action-wide");

        const timingLabel = document.createElement("div");
        timingLabel.textContent = "Personal timing adjustment";
        timingLabel.className = "ak-timing-shared-description lb-field-label";
        popover.appendChild(timingLabel);
        const sharedLabel = document.createElement("div");
        sharedLabel.className = "ak-timing-shared-value lb-help";
        popover.appendChild(sharedLabel);
        popover.appendChild(compactRow);
        popover.appendChild(sync);
        popover.appendChild(reset);

        popover.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target?.closest<HTMLElement>("[data-ak-timing-action]") ?? null;

            if (!button) return;

            event.preventDefault();
            event.stopPropagation();

            const action = button.dataset.akTimingAction;

            if (action === "close") {
                removeTimingPopover();
                owned.timingControls?.focus({ preventScroll: true });
                return;
            } else if (action === "minus-fine") {
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
        owned.timingPopover = popover;
        document.dispatchEvent(new CustomEvent("lyricbridge:timing-panel", { detail: popover }));
        installTimingPopoverDismissListeners();
        updateTimingControlsUi();

        return popover;
    }

    function toggleTimingPopover() {
        if (owned.timingPopover && owned.timingPopover.isConnected) {
            removeTimingPopover();
            return null;
        }

        return ensureTimingPopover();
    }

    function removeTimingControls() {
        removeTimingPopover();

        const controls = owned.timingControls;
        if (controls && controls.parentNode) {
            controls.parentNode.removeChild(controls);
        }
        owned.timingControls = null;
        removeLyricsToolsHostIfEmpty();
    }

    function ensureTimingControls() {
        if (!lyricsPort.snapshot.lyrics || !isLyricsPage()) {
            removeTimingControls();
            return null;
        }

        const bar = ensureLyricsToolsBar();
        if (!bar) return null;

        let controls = owned.timingControls instanceof HTMLButtonElement ? owned.timingControls : null;

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
            const svg = createIcon("timing");
            svg.classList.add("ak-timing-clock-icon");
            icon.appendChild(svg);

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
            owned.timingControls = controls;
        } else if (controls.parentNode !== bar) {
            bar.appendChild(controls);
        }

        updateTimingControlsUi();
        return controls;
    }

    function removeRomanizationToggle() {
        const button = owned.romanizationToggle;
        if (button && button.parentNode) {
            button.parentNode.removeChild(button);
        }
        owned.romanizationToggle = null;
        removeLyricsToolsHostIfEmpty();
    }

    function updateRomanizationToggleUi() {
        const button = owned.romanizationToggle;
        if (!button) return;
        const active = pronunciationPort.snapshot.romanizationMode === "romanized";
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
        if (!pronunciationPort.snapshot.romanizationAvailable || !isLyricsPage()) {
            removeRomanizationToggle();
            return null;
        }

        const bar = ensureLyricsToolsBar();
        if (!bar) return null;

        let button = owned.romanizationToggle;
        if (!button || !button.isConnected) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "ak-romanization-toggle";
            button.setAttribute("aria-label", "Toggle lyric romanization");

            const icon = document.createElement("span");
            icon.className = "ak-romanization-icon";
            icon.setAttribute("aria-hidden", "true");
            const svg = createIcon("speech");
            svg.classList.add("ak-romanization-speech-icon");
            icon.appendChild(svg);

            button.appendChild(icon);
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                setRomanizationMode(pronunciationPort.snapshot.romanizationMode === "romanized" ? "native" : "romanized");
            });

            /* Romanization remains the leading desktop/mobile tool, but the
             * shared toolbar presents both controls as one compact glass bar. */
            bar.insertBefore(button, bar.firstChild || null);
            owned.romanizationToggle = button;
        } else if (button.parentNode !== bar) {
            bar.insertBefore(button, bar.firstChild || null);
        }

        updateRomanizationToggleUi();
        return button;
    }

    function redecorateForRomanization() {
        pronunciationPort.setRomanizationLineCount(0);
        lyricsPort.setLastActiveLine(-999);
        lyricsPort.setLastActiveLineSignature("");
        autoFollow.invalidateTarget();
        framesPort.setForceNextFrame(true);

        if (lyricsPort.snapshot.lyrics && isLyricsPage()) {
            queueDecoration();
        }
        ensureRomanizationToggle();
        wakeAnimationLoop();
    }

    function setRomanizationMode(mode: string) {
        const normalized = mode === "romanized" ? "romanized" : "native";
        if (normalized === "romanized" && !pronunciationPort.snapshot.romanizationAvailable) {
            return {
                mode: pronunciationPort.snapshot.romanizationMode,
                available: false,
            };
        }

        if (pronunciationPort.snapshot.romanizationMode !== normalized) {
            pronunciationPort.setRomanizationMode(normalized);
            owned.romanizationToggleCount += 1;
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
            mode: pronunciationPort.snapshot.romanizationMode,
            available: pronunciationPort.snapshot.romanizationAvailable,
        };
    }

    function prepareRomanizationForLyrics() {
        const lyrics = lyricsPort.snapshot.lyrics;
        const nativeCandidate = lyricsHaveNativeScript(lyrics);

        pronunciationPort.clearGoogleRomanizationCache();
        pronunciationPort.clearGoogleRomanizationFragmentCache();
        pronunciationPort.clearGoogleRomanizationAttempted();
        pronunciationPort.setGoogleRomanizationRequest(null);
        pronunciationPort.setGoogleRomanizationState("idle");
        pronunciationPort.setGoogleRomanizationError("");
        pronunciationPort.setGoogleRomanizationLineCount(0);
        pronunciationPort.setRomanizationCandidate(nativeCandidate);
        pronunciationPort.setRomanizationAvailable(false);
        pronunciationPort.setRomanizationLineCount(0);
        removeRomanizationToggle();

        if (!nativeCandidate) {
            if (pronunciationPort.snapshot.romanizationMode === "romanized") {
                pronunciationPort.setRomanizationMode("native");
                persistCurrentSongPreference();
            }
            pronunciationPort.setRomanizationLoadState("idle");
            pronunciationPort.setRomanizationSource("none");
            return;
        }

        pronunciationPort.setRomanizationLoadState("ready");
        pronunciationPort.setRomanizationLoadError("");
        pronunciationPort.setRomanizationAvailable(true);
        pronunciationPort.setRomanizationSource("google-dt-rm");
        ensureRomanizationToggle();
        if (pronunciationPort.snapshot.romanizationMode === "romanized") {
            redecorateForRomanization();
            requestGoogleRomanizationForLyrics();
        }
    }

    loadSongPreferences();

    function resetTimingInteraction() {
        owned.timingPickActive = false;
        owned.timingUndo = null;
    }
    function removeTools() {
        removeRomanizationToggle();
        removeTimingControls();
        owned.lyricToolsHost?.remove();
        owned.lyricToolsHost = null;
        owned.lyricToolsBar = null;
    }
    return {
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
        get instrumentalSeekCount() {
            return owned.instrumentalSeekCount;
        },
        isTimingPickActive: () => owned.timingPickActive,
        diagnostics: () => ({ ...owned }),
    };
}
