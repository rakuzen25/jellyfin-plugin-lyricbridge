/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. Derived from the maintained LyricMotion fork. */
import type { CueInput, CueRange } from "./cue-ranges.ts";
import { normalizedCueTextRanges, orderedCuesBySourcePosition } from "./cue-ranges.ts";
import { finiteTick } from "./ticks.ts";
/** Jellyfin native transport accepts both serializer casing conventions. */
export interface LyricInput {
    [key: string]: unknown;
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function cueValue(cue: unknown, pascal: string, camel: string): unknown {
    if (!record(cue)) return undefined;
    return cue[pascal] !== undefined ? cue[pascal] : cue[camel];
}
function lyricCues(lyric: LyricInput): CueInput[] {
    const cues = cueValue(lyric, "Cues", "cues");
    return Array.isArray(cues) ? cues.filter(record) : [];
}
export function normalizeLyricsPayload(payload: unknown): LyricInput[] | null {
    if (!record(payload)) return null;
    const lyrics: unknown = payload.Lyrics ?? payload.lyrics;
    if (!Array.isArray(lyrics) || !lyrics.length) return null;
    // Reject malformed rows as one payload; dropping a row would shift DOM identities.
    if (!lyrics.every((line: unknown) => record(line) && typeof cueValue(line, "Text", "text") === "string")) return null;
    return lyrics.filter(record);
}
const AK_INLINE_TOKEN_PATTERN = /^\[ak:(bg|agent=([A-Za-z0-9._~%-]+)|group=([A-Za-z0-9._~%-]+)|section=([A-Za-z0-9._~%-]+))\]/;
/*
 * Jellyfin can return a lyric array for plain text too. Those entries often
 * have every Start field defaulted to zero, which used to make every row
 * look simultaneously current and caused LyricMotion to replace otherwise
 * healthy native lyrics. Require an observable timeline before taking DOM
 * ownership: a real line timestamp, an explicit duration, or a cue whose
 * timing advances beyond zero.
 */
export function lyricTimingMode(lyrics: LyricInput[] | null) {
    if (!Array.isArray(lyrics) || !lyrics.length) return "plain";

    const lineStarts = new Set<number>();
    let hasExplicitDuration = false;
    let hasAdvancingCueTiming = false;

    lyrics.forEach((lyric) => {
        const start = finiteTick(cueValue(lyric, "Start", "start"));
        const end = finiteTick(cueValue(lyric, "End", "end"));

        if (start !== null) lineStarts.add(start);
        if (end !== null && (start === null || end > start)) {
            hasExplicitDuration = true;
        }

        if (hasUsableWordTiming(lyric)) {
            hasAdvancingCueTiming = true;
        }
    });

    if (hasAdvancingCueTiming) return "enhanced";
    if (hasExplicitDuration || lineStarts.size > 1 || Array.from(lineStarts).some((start) => start > 0)) {
        return "line";
    }

    return "plain";
}

export function usableEnhancedCueCount(lyrics: LyricInput[]) {
    if (lyricTimingMode(lyrics) !== "enhanced") return 0;

    return lyrics.reduce((total, lyric) => {
        return total + usableWordCueRanges(lyric).length;
    }, 0);
}

export function usableWordCueRanges(lyric: LyricInput, orderedCues: CueInput[] | null = null) {
    const profile = lyricTextProfile(lyric);
    const rawCues = orderedCues || orderedCuesBySourcePosition(lyricCues(lyric));

    const candidates = normalizedCueTextRanges(rawCues, profile.rawText.length).filter((range) => {
        const start = Math.max(0, range.startPosition - profile.positionOffset);
        const end = Math.max(start, range.endPosition - profile.positionOffset);
        const cueStart = finiteTick(cueValue(range.cue, "Start", "start"));
        return cueStart !== null && end > start && /\S/u.test(profile.text.slice(start, end));
    });

    /*
     * Some providers repeat a whole-line cue for each timestamp. Those
     * records look populated but their nested text spans make every word
     * inherit the line duration. Retain only source ranges that move
     * forward through displayed text; falling back to line timing is safer
     * than a false full-line karaoke sweep.
     */
    const advancing: CueRange[] = [];
    let previousEnd = -1;

    candidates.forEach((range) => {
        const start = Math.max(0, range.startPosition - profile.positionOffset);
        const end = Math.max(start, range.endPosition - profile.positionOffset);

        if (start < previousEnd) return;

        advancing.push(range);
        previousEnd = end;
    });

    return advancing;
}

function hasTrustedSingleWordCueSweep({
    text,
    cue,
    cueIndex,
    cues,
    lineEnd,
}: {
    text: string;
    cue: CueInput;
    cueIndex: number;
    cues: CueInput[];
    lineEnd: unknown;
}) {
    /*
     * A sustained one-word lyric is valid ELRC: Jellyfin exposes one
     * visible cue for the word and either an explicit end, the converter's
     * following empty terminal cue, or a line end. Do not apply this to a
     * complete sentence wrapped in one timed span, which would turn an
     * ordinary line-synchronised row into one false karaoke word.
     */
    if (!text || /\s/u.test(text)) return false;

    const start = finiteTick(cueValue(cue, "Start", "start"));
    if (start === null) return false;

    const explicitEnd = finiteTick(cueValue(cue, "End", "end"));
    if (explicitEnd !== null && explicitEnd > start) return true;

    const cueList = Array.isArray(cues) ? cues : [];
    for (let index = cueIndex + 1; index < cueList.length; index += 1) {
        const followingStart = finiteTick(cueValue(cueList[index], "Start", "start"));
        if (followingStart !== null && followingStart > start) return true;
    }

    const explicitLineEnd = finiteTick(lineEnd);
    return explicitLineEnd !== null && explicitLineEnd > start;
}

export function hasUsableWordTiming(lyric: LyricInput, orderedCues: CueInput[] | null = null) {
    const ranges = usableWordCueRanges(lyric, orderedCues);
    if (ranges.length >= 2) {
        const starts = new Set(ranges.map((range) => finiteTick(cueValue(range.cue, "Start", "start"))));
        return starts.size >= 2;
    }
    if (ranges.length !== 1) return false;

    const profile = lyricTextProfile(lyric);
    const range = ranges[0];
    if (!range) return false;
    const start = Math.max(0, range.startPosition - profile.positionOffset);
    const end = Math.max(start, range.endPosition - profile.positionOffset);
    return hasTrustedSingleWordCueSweep({
        text: profile.text.slice(start, end),
        cue: range.cue,
        cueIndex: range.cueIndex,
        cues: orderedCues || orderedCuesBySourcePosition(lyricCues(lyric)),
        lineEnd: cueValue(lyric, "End", "end"),
    });
}

export function lyricTextProfile(lyric: LyricInput) {
    const rawText = String(cueValue(lyric, "Text", "text") || "");

    let markerLength = 0;
    let roleSource: string | null = null;
    let vocalAgent: string | null = null;
    let vocalKind: string | null = null;
    let songSection: string | null = null;

    const decodeTransportValue = (value: string) => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    };

