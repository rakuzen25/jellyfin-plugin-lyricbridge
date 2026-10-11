/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { CueInput } from "./cue-ranges.ts";
import { finiteTick, nullableTick } from "./ticks.ts";
export interface TimelineLyric {
    Start?: unknown;
    start?: unknown;
    End?: unknown;
    end?: unknown;
}
export interface TimedWord {
    start: number;
    end: number;
}
export interface LineBounds {
    startTicks: number;
    endTicks: number;
    trustedEndTicks: number | null;
    text?: string;
}
export interface InstrumentalGap {
    index: number;
    startTicks: number;
    endTicks: number;
    durationTicks: number;
    nextLineIndex: number;
    isIntro: boolean;
    element: HTMLElement | null;
    lastProgress: number;
}
const INSTRUMENTAL_GAP_MIN_TICKS = 20_000_000;
function finiteNumber(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
function value(object: TimelineLyric | CueInput | null | undefined, pascal: string, camel: string): unknown {
    if (!object) return undefined;
    const data = object as Record<string, unknown>;
    return data[pascal] !== undefined ? data[pascal] : data[camel];
}
export function nextLyricStartTicks(lyrics: TimelineLyric[] | null, lineIndex: number, afterTicks: number | null = null) {
    const current = lyrics && lyrics[lineIndex];
    const currentStart = finiteTick(value(current, "Start", "start"));
    const threshold = finiteTick(afterTicks) ?? currentStart;

    for (let index = lineIndex + 1; lyrics && index < lyrics.length; index += 1) {
        const start = finiteTick(value(lyrics[index], "Start", "start"));
        if (start !== null && (threshold === null || start > threshold)) {
            return start;
        }
    }

    return null;
}

export function calculateLineBounds(
    lyrics: TimelineLyric[] | null,
    lyric: TimelineLyric,
    lineIndex: number,
    words: TimedWord[] | null,
    cues: CueInput[] | null,
    rawTextLength: number,
) {
    const lyricStart = finiteTick(value(lyric, "Start", "start"));

    const wordStarts = (words || []).map((word) => finiteTick(word.start)).filter((value) => value !== null);

    const startTicks = lyricStart !== null ? lyricStart : wordStarts.length ? Math.min(...wordStarts) : 0;

    const endCandidates: number[] = [];
    const trustedEndCandidates: number[] = [];
    const lyricEnd = finiteTick(value(lyric, "End", "end"));

    if (lyricEnd !== null && lyricEnd > startTicks) {
        endCandidates.push(lyricEnd);
        trustedEndCandidates.push(lyricEnd);
    }

    (words || []).forEach((word) => {
        const end = finiteTick(word.end);
        if (end !== null && end > startTicks) {
            endCandidates.push(end);
        }
    });

    const cueList = Array.isArray(cues) ? cues : [];
    let terminalTextCue: CueInput | null = null;

    let latestTextCueStart = startTicks;

    cueList.forEach((cue) => {
        const position = finiteTick(value(cue, "Position", "position"));
        const endPosition = finiteTick(value(cue, "EndPosition", "endPosition"));
        const cueStart = finiteTick(value(cue, "Start", "start"));

        if (position !== null && position < rawTextLength && (endPosition === null || endPosition > position)) {
            terminalTextCue = cue;
            if (cueStart !== null) {
                latestTextCueStart = Math.max(latestTextCueStart, cueStart);
            }
        } else if (position === null && cueList.length) {
            /*
             * Some Jellyfin/provider payloads omit source positions. In
             * that case array order is the only available cue order, so
             * remember the latest non-empty candidate conservatively.
             */
            terminalTextCue = cue;
            if (cueStart !== null) {
                latestTextCueStart = Math.max(latestTextCueStart, cueStart);
            }
        }
    });

    cueList.forEach((cue) => {
        const cueStart = finiteTick(value(cue, "Start", "start"));
        const explicitEnd = finiteTick(value(cue, "End", "end"));

        if (explicitEnd !== null && explicitEnd > Math.max(startTicks, cueStart === null ? startTicks : cueStart)) {
            endCandidates.push(explicitEnd);
            if (cue === terminalTextCue) {
                trustedEndCandidates.push(explicitEnd);
            }
        }

        const position = finiteTick(value(cue, "Position", "position"));

        /*
         * The converter emits a final empty enhanced timestamp. Jellyfin
         * exposes it as a cue at text.length; retain it as the true line
         * end even when the following line has already started.
         */
        if (position !== null && position >= rawTextLength && cueStart !== null && cueStart > startTicks) {
            endCandidates.push(cueStart);
            trustedEndCandidates.push(cueStart);
        }
    });

    let endTicks = endCandidates.length ? Math.max(...endCandidates) : nextLyricStartTicks(lyrics, lineIndex);

    if (endTicks === null || endTicks <= startTicks) {
        endTicks = startTicks + 7500000;
    }

    const latestWordStart = wordStarts.length ? Math.max(...wordStarts) : startTicks;
    const latestVocalStart = Math.max(latestTextCueStart, latestWordStart);
    const trustworthyTerminalEnds = trustedEndCandidates.filter((value) => value > latestVocalStart);

    return {
        startTicks,
        endTicks,
        /*
         * Instrumental-break detection must never invent a vocal ending.
         * Only explicit lyric/cue endings or the converter's final empty
         * enhanced timestamp count as trustworthy silence boundaries.
         * A normal LRC line without an end therefore stays conservative
         * and will not create a fake music-note row before the next line.
         */
        trustedEndTicks: trustworthyTerminalEnds.length ? Math.max(...trustworthyTerminalEnds) : null,
    };
}

export function planInstrumentalGaps(lineData: LineBounds[], minimumTicks = INSTRUMENTAL_GAP_MIN_TICKS) {
    if (!Array.isArray(lineData) || !lineData.length) return [];

    const threshold = Math.max(0, finiteNumber(minimumTicks, INSTRUMENTAL_GAP_MIN_TICKS));

    const ordered = lineData
        .map((line, lineIndex) => ({
            line,
            lineIndex,
            startTicks: nullableTick(line && line.startTicks),
            endTicks: nullableTick(line && line.endTicks),
            trustedEndTicks: nullableTick(line && line.trustedEndTicks),
        }))
        .filter((item) => item.startTicks !== null && (item.line == null || item.line.text == null || String(item.line.text).trim().length > 0))
        .sort((left, right) => left.startTicks! - right.startTicks! || left.lineIndex - right.lineIndex);

    if (!ordered.length) return [];

    /*
     * Several lead/background lines can begin on the same tick. They are
     * one vocal start event, so only the first DOM line in that group can
     * own a synthetic instrumental row.
     */
    const startGroups: { startTicks: number; targetLineIndex: number; items: (typeof ordered)[number][] }[] = [];

    ordered.forEach((item) => {
        const previous = startGroups[startGroups.length - 1];

        if (previous && previous.startTicks === item.startTicks) {
            previous.items.push(item);
            previous.targetLineIndex = Math.min(previous.targetLineIndex, item.lineIndex);
            return;
        }

        startGroups.push({
            startTicks: item.startTicks!,
            targetLineIndex: item.lineIndex,
            items: [item],
        });
    });

    const gaps: InstrumentalGap[] = [];

    startGroups.forEach((group, groupIndex) => {
        const nextStart = group.startTicks;

        if (!Number.isFinite(nextStart) || nextStart <= 0) return;

        let gapStart = 0;

        if (groupIndex > 0) {
            const previousStart = startGroups[groupIndex - 1]!.startTicks;
            let foundRelevantVocal = false;
            let unresolvedEnd = false;

            for (const item of ordered) {
                if (item.startTicks! >= nextStart) break;

                /*
                 * Only vocals that can belong to the immediately prior
                 * overlap block matter. Older completed lines must not
                 * suppress a later instrumental section forever.
                 */
                const reachesPreviousBlock = item.startTicks! >= previousStart || (item.endTicks !== null && item.endTicks > previousStart);

                if (!reachesPreviousBlock) continue;

                foundRelevantVocal = true;

                if (item.trustedEndTicks === null) {
                    unresolvedEnd = true;
                    break;
                }

                gapStart = Math.max(gapStart, item.trustedEndTicks);
            }

            if (!foundRelevantVocal || unresolvedEnd) return;
        }

        const durationTicks = nextStart - gapStart;

        if (!Number.isFinite(durationTicks) || durationTicks < threshold) {
            return;
        }

        gaps.push({
            index: gaps.length,
            startTicks: gapStart,
            endTicks: nextStart,
            durationTicks,
            nextLineIndex: group.targetLineIndex,
            isIntro: groupIndex === 0,
            element: null,
            lastProgress: -1,
        });
    });

    return gaps;
}
