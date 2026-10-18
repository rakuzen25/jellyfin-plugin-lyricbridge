import { readView } from "../../shared/read-view.ts";
import {
    GOOGLE_ROMANIZATION_CACHE_MAX_ENTRIES,
    GOOGLE_ROMANIZATION_CONCURRENCY,
    GOOGLE_ROMANIZATION_MAX_RETRIES,
    GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
    GOOGLE_ROMANIZATION_RETRY_DELAY_MS,
    GOOGLE_ROMANIZATION_TIMEOUT_MS,
} from "../common/settings.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { PronunciationState } from "./ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../../shared/invariants.ts";

import type { Lifecycle } from "../../shared/lifecycle.ts";
import type { CueInput, CueRange } from "../lyrics/cue-ranges.ts";
import { normalizedCueTextRanges, orderedCuesBySourcePosition } from "../lyrics/cue-ranges.ts";
import type { LyricInput } from "../lyrics/payload.ts";
import { cueValue, lyricTextProfile } from "../lyrics/payload.ts";
import { finiteTick } from "../playback/ticks.ts";
import { detectScriptProfile } from "./text-processing.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

interface Dependencies {
    lifecycle: Lifecycle;
    lyricsPort: LyricSessionStatePort;
    redecorateForRomanization: () => void;
    warn: (...args: unknown[]) => void;
}
export function createPronunciationController(dependencies: Dependencies) {
    const state: PronunciationState = {
        romanizationMode: "native",
        romanizationAvailable: false,
        romanizationCandidate: false,
        romanizationLoadState: "idle",
        romanizationLoadError: "",
        romanizationSource: "none",
        googleRomanizationCache: new Map(),
        googleRomanizationFragmentCache: new Map(),
        googleRomanizationAttempted: new Set(),
        googleRomanizationRequest: null,
        googleRomanizationState: "idle",
        googleRomanizationError: "",
        googleRomanizationLineCount: 0,
        romanizationLineCount: 0,
    };
    const snapshot = readView(state);

    const { lifecycle, lyricsPort, redecorateForRomanization, warn } = dependencies;
    const pending = new Set<AbortController>();
    const waiting = new Set<() => void>();
    function cancelPronunciationRequests() {
        for (const controller of pending) controller.abort();
        pending.clear();
        for (const release of [...waiting]) release();
        waiting.clear();
    }
    lifecycle.own(cancelPronunciationRequests);
    function hasNativeScriptCandidate(text: string) {
        const value = String(text || "").trim();
        if (!value) return false;
        const profile = detectScriptProfile(value);
        return profile !== "latin";
    }

    function lyricsHaveNativeScript(lyrics: LyricInput[] | null) {
        return (lyrics || []).some((lyric) => {
            const profile = lyricTextProfile(lyric);
            return hasNativeScriptCandidate(profile.text);
        });
    }

    function googleRomanizationUrl(text: string) {
        return "https://translate.googleapis.com/translate_a/single" + `?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
    }

    function waitForGoogleRetry(milliseconds: number) {
        return new Promise<void>((resolve) => {
            let timer = 0;
            let release = () => {};
            release = lifecycle.own(() => {
                lifecycle.clearTimeout(timer);
                waiting.delete(release);
                resolve();
            });
            if (!lifecycle.isDisposed) waiting.add(release);
            timer = lifecycle.timeout(release, milliseconds);
        });
    }

    async function googleFetchWithTimeout(url: string) {
        if (lifecycle.isDisposed) throw new DOMException("Renderer disposed", "AbortError");
        if (typeof fetch !== "function") throw new Error("Fetch API unavailable");
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        if (controller) pending.add(controller);
        const release = lifecycle.own(() => controller?.abort());
        const timeout = controller ? lifecycle.timeout(() => controller.abort(), GOOGLE_ROMANIZATION_TIMEOUT_MS) : null;
        try {
            const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
            if (!response || !response.ok) {
                throw new Error(`Google romanization HTTP ${(response && response.status) || "error"}`);
            }
            const payload: unknown = await response.json();
            return payload;
        } finally {
            if (timeout) lifecycle.clearTimeout(timeout);
            if (controller) pending.delete(controller);
            release();
        }
    }

    function parseGoogleRomanization(payload: unknown, sourceText: string = "") {
        const segments: unknown[] = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
        const reading = segments
            .map((segment: unknown) => (Array.isArray(segment) ? segment[3] : ""))
            .filter((value: unknown): value is string => typeof value === "string" && !!value.trim())
            .join("");
        return simplifyGoogleRomanization(reading, sourceText);
    }

    function simplifyGoogleRomanization(reading: string, sourceText: string = "") {
        let value = String(reading || "");
        if (typeof value.normalize === "function") {
            value = value.normalize("NFKD");
        }

        /* Google returns scholarly Latin transliteration for many Indic and
         * Arabic-family scripts (macrons, dots and modifier apostrophes).
         * Strip only presentation marks, retain the provider's word choices,
         * and normalize punctuation so the result is ordinary ASCII people
         * can read aloud without knowing a transliteration standard. */
        value = value
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[’‘`´]/g, "'")
            .replace(/[‐‑–—]/g, "-")
            .replace(/\s*'\s*/g, "'")
            .replace(/\s+/g, " ")
            .trim();

        /* ISO-style Indic output uses c for the everyday ch sound. Apply that
         * convention only when the source itself is Indic, never to Chinese
         * Pinyin or another Latin-based reading. Gurmukhi contractions such
         * as ’ਚ are similarly written as ordinary 'ch. */
        if (/[\u0900-\u0d7f]/u.test(String(sourceText || ""))) {
            value = value.replace(/c/g, "ch");
            if (/[’']\s*ਚ/u.test(String(sourceText || ""))) {
                value = value.replace(/'cha\b/gi, "'ch");
            }
        }
        return value;
    }

    async function googleRomanizeLine(text: string) {
        const generation = lyricsPort.snapshot.generation;
        const current = () => !lifecycle.isDisposed && generation === lyricsPort.snapshot.generation;
        const source = String(text || "");
        for (let attempt = 0; attempt < GOOGLE_ROMANIZATION_MAX_RETRIES; attempt += 1) {
            if (!current()) throw new DOMException("Track changed", "AbortError");
            try {
                const payload = await googleFetchWithTimeout(googleRomanizationUrl(source));
                if (!current()) throw new DOMException("Track changed", "AbortError");
                const reading = parseGoogleRomanization(payload, source);
                if (reading && !hasNativeScriptCandidate(reading)) return reading;
                throw new Error("Google romanization response had no Latin reading");
            } catch (error) {
                if (!current() || attempt + 1 >= GOOGLE_ROMANIZATION_MAX_RETRIES) throw error;
                await waitForGoogleRetry(GOOGLE_ROMANIZATION_RETRY_DELAY_MS * 2 ** attempt);
            }
        }
        return source;
    }

    function cacheGoogleRomanization(source: string, romanized: string | undefined) {
        const nativeText = String(source == null ? "" : source);
        const remoteText = String(romanized == null ? "" : romanized).trim();
        if (!nativeText || !remoteText || remoteText === nativeText || hasNativeScriptCandidate(remoteText)) return false;

        if (state.googleRomanizationCache.has(nativeText)) {
            state.googleRomanizationCache.delete(nativeText);
        }
        state.googleRomanizationCache.set(nativeText, remoteText);
        while (state.googleRomanizationCache.size > GOOGLE_ROMANIZATION_CACHE_MAX_ENTRIES) {
            const oldest = state.googleRomanizationCache.keys().next();
            if (oldest.done) break;
            state.googleRomanizationCache.delete(oldest.value);
        }
        return true;
    }

    function romanizationCueFragments(lyric: LyricInput) {
        const profile = lyricTextProfile(lyric);
        const sourceText = profile.text;
        const rawCues = cueValue(lyric, "Cues", "cues");
        if (!sourceText || !Array.isArray(rawCues) || rawCues.length < 2) return [];

        const ranges = normalizedCueTextRanges(orderedCuesBySourcePosition(rawCues), profile.rawText.length);
        return ranges
            .map((range) =>
                sourceText
                    .slice(Math.max(0, range.startPosition - profile.positionOffset), Math.max(0, range.endPosition - profile.positionOffset))
                    .trim(),
            )
            .filter(
                (fragment) =>
                    fragment &&
                    fragment !== sourceText &&
                    hasNativeScriptCandidate(fragment) &&
                    fragment.length <= GOOGLE_ROMANIZATION_MAX_TEXT_CHARS,
            );
    }

    function requestGoogleRomanizationForLyrics() {
        const lyrics = lyricsPort.snapshot.lyrics;
        if (!lyrics || state.googleRomanizationRequest) return;

        const sourceLines: string[] = [];
        const seen = new Set();
        lyrics.forEach((lyric) => {
            const text = lyricTextProfile(lyric).text;
            if (
                text &&
                !seen.has(text) &&
                !state.googleRomanizationAttempted.has(text) &&
                hasNativeScriptCandidate(text) &&
                text.length <= GOOGLE_ROMANIZATION_MAX_TEXT_CHARS
            ) {
                seen.add(text);
                state.googleRomanizationAttempted.add(text);
                sourceLines.push(text);
            }
        });
        if (!sourceLines.length) return;

        /* ELRC cue positions describe source-script phrases.  A full Google
         * reading does not expose their target offsets, so obtain readings for
         * the actual timed phrases too.  These are used strictly as alignment
         * anchors; the displayed line remains Google's whole-line reading. */
        const fragmentSources: string[] = [];
        const seenFragments = new Set<string>();
        lyrics.forEach((lyric) =>
            romanizationCueFragments(lyric).forEach((fragment) => {
                if (!seenFragments.has(fragment) && !state.googleRomanizationFragmentCache.has(fragment)) {
                    seenFragments.add(fragment);
                    fragmentSources.push(fragment);
                }
            }),
        );

        const generation = lyricsPort.snapshot.generation;
        state.googleRomanizationState = "loading";
        state.googleRomanizationError = "";
        const results = new Array<string | undefined>(sourceLines.length);
        const fragmentResults = new Array<string | undefined>(fragmentSources.length);
        const jobs = sourceLines
            .map((text, index: number) => ({ text, index, fragment: false }))
            .concat(fragmentSources.map((text, index: number) => ({ text, index, fragment: true })));
        let nextJob = 0;
        const worker = async () => {
            while (nextJob < jobs.length && !lifecycle.isDisposed && generation === lyricsPort.snapshot.generation) {
                const job = jobs[nextJob];
                nextJob += 1;
                try {
                    const reading = await googleRomanizeLine(requireValue(job).text);
                    if (requireValue(job).fragment) fragmentResults[requireValue(job).index] = reading;
                    else results[requireValue(job).index] = reading;
                } catch {
                    if (requireValue(job).fragment) fragmentResults[requireValue(job).index] = requireValue(job).text;
                    else results[requireValue(job).index] = requireValue(job).text;
                }
            }
        };
        state.googleRomanizationRequest = Promise.all(Array.from({ length: Math.min(GOOGLE_ROMANIZATION_CONCURRENCY, jobs.length) }, worker))
            .then(() => ({ results, fragmentResults }))
            .then((payload) => {
                if (lifecycle.isDisposed || generation !== lyricsPort.snapshot.generation || lyrics !== lyricsPort.snapshot.lyrics) return;
                let applied = 0;
                sourceLines.forEach((source, index: number) => {
                    if (cacheGoogleRomanization(source, payload.results && payload.results[index])) applied += 1;
                });
                fragmentSources.forEach((source, index: number) => {
                    const reading = String((payload.fragmentResults && payload.fragmentResults[index]) || "").trim();
                    if (reading && reading !== source && !hasNativeScriptCandidate(reading)) {
                        state.googleRomanizationFragmentCache.set(source, reading);
                    }
                });
                state.googleRomanizationLineCount += applied;
                state.googleRomanizationState = applied ? "ready" : "fallback-native";
                if (applied) state.romanizationSource = "google-dt-rm";
                if (applied && state.romanizationMode === "romanized") {
                    /* Results arrive after the native view has rendered. A
                     * second decoration updates text in place without ever
                     * delaying or hiding the toggle. */
                    redecorateForRomanization();
                }
            })
            .catch((error: unknown) => {
                if (lifecycle.isDisposed || generation !== lyricsPort.snapshot.generation || lyrics !== lyricsPort.snapshot.lyrics) return;
                state.googleRomanizationState = "fallback-native";
                state.googleRomanizationError = String(error instanceof Error ? error.message : error);
                warn("Google romanization unavailable; leaving native text unchanged:", error instanceof Error ? error.message : error);
            })
            .finally(() => {
                if (generation === lyricsPort.snapshot.generation && lyrics === lyricsPort.snapshot.lyrics) {
                    state.googleRomanizationRequest = null;
                }
            });
    }

    function romanizedTextChunks(text: string) {
        const chunks = [];
        const expression = /\S+|\s+/gu;
        let match;

        while ((match = expression.exec(String(text || ""))) !== null) {
            chunks.push({
                start: match.index,
                end: match.index + match[0].length,
                whitespace: /^\s+$/u.test(match[0]),
            });
        }

        return chunks;
    }

    /*
     * Google returns a single Romanized string, not a word-alignment table.
     * The former floor/ceil mapping independently rounded each cue and made
     * adjacent cue spans overlap after expansion (for example a CJK glyph to
     * several Latin letters). The renderer treats overlaps as unsafe, which
     * looked like skipped or prematurely sweeping lyrics.
     *
     * Build one shared boundary map instead: every occurrence of the same
     * source boundary has exactly the same target boundary. When both lines
     * have the same whitespace structure, word and separator edges are hard
     * anchors; only characters inside a token are proportionally mapped.
     */
    function buildRomanizedBoundaryMap(sourceText: string, convertedLine: string, alignmentAnchors: { source: number; target: number }[] = []) {
        const source = String(sourceText || "");
        const target = String(convertedLine || "");
        const sourceLength = source.length;
        const targetLength = target.length;
        const boundaries = new Array<number>(sourceLength + 1).fill(0);
        const sourceChunks = romanizedTextChunks(source);
        const targetChunks = romanizedTextChunks(target);
        const hasMatchingStructure =
            sourceChunks.length === targetChunks.length &&
            sourceChunks.every((chunk, index: number) => chunk.whitespace === requireValue(targetChunks[index]).whitespace);

        const mapChunk = (sourceStart: number, sourceEnd: number, targetStart: number, targetEnd: number) => {
            const sourceWidth = sourceEnd - sourceStart;
            const targetWidth = targetEnd - targetStart;
            if (sourceWidth <= 0) return;

            for (let index = sourceStart; index <= sourceEnd; index += 1) {
                const ratio = (index - sourceStart) / sourceWidth;
                boundaries[index] = Math.max(targetStart, Math.min(targetEnd, Math.round(targetStart + ratio * targetWidth)));
            }
        };

        const anchors = [{ source: 0, target: 0 }]
            .concat(Array.isArray(alignmentAnchors) ? alignmentAnchors : [])
            .concat([{ source: sourceLength, target: targetLength }])
            .filter((anchor) => anchor && isFiniteNumber(anchor.source) && isFiniteNumber(anchor.target))
            .map((anchor) => ({
                source: Math.max(0, Math.min(sourceLength, Math.round(anchor.source))),
                target: Math.max(0, Math.min(targetLength, Math.round(anchor.target))),
            }))
            .sort((left, right) => left.source - right.source || left.target - right.target)
            .reduce<{ source: number; target: number }[]>((valid, anchor) => {
                const previous = valid[valid.length - 1];
                if (!previous || (anchor.source > previous.source && anchor.target >= previous.target)) {
                    valid.push(anchor);
                }
                return valid;
            }, []);

        if (anchors.length > 2) {
            for (let index = 1; index < anchors.length; index += 1) {
                mapChunk(
                    requireValue(anchors[index - 1]).source,
                    requireValue(anchors[index]).source,
                    requireValue(anchors[index - 1]).target,
                    requireValue(anchors[index]).target,
                );
            }
        } else if (hasMatchingStructure && sourceChunks.length) {
            sourceChunks.forEach((chunk, index: number) => {
                const targetChunk = targetChunks[index];
                mapChunk(chunk.start, chunk.end, requireValue(targetChunk).start, requireValue(targetChunk).end);
            });
        } else {
            mapChunk(0, sourceLength, 0, targetLength);
        }

        /* A malformed string must never yield backward ELRC positions. */
        boundaries[0] = 0;
        for (let index = 1; index <= sourceLength; index += 1) {
            boundaries[index] = Math.max(requireValue(boundaries[index - 1]), requireValue(boundaries[index]));
        }
        boundaries[sourceLength] = targetLength;

        return boundaries;
    }

    function romanizedBoundary(boundaries: number[], sourceIndex: number) {
        const map = Array.isArray(boundaries) ? boundaries : [0];
        const index = Math.max(0, Math.min(map.length - 1, Number(sourceIndex) || 0));
        return map[index] || 0;
    }

    function googleRomanizedCueAnchors(sourceText: string, convertedLine: string, ranges: CueRange[], positionOffset: number) {
        const source = String(sourceText || "");
        const target = String(convertedLine || "");
        const targetFolded = target.toLocaleLowerCase();
        const anchors: { source: number; target: number }[] = [];
        let cursor = 0;

        (ranges || []).forEach((range) => {
            const start = Math.max(0, range.startPosition - positionOffset);
            const end = Math.max(start, Math.min(source.length, range.endPosition - positionOffset));
            const rawFragment = source.slice(start, end);
            const fragment = rawFragment.trim();
            const reading = state.googleRomanizationFragmentCache.get(fragment);
            if (!fragment || !reading) return;

            const targetStart = targetFolded.indexOf(String(reading).toLocaleLowerCase(), cursor);
            if (targetStart < cursor) return;

            let targetEnd = targetStart + reading.length;
            /* ELRC phrase spans commonly include their following source
             * space. Attach the generated Latin separator to that same cue so
             * its next cue begins at one exact shared boundary. */
            if (/\s$/u.test(rawFragment)) {
                while (targetEnd < target.length && /\s/u.test(target.charAt(targetEnd))) {
                    targetEnd += 1;
                }
            }

            anchors.push({ source: start, target: targetStart });
            anchors.push({ source: end, target: targetEnd });
            cursor = targetEnd;
        });

        return anchors;
    }

    function cloneCueWithPositions(cue: CueInput, position: number, endPosition: number) {
        const clone = Object.assign({}, cue || {});
        clone.Position = position;
        clone.position = position;
        clone.EndPosition = endPosition;
        clone.endPosition = endPosition;
        return clone;
    }

    function cloneLyricWithDisplay(lyric: LyricInput, text: string, cues: CueInput[]) {
        const clone = Object.assign({}, lyric || {});
        clone.Text = text;
        clone.text = text;
        if (Array.isArray(cues)) {
            clone.Cues = cues;
            clone.cues = cues;
        }
        return clone;
    }

    function romanizedLyricView(lyric: LyricInput) {
        if (!lyric) return lyric;

        const profile = lyricTextProfile(lyric);
        const marker = profile.positionOffset > 0 ? profile.rawText.slice(0, profile.positionOffset) : "";
        const sourceText = profile.text;
        const convertedLine = state.googleRomanizationCache.get(sourceText);
        if (!convertedLine) return lyric;
        return romanizedLyricViewFromConvertedLine(lyric, profile, marker, sourceText, convertedLine);
    }

    function romanizedLyricViewFromConvertedLine(
        lyric: LyricInput,
        profile: ReturnType<typeof lyricTextProfile>,
        marker: string,
        sourceText: string,
        convertedLine: string,
    ) {
        if (!convertedLine || convertedLine === sourceText) return lyric;

        const rawCues = cueValue(lyric, "Cues", "cues");
        if (!Array.isArray(rawCues) || !rawCues.length) {
            state.romanizationLineCount += 1;
            return cloneLyricWithDisplay(lyric, marker + convertedLine, []);
        }

        const sorted = orderedCuesBySourcePosition(rawCues);
        const ranges = normalizedCueTextRanges(sorted, profile.rawText.length);
        const boundaryMap = buildRomanizedBoundaryMap(
            sourceText,
            convertedLine,
            googleRomanizedCueAnchors(sourceText, convertedLine, ranges, profile.positionOffset),
        );
        const rangeByCueIndex = new Map(ranges.map((range) => [range.cueIndex, range]));

        const convertedCues = sorted.map((cue, cueIndex) => {
            let start = finiteTick(cueValue(cue, "Position", "position"));
            let end = finiteTick(cueValue(cue, "EndPosition", "endPosition"));
            if (start === null) return Object.assign({}, cue);
            const range = rangeByCueIndex.get(cueIndex);
            if (range) {
                start = range.startPosition;
                end = range.endPosition;
            } else if (end === null) {
                end = start;
            }
            start = Math.max(profile.positionOffset, Math.min(profile.rawText.length, start));
            end = Math.max(start, Math.min(profile.rawText.length, end));

            const sourceStart = Math.max(0, Math.min(sourceText.length, start - profile.positionOffset));
            const sourceEnd = Math.max(sourceStart, Math.min(sourceText.length, end - profile.positionOffset));

            const convertedCue = cloneCueWithPositions(
                cue,
                profile.positionOffset + romanizedBoundary(boundaryMap, sourceStart),
                profile.positionOffset + romanizedBoundary(boundaryMap, sourceEnd),
            );
            /* Runtime-only marker: the renderer must keep this ELRC phrase as
             * one visual token even though Google has made it Latin text. */
            convertedCue.__akRomanizedPhraseCue = true;
            return convertedCue;
        });

        state.romanizationLineCount += 1;
        return cloneLyricWithDisplay(lyric, marker + convertedLine, convertedCues);
    }

    function displayLyricForCurrentMode(lyric: LyricInput) {
        if (state.romanizationMode === "romanized" && state.romanizationAvailable) {
            return romanizedLyricView(lyric);
        }
        return lyric;
    }

    return {
        snapshot,
        setRomanizationLineCount(value: number): void {
            state.romanizationLineCount = value;
        },
        setRomanizationMode(value: string): void {
            state.romanizationMode = value;
        },
        clearGoogleRomanizationCache(): void {
            state.googleRomanizationCache.clear();
        },
        clearGoogleRomanizationFragmentCache(): void {
            state.googleRomanizationFragmentCache.clear();
        },
        clearGoogleRomanizationAttempted(): void {
            state.googleRomanizationAttempted.clear();
        },
        setGoogleRomanizationRequest(value: Promise<void> | null): void {
            state.googleRomanizationRequest = value;
        },
        setGoogleRomanizationState(value: string): void {
            state.googleRomanizationState = value;
        },
        setGoogleRomanizationError(value: string): void {
            state.googleRomanizationError = value;
        },
        setGoogleRomanizationLineCount(value: number): void {
            state.googleRomanizationLineCount = value;
        },
        setRomanizationCandidate(value: boolean): void {
            state.romanizationCandidate = value;
        },
        setRomanizationAvailable(value: boolean): void {
            state.romanizationAvailable = value;
        },
        setRomanizationLoadState(value: string): void {
            state.romanizationLoadState = value;
        },
        setRomanizationSource(value: string): void {
            state.romanizationSource = value;
        },
        setRomanizationLoadError(value: string): void {
            state.romanizationLoadError = value;
        },

        cancelPronunciationRequests,
        hasNativeScriptCandidate,
        lyricsHaveNativeScript,
        googleRomanizationUrl,
        waitForGoogleRetry,
        googleFetchWithTimeout,
        parseGoogleRomanization,
        simplifyGoogleRomanization,
        googleRomanizeLine,
        cacheGoogleRomanization,
        romanizationCueFragments,
        requestGoogleRomanizationForLyrics,
        romanizedTextChunks,
        buildRomanizedBoundaryMap,
        romanizedBoundary,
        googleRomanizedCueAnchors,
        cloneCueWithPositions,
        cloneLyricWithDisplay,
        romanizedLyricView,
        romanizedLyricViewFromConvertedLine,
        displayLyricForCurrentMode,
    };
}
