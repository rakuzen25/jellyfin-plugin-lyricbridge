/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../../shared/invariants.ts";
import { finiteTick } from "../playback/ticks.ts";
import {
    detectScriptProfile,
    firstStrongDirection,
    getGraphemeRanges,
    getWordRanges,
    usesWholeShapedMotion,
} from "../pronunciation/text-processing.ts";
import type { CueInput } from "./cue-ranges.ts";
import type { GeometryWord } from "./geometry.ts";
import type { CueRecord, RenderSegment, RenderWord } from "./models.ts";
import { clamp01 } from "./motion.ts";
import { cueValue } from "./payload.ts";

interface Dependencies {
    cueEndTicks: (lineIndex: number, cueIndex: number, cue: CueInput, records: CueRecord[]) => number;
    prefersReducedMotion: () => boolean;
}
const SHORT_WORD_GLOW_MIN_DURATION_MS = 1320;
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function createWordModel({ cueEndTicks, prefersReducedMotion }: Dependencies) {
    function cueRecordStart(record: CueRecord) {
        return finiteTick(cueValue(record.cue, "Start", "start")) ?? 0;
    }

    function buildWordRecords(text: string, lineIndex: number, cueRecords: CueRecord[]): RenderWord[] {
        const ranges = getWordRanges(text, cueRecords);

        return ranges.map((range, wordIndex) => {
            const wordLength = Math.max(1, range.end - range.start);
            const segments: RenderSegment[] = [];

            cueRecords.forEach((record, cueIndex) => {
                const overlapStart = Math.max(range.start, record.startPos);
                const overlapEnd = Math.min(range.end, record.endPos);

                if (overlapEnd <= overlapStart) return;

                const start = isFiniteNumber(record.start) ? record.start : cueRecordStart(record);

                const end = isFiniteNumber(record.end) ? record.end : cueEndTicks(lineIndex, cueIndex, record.cue, cueRecords);

                segments.push({
                    cueIndex,
                    startPos: overlapStart - range.start,
                    endPos: overlapEnd - range.start,
                    start,
                    end,
                });
            });

            segments.sort((a, b) => {
                if (a.startPos !== b.startPos) return a.startPos - b.startPos;
                return a.start - b.start;
            });

            /*
             * The word itself is one shaped DOM span. Cue boundaries only
             * control the progress math. Extend the outermost segment to the
             * word edges so punctuation/combining ink never pops in at the
             * final frame.
             */
            if (segments.length) {
                requireValue(segments[0]).startPos = 0;
                requireValue(segments[segments.length - 1]).endPos = wordLength;

                for (let i = 0; i < segments.length - 1; i += 1) {
                    const left = segments[i];
                    const right = segments[i + 1];
                    const boundary = Math.max(
                        requireValue(left).startPos,
                        Math.min(wordLength, (requireValue(left).endPos + requireValue(right).startPos) / 2),
                    );

                    requireValue(left).endPos = boundary;
                    requireValue(right).startPos = boundary;
                }
            }

            const start = segments[0]?.start ?? Number.NaN;
            const end = segments.length ? Math.max(...segments.map((segment) => segment.end)) : Number.NaN;

            const scriptProfile = detectScriptProfile(range.text);

            return {
                lineIndex,
                wordIndex,
                text: range.text,
                startPos: range.start,
                endPos: range.end,
                length: wordLength,
                segments,
                start,
                end,
                scriptProfile,
                paintMode: usesWholeShapedMotion(scriptProfile) ? "shaped" : "spatial",
                isRtl: firstStrongDirection(range.text) === "rtl",
                element: null,
                visualProgress: 0,
                lastPaintAt: Number.NaN,
                motionMode: "none",
                motionGlow: false,
                motionDurationMs: 0,
                motionGlyphs: [],
                wholeMotion: null,
                geometryReady: false,
                geometrySource: "unprepared",
            };
        });
    }

    function visibleWordLength(word: GeometryWord) {
        if (!word || !word.text) return 0;

        return getGraphemeRanges(word.text).filter((range) => /\S/u.test(range.text)).length;
    }

    function canUseGraphemeMotionOverlay(word: RenderWord) {
        if (!word) return false;

        const compact = String(word.text || "").replace(/\s+/g, "");

        if (!compact) return false;

        /* Explicit join controls mean that visual shaping can cross the
         * Unicode grapheme boundary. Keep those words intact. */
        if (compact.indexOf("\u200c") >= 0 || compact.indexOf("\u200d") >= 0) {
            return false;
        }

        /* Arabic-family joining and unknown complex scripts must remain one
         * shaped run. Indic/Dravidian/Bengali/Thai/etc. are safe here because
         * getGraphemeRanges() refuses boundaries after viramas, before marks,
         * inside Hangul clusters or across join controls. That lets an entire
         * akshara/grapheme receive the exact same staggered Classic Bloom used
         * by Latin without splitting conjuncts or vowel marks. */
        return ["arabic", "complex", "universal"].indexOf(word.scriptProfile) < 0;
    }

    function classifyWordMotion(words: RenderWord[]) {
        const reducedMotion = prefersReducedMotion();

        words.forEach((word) => {
            if (reducedMotion || !word.segments.length || !isFiniteNumber(word.start) || !isFiniteNumber(word.end) || word.end <= word.start) {
                word.motionMode = "none";
                word.motionGlow = false;
                word.motionDurationMs = 0;
                return;
            }

            const durationMs = (word.end - word.start) / 10000;
            const wordLen = Math.max(1, visibleWordLength(word));
            const text = word.text || "";

            word.glyphCount = wordLen;

            /*
             * Motion eligibility is language-agnostic.
             *
             * Rendering remains script-aware later:
             * segment-safe scripts -> staggered grapheme layer
             * contextual/complex scripts -> one fully-shaped word
             */
            const canAnimate = !text.includes("-") && wordLen > 0;

            let growable = canAnimate && wordLen <= 7;

            if (growable) {
                if (wordLen <= 1) {
                    growable = durationMs >= 1050 && durationMs >= wordLen * 525;
                } else if (wordLen <= 3) {
                    growable = durationMs >= SHORT_WORD_GLOW_MIN_DURATION_MS + (wordLen - 2) * 140;
                } else {
                    growable = durationMs >= 850 && durationMs >= wordLen * 190;
                }
            }

            /* Motion and bloom are one effect. Words that miss the complete
             * grow/glow eligibility test keep only their neutral timed sweep;
             * a lift without its bloom reads as a stray vertical jump. */
            word.motionMode = growable ? "grow" : "none";

            word.motionGlow = growable;
            word.motionDurationMs = durationMs;

            /*
             * Repo-style dynamic intensity/growth, computed once per word.
             * Per-grapheme position decay is added later for segment-safe overlays.
             */
            const minDuration = 400;
            const maxDuration = 3000;
            const rawDurationProgress = clamp01((durationMs - minDuration) / (maxDuration - minDuration));

            word._motionDurationProgress = rawDurationProgress ** 3;
        });
    }

    return { buildWordRecords, visibleWordLength, canUseGraphemeMotionOverlay, classifyWordMotion };
}