    /* The converter places every LyricMotion token immediately after the
     * LRC timestamp and before the first ELRC cue. Strip the complete
     * prefix as one unit so Jellyfin's cue character offsets stay exact. */
    const leadingWhitespace = rawText.match(/^\s*/);
    let transportCursor = leadingWhitespace ? leadingWhitespace[0].length : 0;
    let transportMatched = false;

    while (true) {
        const tokenMatch = rawText.slice(transportCursor).match(AK_INLINE_TOKEN_PATTERN);
        if (!tokenMatch) break;

        transportMatched = true;
        transportCursor += tokenMatch[0].length;

        if (tokenMatch[1] === "bg") {
            roleSource = "ascii-marker";
        } else if (tokenMatch[2]) {
            vocalAgent = decodeTransportValue(tokenMatch[2]);
            vocalKind = "person";
        } else if (tokenMatch[3]) {
            vocalAgent = decodeTransportValue(tokenMatch[3]);
            vocalKind = "group";
        } else if (tokenMatch[4]) {
            songSection = decodeTransportValue(tokenMatch[4]);
        }
    }

    if (roleSource === "ascii-marker" && rawText.charAt(transportCursor) === "\\" && /[（(]/u.test(rawText.charAt(transportCursor + 1))) {
        transportCursor += 1;
    }

    if (transportMatched) {
        markerLength = transportCursor;
    }

    /* Providers can prepend whitespace/BOM characters to a lyric line,
     * and some ELRC/LRC transport paths escape the opening parenthesis as
     * `\(`. Match the complete transport prefix instead of requiring the
     * token to be byte zero. Nothing in this prefix is sung text, so cue
     * positions are shifted by the same number of removed characters. */
    const asciiMarkerMatch = transportMatched ? null : rawText.match(/^\s*\[ak:bg\](?:\\(?=[(（]))?/);
    if (asciiMarkerMatch) {
        markerLength = asciiMarkerMatch[0].length;
        roleSource = "ascii-marker";
    } else {
        const trimmed = rawText.trim();

        /* Recovery path for providers/libraries that preserve the lyric but
         * lose its x-bg role. Keep this deliberately narrow so ordinary
         * parenthetical punctuation inside a lead line is not reclassified:
         * only a complete, short parenthetical response becomes backing
         * vocal content. This restores the behavior used before 3.2.x. */
        const firstCharacter = trimmed.charAt(0);
        const lastCharacter = trimmed.charAt(trimmed.length - 1);
        const completeParenthetical =
            (firstCharacter === "(" && lastCharacter === ")") ||
            (firstCharacter === "（" && lastCharacter === "）") ||
            (trimmed.indexOf("\\(") === 0 && lastCharacter === ")") ||
            (trimmed.indexOf("\\（") === 0 && lastCharacter === "）");

        if (trimmed.length >= 3 && trimmed.length <= 64 && completeParenthetical) {
            roleSource = "parenthetical-fallback";
        }
    }

    const isBackgroundVocal = !!roleSource;

    return {
        rawText,
        text: markerLength > 0 ? rawText.slice(markerLength) : rawText,
        positionOffset: markerLength,
        isBackgroundVocal,
        backgroundVocalRoleSource: roleSource,
        vocalAgent,
        vocalKind,
        songSection,
    };
}

/** Identity of the native original timeline; rich auxiliary rows are bridge-owned. */
export function lyricPayloadIdentity(lyrics: readonly LyricInput[]): string {
    return JSON.stringify(
        lyrics.map((line) => [
            cueValue(line, "LyricBridgeId", "lyricBridgeId"),
            cueValue(line, "Text", "text"),
            cueValue(line, "Start", "start"),
            cueValue(line, "End", "end"),
            lyricCues(line).map((cue) => [
                cueValue(cue, "Position", "position"),
                cueValue(cue, "EndPosition", "endPosition"),
                cueValue(cue, "Start", "start"),
                cueValue(cue, "End", "end"),
            ]),
        ]),
    );
}
