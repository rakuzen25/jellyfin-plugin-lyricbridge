import { LINE_CLASS_NEIGHBORHOOD, TICKS_PER_SECOND } from "../common/settings.ts";
import type { FrameSchedulerStatePort } from "../playback/frame-ports.ts";
import type { SongPreferencesStatePort } from "../preferences/song-ports.ts";
import type { LyricSessionStatePort } from "./session-ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { isRecord, requireValue } from "../../shared/invariants.ts";

import { finiteTick } from "../playback/ticks.ts";
import { nextLyricStartTicks as nextTimelineStart } from "../playback/timeline.ts";
import type { CueInput } from "./cue-ranges.ts";
import type { AnimatedWord } from "./karaoke-animation.ts";
import type { CueRecord, RenderGap, RenderLine } from "./models.ts";
import { cueValue } from "./payload.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

interface Dependencies {
    finiteNumber: (value: unknown, fallback?: number) => number;
    clampTimingOffsetSeconds: (value: unknown) => number;
    preferencesPort: SongPreferencesStatePort;
    lyricsPort: LyricSessionStatePort;
    framesPort: FrameSchedulerStatePort;
    projectedMediaSeconds: (media: HTMLMediaElement, frameNow: number) => number;
    getStartTimeTicksFromUrl: (media: HTMLMediaElement | null) => number;
    getJellyfinActiveLineIndex: () => number;
    findLineIndexAtTicks: (ticks: number) => number;
    instrumentalGapDistanceBand: (lineIndex: number, nextLineIndex: number) => "far" | "middle";
    motionHandoffActive: (word: AnimatedWord, timelineTicks: number) => boolean;
    setStaticWordState: (word: AnimatedWord, stateName: string, frameNow: number, preserveMotion?: boolean) => void;
    resetWordMotion: (word: AnimatedWord) => void;
    motionContinuityGain: (word: AnimatedWord, timelineTicks: number) => number;
    updateMotionGlyphs: (word: AnimatedWord, timelineTicks: number, continuityGain?: number) => void;
    updateWholeMotion: (word: AnimatedWord, timelineTicks: number, continuityGain?: number) => void;
}
export function createPlaybackCoordinator(dependencies: Dependencies) {
    const {
        finiteNumber,
        clampTimingOffsetSeconds,
        preferencesPort,
        lyricsPort,
        framesPort,
        projectedMediaSeconds,
        getStartTimeTicksFromUrl,
        getJellyfinActiveLineIndex,
        findLineIndexAtTicks,
        instrumentalGapDistanceBand,
        motionHandoffActive,
        setStaticWordState,
        resetWordMotion,
        motionContinuityGain,
        updateMotionGlyphs,
        updateWholeMotion,
    } = dependencies;
    function applyUserTimingOffsetTicks(ticks: number) {
        const mediaSeconds = finiteNumber(ticks, 0) / TICKS_PER_SECOND;
        const sourceSeconds =
            mediaSeconds -
            clampTimingOffsetSeconds(preferencesPort.snapshot.timingOffsetSeconds) -
            preferencesPort.snapshot.sharedTimingOffsetSeconds;
        return sourceSeconds * TICKS_PER_SECOND;
    }

    function sourceTimelineTicks(media: HTMLMediaElement | null, frameNow: number, projectClock = true) {
        if (!media) return null;
        const seconds = projectClock ? projectedMediaSeconds(media, frameNow) : Math.max(0, Number(media.currentTime) || 0);
        const rawTicks = seconds * TICKS_PER_SECOND;
        const startOffset = getStartTimeTicksFromUrl(media);
        let timelineTicks = rawTicks;

        if (startOffset) {
            /*
             * When transcoding starts at a non-zero point, Jellyfin may keep
             * the original timeline offset outside the HTML media element.
             * Choose the source timeline first; the user's display offset is
             * applied only afterwards so it cannot confuse this detection.
             */
            const jellyIndex = getJellyfinActiveLineIndex();

            if (jellyIndex >= 0) {
                const rawIndex = findLineIndexAtTicks(rawTicks);
                const offsetIndex = findLineIndexAtTicks(rawTicks + startOffset);

                if (offsetIndex === jellyIndex && rawIndex !== jellyIndex) {
                    timelineTicks = rawTicks + startOffset;
                } else if (rawIndex === jellyIndex) {
                    timelineTicks = rawTicks;
                } else {
                    timelineTicks = rawTicks + startOffset;
                }
            } else {
                timelineTicks = rawTicks + startOffset;
            }
        }

        return timelineTicks;
    }

    function chooseTimelineTicks(media: HTMLMediaElement | null, frameNow: number) {
        const timelineTicks = sourceTimelineTicks(media, frameNow, true);
        return isFiniteNumber(timelineTicks) ? applyUserTimingOffsetTicks(timelineTicks) : null;
    }

    function cueEndTicks(lineIndex: number, cueIndex: number, cue: CueInput, cues: (CueRecord | CueInput)[]) {
        const start = finiteTick(cueValue(cue, "Start", "start")) || 0;
        const explicitEnd = finiteTick(cueValue(cue, "End", "end"));
        if (explicitEnd !== null && explicitEnd > start) {
            return explicitEnd;
        }

        const cueList = Array.isArray(cues) ? cues : [];

        /* A cue can be skipped from visual tokenisation because it is empty,
         * duplicated, or otherwise has no paintable text. It can nevertheless
         * be the authoritative timing boundary for the preceding visible cue
         * (most notably the terminal text.length marker emitted by the
         * converter). Scan forward to the first strictly later timestamp
         * instead of only consulting the next paintable cue. */
        for (let nextIndex = Math.max(0, Number(cueIndex) + 1); nextIndex < cueList.length; nextIndex += 1) {
            const nextEntry = cueList[nextIndex];
            const nextCue = nextEntry && isRecord(nextEntry.cue) ? nextEntry.cue : nextEntry;
            const nextStart = finiteTick(cueValue(requireValue(nextCue), "Start", "start"));

            if (nextStart !== null && nextStart > start) {
                return nextStart;
            }
        }

        const currentLyric = lyricsPort.snapshot.lyrics && lyricsPort.snapshot.lyrics[lineIndex];

        const explicitLineEnd = finiteTick(cueValue(currentLyric, "End", "end"));

        if (explicitLineEnd !== null && explicitLineEnd > start) {
            return explicitLineEnd;
        }

        const nextLineStart = nextTimelineStart(lyricsPort.snapshot.lyrics, lineIndex, start);
        if (nextLineStart !== null && nextLineStart > start) {
            return nextLineStart;
        }

        return start + 7500000;
    }

    function distanceToActiveLines(lineIndex: number, activeLines: readonly number[]) {
        if (!activeLines || !activeLines.length) {
            return 999;
        }

        let minimum = 999;

        for (const activeIndex of activeLines) {
            minimum = Math.min(minimum, Math.abs(lineIndex - activeIndex));
        }

        return minimum;
    }

    function overlapLineDistanceBand(lineIndex: number, activeLines: readonly number[]) {
        const distance = distanceToActiveLines(lineIndex, activeLines);

        if (distance === 0) return "current";
        if (distance === 1) return "near";
        if (distance === 2) return "near2";
        if (distance >= 5) return "far";
        return "middle";
    }

    function updateLineState(
        lineRecord: RenderLine | undefined,
        lineIndex: number,
        activeLine: number,
        activeLines: readonly number[],
        ticks: number,
        frameNow: number,
        force: boolean,
        instrumentalGap: RenderGap | null = null,
    ) {
        if (!lineRecord) return false;
        const isActive = !instrumentalGap && activeLines.includes(lineIndex);

        const overlapCurrent = isActive && activeLines.length > 1;

        const trustedEnd = Number(lineRecord.trustedEndTicks);
        const presentationExpired =
            !instrumentalGap && !isActive && lineIndex === activeLine && isFiniteNumber(trustedEnd) && isFiniteNumber(ticks) && ticks >= trustedEnd;

        const phase = instrumentalGap
            ? lineIndex < instrumentalGap.nextLineIndex
                ? "past"
                : "future"
            : isActive
              ? "current"
              : presentationExpired || lineIndex < activeLine
                ? "past"
                : lineIndex > activeLine
                  ? "future"
                  : "current";

        const band = instrumentalGap
            ? instrumentalGapDistanceBand(lineIndex, instrumentalGap.nextLineIndex)
            : overlapLineDistanceBand(lineIndex, activeLines);

        const phaseChanged = force || lineRecord._akPhase !== phase;

        const overlapChanged = force || lineRecord._akOverlapCurrent !== overlapCurrent;

        const bandChanged = force || lineRecord._akBand !== band;

        if (!phaseChanged && !bandChanged && !overlapChanged) {
            return false;
        }

        lineRecord._akPhase = phase;
        lineRecord._akBand = band;
        lineRecord._akOverlapCurrent = overlapCurrent;

        const lineElement = lineRecord.element;

        if (phaseChanged) {
            lineElement.classList.toggle("ak-current", phase === "current");

            lineElement.classList.toggle("ak-past", phase === "past");

            lineElement.classList.toggle("ak-future", phase === "future");
        }

        if (overlapChanged) {
            lineElement.classList.toggle("ak-overlap-current", overlapCurrent);
        }

        if (bandChanged) {
            lineElement.classList.toggle("ak-near", band === "near");

            lineElement.classList.toggle("ak-near2", band === "near2");

            lineElement.classList.toggle("ak-far", band === "far");
        }

        const words = lineRecord.words || [];

        if (!words.length || !phaseChanged) {
            return true;
        }

        if (phase === "past") {
            const dynamicCarry = !!(lyricsPort.snapshot.handoffLineIndexes && lyricsPort.snapshot.handoffLineIndexes.has(lineIndex));

            words.forEach((word) => {
                const keep = dynamicCarry && motionHandoffActive(word, ticks);

                setStaticWordState(word, "past", frameNow, keep);
            });
        } else if (phase === "future") {
            words.forEach((word) => {
                setStaticWordState(word, "future", frameNow, false);
            });
        }

        return true;
    }

    function clearLineMotionHandoff(lineRecord: RenderLine | undefined) {
        if (!lineRecord) return;

        if (lineRecord.element) {
            lineRecord.element.classList.remove("ak-motion-handoff");
        }

        (lineRecord.words || []).forEach(resetWordMotion);
    }

    function resetMotionHandoffs() {
        const indexes = lyricsPort.snapshot.handoffLineIndexes;
        if (!indexes || typeof indexes.forEach !== "function") return;

        indexes.forEach((lineIndex: number) => {
            clearLineMotionHandoff(lyricsPort.snapshot.lineData[lineIndex]);
        });
        lyricsPort.clearHandoffLineIndexes();
    }

    function syncStaticLineStates(
        activeLine: number,
        activeLines: readonly number[],
        ticks: number,
        frameNow: number,
        instrumentalGap: RenderGap | null = null,
    ) {
        const previous = lyricsPort.snapshot.lastActiveLine;

        const instrumentalActive = !!instrumentalGap;

        const removedActiveLines = lyricsPort.snapshot.activeLineIndexes.filter((index: number) => !activeLines.includes(index));

        const forceFull = previous < -1 || activeLine < 0 || Math.abs(activeLine - previous) > 1;

        const indexes: number[] = [];
        const included: Record<number, boolean> = {};

        const include = (index: number) => {
            if (index < 0 || index >= lyricsPort.snapshot.lineData.length || included[index]) {
                return;
            }

            included[index] = true;
            indexes.push(index);
        };

        if (forceFull) {
            for (let index = 0; index < lyricsPort.snapshot.lineData.length; index += 1) {
                include(index);
            }
        } else {
            for (let offset = -LINE_CLASS_NEIGHBORHOOD; offset <= LINE_CLASS_NEIGHBORHOOD; offset += 1) {
                include(previous + offset);
                include(activeLine + offset);
            }

            /* Long call-and-response overlaps can span many intervening lines. */
            lyricsPort.snapshot.activeLineIndexes.forEach(include);
            activeLines.forEach(include);
        }

        if (forceFull || instrumentalActive) {
            resetMotionHandoffs();
        } else {
            removedActiveLines.forEach((lineIndex: number) => {
                const line = lyricsPort.snapshot.lineData[lineIndex];
                const preserve = !!(line && (line.words || []).some((word) => motionHandoffActive(word, ticks)));

                if (preserve) {
                    lyricsPort.addHandoffLineIndexes(lineIndex);
                } else {
                    lyricsPort.removeHandoffLineIndexes(lineIndex);
                    clearLineMotionHandoff(line);
                }
            });

            activeLines.forEach((lineIndex: number) => {
                if (lyricsPort.removeHandoffLineIndexes(lineIndex)) {
                    clearLineMotionHandoff(lyricsPort.snapshot.lineData[lineIndex]);
                }
            });
        }

        let mutationCount = 0;

        indexes.forEach((lineIndex: number) => {
            if (
                updateLineState(
                    lyricsPort.snapshot.lineData[lineIndex],
                    lineIndex,
                    activeLine,
                    activeLines,
                    ticks,
                    frameNow,
                    forceFull,
                    instrumentalGap,
                )
            ) {
                mutationCount += 1;
            }
        });

        framesPort.setLineTransitionCount(framesPort.snapshot.lineTransitionCount + 1);
        framesPort.setLastLineSyncCount(mutationCount);
        framesPort.setMaxLineSyncCount(Math.max(framesPort.snapshot.maxLineSyncCount, mutationCount));

        lyricsPort.setLastActiveLine(activeLine);
    }

    function updateLineHandoffs(ticks: number, activeLines: readonly number[]) {
        const indexes = lyricsPort.snapshot.handoffLineIndexes;
        if (!indexes || !indexes.size) return;

        const active = Array.isArray(activeLines) ? activeLines : [];

        Array.from(indexes).forEach((lineIndex: number) => {
            const line = lyricsPort.snapshot.lineData[lineIndex];

            if (!line || !line.element || active.includes(lineIndex)) {
                clearLineMotionHandoff(line);
                lyricsPort.removeHandoffLineIndexes(lineIndex);
                return;
            }

            let anyHandoff = false;

            (line.words || []).forEach((word) => {
                const preserve = motionHandoffActive(word, ticks);

                if (!preserve) {
                    resetWordMotion(word);
                    return;
                }

                anyHandoff = true;
                requireValue(word.element).classList.add("ak-word-handoff");

                const continuityGain = motionContinuityGain(word, ticks);

                if (word.motionGlyphs && word.motionGlyphs.length) {
                    updateMotionGlyphs(word, ticks, continuityGain);
                } else if (word.wholeMotion) {
                    updateWholeMotion(word, ticks, continuityGain);
                }
            });

            line.element.classList.toggle("ak-motion-handoff", anyHandoff);

            if (!anyHandoff) lyricsPort.removeHandoffLineIndexes(lineIndex);
        });
    }

    return {
        applyUserTimingOffsetTicks,
        sourceTimelineTicks,
        chooseTimelineTicks,
        cueEndTicks,
        distanceToActiveLines,
        overlapLineDistanceBand,
        updateLineState,
        clearLineMotionHandoff,
        resetMotionHandoffs,
        syncStaticLineStates,
        updateLineHandoffs,
    };
}
