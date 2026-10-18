/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
/** Unicode shaping and cue tokenization. All boundaries use UTF-16 code units. */
export interface CodePointToken {
    text: string;
    start: number;
    end: number;
    codePoint: number;
}
export interface TextRange {
    start: number;
    end: number;
    text: string;
}
export interface TextCueRecord {
    startPos: number;
    endPos: number;
    cue?: { __akRomanizedPhraseCue?: boolean };
}
let unicodeMarkExpression: RegExp | null = null;
let latinGlyphExpression: RegExp | null = null;

try {
    unicodeMarkExpression = new RegExp("\\p{Mark}", "u");
} catch {
    // Older browsers use the explicit ranges below.
}

/*
 * Keep Unicode property escapes out of regex literals. Engines that do not
 * understand \p{} fail at parse time, before a surrounding try/catch can
 * run. Construct the optional expression dynamically instead.
 */
try {
    latinGlyphExpression = new RegExp("^[\\p{Script=Latin}\\p{Mark}\\p{Number}\\p{Punctuation}\\p{Symbol}]+$", "u");
} catch {
    latinGlyphExpression = null;
}

function codePointTokens(text: string) {
    const tokens = [];
    let offset = 0;

    for (const char of text) {
        tokens.push({
            text: char,
            start: offset,
            end: offset + char.length,
            codePoint: char.codePointAt(0)!,
        });

        offset += char.length;
    }

    return tokens;
}

const FALLBACK_MARK_RANGES: readonly (readonly [number, number])[] = Object.freeze([
    [0x0300, 0x036f],
    [0x0591, 0x05c7],
    [0x0610, 0x061a],
    [0x064b, 0x065f],
    [0x0670, 0x0670],
    [0x06d6, 0x06ed],
    [0x0900, 0x0903],
    [0x093a, 0x094f],
    [0x0951, 0x0957],
    [0x0962, 0x0963],
    [0x0981, 0x0983],
    [0x09bc, 0x09bc],
    [0x09be, 0x09c4],
    [0x09c7, 0x09c8],
    [0x09cb, 0x09cd],
    [0x09d7, 0x09d7],
    [0x09e2, 0x09e3],
    [0x09fe, 0x09fe],
    [0x0a01, 0x0a03],
    [0x0a3c, 0x0a3c],
    [0x0a3e, 0x0a4d],
    [0x0a51, 0x0a51],
    [0x0a70, 0x0a71],
    [0x0a75, 0x0a75],
    [0x0a81, 0x0a83],
    [0x0abc, 0x0abc],
    [0x0abe, 0x0ac5],
    [0x0ac7, 0x0ac9],
    [0x0acb, 0x0acd],
    [0x0ae2, 0x0ae3],
    [0x0b01, 0x0b03],
    [0x0b3c, 0x0b3c],
    [0x0b3e, 0x0b44],
    [0x0b47, 0x0b48],
    [0x0b4b, 0x0b4d],
    [0x0b55, 0x0b57],
    [0x0b62, 0x0b63],
    [0x0b82, 0x0b82],
    [0x0bbe, 0x0bc2],
    [0x0bc6, 0x0bc8],
    [0x0bca, 0x0bcd],
    [0x0bd7, 0x0bd7],
    [0x0c00, 0x0c04],
    [0x0c3c, 0x0c3c],
    [0x0c3e, 0x0c44],
    [0x0c46, 0x0c48],
    [0x0c4a, 0x0c4d],
    [0x0c55, 0x0c56],
    [0x0c62, 0x0c63],
    [0x0c81, 0x0c83],
    [0x0cbc, 0x0cbc],
    [0x0cbe, 0x0cc4],
    [0x0cc6, 0x0cc8],
    [0x0cca, 0x0ccd],
    [0x0cd5, 0x0cd6],
    [0x0ce2, 0x0ce3],
    [0x0d00, 0x0d03],
    [0x0d3b, 0x0d4d],
    [0x0d57, 0x0d57],
    [0x0d62, 0x0d63],
    [0x0d81, 0x0d83],
    [0x0dca, 0x0dca],
    [0x0dcf, 0x0dd4],
    [0x0dd6, 0x0dd6],
    [0x0dd8, 0x0ddf],
    [0x0df2, 0x0df3],
    [0x0e31, 0x0e31],
    [0x0e34, 0x0e3a],
    [0x0e47, 0x0e4e],
    [0x0eb1, 0x0eb1],
    [0x0eb4, 0x0ebc],
    [0x0ec8, 0x0ecd],
    [0x0f18, 0x0f19],
    [0x0f35, 0x0f35],
    [0x0f37, 0x0f37],
    [0x0f39, 0x0f39],
    [0x0f71, 0x0f84],
    [0x0f86, 0x0f87],
    [0x0f8d, 0x0fbc],
    [0x102b, 0x103e],
    [0x1056, 0x1059],
    [0x105e, 0x1060],
    [0x1062, 0x1064],
    [0x1067, 0x106d],
    [0x1071, 0x1074],
    [0x1082, 0x108d],
    [0x108f, 0x108f],
    [0x109a, 0x109d],
    [0x17b4, 0x17d3],
    [0x17dd, 0x17dd],
    [0x1ab0, 0x1aff],
    [0x1dc0, 0x1dff],
    [0x20d0, 0x20ff],
    [0xfe20, 0xfe2f],
]);

function isFallbackMarkCodePoint(codePoint: number) {
    return codePointInRanges(codePoint, FALLBACK_MARK_RANGES);
}

function isMarkToken(token: CodePointToken | undefined) {
    if (!token) return false;

    if (unicodeMarkExpression && unicodeMarkExpression.test(token.text)) {
        return true;
    }

    return isFallbackMarkCodePoint(token.codePoint);
}

function isVariationOrModifier(codePoint: number) {
    return (
        (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
        (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
        (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
        (codePoint >= 0xe0020 && codePoint <= 0xe007f)
    );
}

function isJoinControl(codePoint: number) {
    return codePoint === 0x200c || codePoint === 0x200d;
}

function isRegionalIndicator(codePoint: number) {
    return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function hangulGraphemeType(codePoint: number) {
    if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0xa960 && codePoint <= 0xa97c)) return "L";

    if ((codePoint >= 0x1160 && codePoint <= 0x11a7) || (codePoint >= 0xd7b0 && codePoint <= 0xd7c6)) return "V";

    if ((codePoint >= 0x11a8 && codePoint <= 0x11ff) || (codePoint >= 0xd7cb && codePoint <= 0xd7fb)) return "T";

    if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
        return (codePoint - 0xac00) % 28 === 0 ? "LV" : "LVT";
    }

    return "";
}

function hangulBoundaryJoins(leftCodePoint: number, rightCodePoint: number) {
    const left = hangulGraphemeType(leftCodePoint);
    const right = hangulGraphemeType(rightCodePoint);

    return (
        (left === "L" && (right === "L" || right === "V" || right === "LV" || right === "LVT")) ||
        ((left === "LV" || left === "V") && (right === "V" || right === "T")) ||
        ((left === "LVT" || left === "T") && right === "T")
    );
}

function regionalIndicatorBoundaryJoins(tokens: CodePointToken[], rightIndex: number) {
    if (rightIndex <= 0 || !isRegionalIndicator(tokens[rightIndex - 1]!.codePoint) || !isRegionalIndicator(tokens[rightIndex]!.codePoint)) {
        return false;
    }

    let precedingRunLength = 0;
    for (let index = rightIndex - 1; index >= 0; index -= 1) {
        if (!isRegionalIndicator(tokens[index]!.codePoint)) break;
        precedingRunLength += 1;
    }

    /* Unicode GB12/GB13: group regional indicators into pairs. */
    return precedingRunLength % 2 === 1;
}

const INDIC_VIRAMA_CODEPOINTS = new Set([
    0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0bcd, 0x0c4d, 0x0ccd, 0x0d4d, 0x0dca, 0x1039, 0x103a, 0x17d2, 0x1a60, 0x1b44, 0x1baa, 0x1bab, 0xa806,
    0xa8c4, 0xa953, 0xa9c0, 0xaaf6, 0xabed, 0x11046, 0x11133, 0x111c0, 0x11235, 0x1134d, 0x11442, 0x11446, 0x114c2, 0x115bf, 0x1163f, 0x116b6,
    0x1172b, 0x11839, 0x1193d, 0x1193e, 0x119e0, 0x11a34, 0x11a47, 0x11a99, 0x11c3f, 0x11d44, 0x11d45, 0x11d97, 0x11f42,
]);

function isIndicVirama(codePoint: number) {
    return INDIC_VIRAMA_CODEPOINTS.has(codePoint);
}

function boundarySplitsShaping(tokens: CodePointToken[], boundary: number) {
    let rightIndex = -1;

    for (let index = 0; index < tokens.length; index += 1) {
        if (tokens[index]!.start === boundary) {
            rightIndex = index;
            break;
        }
    }

    if (rightIndex <= 0) return false;

    const left = tokens[rightIndex - 1]!;
    const right = tokens[rightIndex]!;

    return (
        isMarkToken(right) ||
        isVariationOrModifier(right.codePoint) ||
        isJoinControl(right.codePoint) ||
        isIndicVirama(left.codePoint) ||
        isJoinControl(left.codePoint) ||
        regionalIndicatorBoundaryJoins(tokens, rightIndex) ||
        hangulBoundaryJoins(left.codePoint, right.codePoint)
    );
}

const graphemeBoundaryCache = new Map<string, number[]>();
let graphemeSegmenter: Intl.Segmenter | undefined;
export function getGraphemeBoundaries(text: string) {
    const cached = graphemeBoundaryCache.get(text);
    if (cached) return cached;
    const tokens = codePointTokens(text);
    let candidates = [0];

    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        try {
            const segmenter =
                graphemeSegmenter ||
                (graphemeSegmenter = new Intl.Segmenter(undefined, {
                    granularity: "grapheme",
                }));

            for (const segment of segmenter.segment(text)) {
                candidates.push(segment.index + segment.segment.length);
            }
        } catch {
            candidates = [0];
        }
    }

    if (candidates.length === 1) {
        candidates = [0].concat(tokens.map((token) => token.end));
    }

    const boundaries = [0];

    candidates.forEach((boundary) => {
        if (boundary <= 0 || boundary > text.length || boundarySplitsShaping(tokens, boundary)) {
            return;
        }

        if (boundaries[boundaries.length - 1] !== boundary) {
            boundaries.push(boundary);
        }
    });

    if (boundaries[boundaries.length - 1] !== text.length) {
        boundaries.push(text.length);
    }

    if (graphemeBoundaryCache.size >= 1024) graphemeBoundaryCache.delete(graphemeBoundaryCache.keys().next().value!);
    graphemeBoundaryCache.set(text, boundaries);
    return boundaries;
}

function codePointInRanges(codePoint: number, ranges: readonly (readonly [number, number])[]) {
    for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index]!;
        if (codePoint >= range[0] && codePoint <= range[1]) {
            return true;
        }
    }
    return false;
}

function textHasCodePointInRanges(text: string, ranges: readonly (readonly [number, number])[]) {
    for (const character of String(text || "")) {
        if (codePointInRanges(character.codePointAt(0)!, ranges)) {
            return true;
        }
    }
    return false;
}

const RTL_STRONG_RANGES: readonly (readonly [number, number])[] = Object.freeze([
    [0x05d0, 0x05ea], // Hebrew letters
    [0x05ef, 0x05f2],
    [0x0620, 0x063f], // Arabic letters
    [0x0641, 0x064a],
    [0x066e, 0x066f],
    [0x0671, 0x06d3],
    [0x06d5, 0x06d5],
    [0x06e5, 0x06e6],
    [0x06ee, 0x06ef],
    [0x06fa, 0x06fc],
    [0x06ff, 0x06ff],
    [0x0710, 0x072f], // Syriac
    [0x074d, 0x077f], // Syriac supplement + Arabic supplement
    [0x0780, 0x07a5], // Thaana
    [0x07b1, 0x07b1],
    [0x07ca, 0x07ea], // NKo
    [0x0840, 0x0858], // Mandaic
    [0x0860, 0x086a], // Syriac supplement
    [0x0870, 0x0887], // Arabic Extended-B letters
    [0x08a0, 0x08c9], // Arabic Extended-A letters
    [0xfb1d, 0xfb4f], // Hebrew presentation forms
    [0xfb50, 0xfdff], // Arabic presentation forms A
    [0xfe70, 0xfefc], // Arabic presentation forms B
    [0x1e900, 0x1e943], // Adlam letters
]);

const COMPLEX_SHAPING_RANGES: readonly (readonly [number, number])[] = Object.freeze([
    [0x0600, 0x08ff], // Arabic-family joining scripts
    [0x0900, 0x0dff], // Indic + Sinhala
    [0x0e00, 0x0fff], // Thai, Lao, Tibetan
    [0x1000, 0x109f], // Myanmar
    [0x1780, 0x17ff], // Khmer
    [0x1800, 0x18af], // Mongolian
    [0xa980, 0xa9df], // Javanese + Myanmar Extended-B
    [0xaa60, 0xaa7f], // Myanmar Extended-A
    [0x11000, 0x11fff], // Brahmic supplementary blocks
    [0xfb1d, 0xfdff],
    [0xfe70, 0xfeff],
]);

const CJK_CODEPOINT_RANGES: readonly (readonly [number, number])[] = Object.freeze([
    [0x3040, 0x30ff], // Hiragana + Katakana
    [0x3100, 0x312f], // Bopomofo
    [0x31a0, 0x31bf],
    [0x3400, 0x4dbf], // CJK Extension A
    [0x4e00, 0x9fff], // Unified ideographs
    [0xac00, 0xd7af], // Hangul syllables
    [0xf900, 0xfaff], // Compatibility ideographs
    [0x20000, 0x323af], // Supplementary CJK extensions
]);

const CUE_TOKEN_SCRIPT_PROFILES: Readonly<Record<string, boolean>> = Object.freeze({
    cjk: true,
    thai: true,
    lao: true,
    khmer: true,
    myanmar: true,
});

export function firstStrongDirection(text: string) {
    for (const character of String(text || "")) {
        const codePoint = character.codePointAt(0)!;

        if (codePointInRanges(codePoint, RTL_STRONG_RANGES)) {
            return "rtl";
        }

        /*
         * Treat known letter/ideograph ranges as LTR base-direction
         * candidates. Digits and punctuation are deliberately neutral so
         * a leading timestamp/number does not flip an Arabic/Hebrew line.
         */
        if (
            (codePoint >= 0x0041 && codePoint <= 0x005a) ||
            (codePoint >= 0x0061 && codePoint <= 0x007a) ||
            (codePoint >= 0x00c0 && codePoint <= 0x02af) ||
            (codePoint >= 0x0370 && codePoint <= 0x058f) ||
            (codePoint >= 0x0900 && codePoint <= 0x1fff) ||
            codePointInRanges(codePoint, CJK_CODEPOINT_RANGES)
        ) {
            return "ltr";
        }
    }

    return "ltr";
}

export function detectScriptProfile(text: string) {
    const value = String(text || "");

    if (
        textHasCodePointInRanges(value, [
            [0x0600, 0x06ff],
            [0x0750, 0x077f],
            [0x08a0, 0x08ff],
            [0xfb50, 0xfdff],
            [0xfe70, 0xfeff],
        ])
    )
        return "arabic";
    if (
        textHasCodePointInRanges(value, [
            [0x0590, 0x05ff],
            [0xfb1d, 0xfb4f],
        ])
    )
        return "hebrew";
    if (
        textHasCodePointInRanges(value, [
            [0x0900, 0x097f],
            [0xa8e0, 0xa8ff],
        ])
    )
        return "devanagari";
    if (textHasCodePointInRanges(value, [[0x0980, 0x09ff]])) return "bengali";
    if (textHasCodePointInRanges(value, [[0x0a00, 0x0a7f]])) return "gurmukhi";
    if (textHasCodePointInRanges(value, [[0x0a80, 0x0aff]])) return "gujarati";
    if (textHasCodePointInRanges(value, [[0x0b00, 0x0b7f]])) return "odia";
    if (textHasCodePointInRanges(value, [[0x0b80, 0x0bff]])) return "tamil";
    if (textHasCodePointInRanges(value, [[0x0c00, 0x0c7f]])) return "telugu";
    if (textHasCodePointInRanges(value, [[0x0c80, 0x0cff]])) return "kannada";
    if (textHasCodePointInRanges(value, [[0x0d00, 0x0d7f]])) return "malayalam";
    if (textHasCodePointInRanges(value, [[0x0d80, 0x0dff]])) return "sinhala";
    if (textHasCodePointInRanges(value, [[0x0e00, 0x0e7f]])) return "thai";
    if (textHasCodePointInRanges(value, [[0x0e80, 0x0eff]])) return "lao";
    if (
        textHasCodePointInRanges(value, [
            [0x1000, 0x109f],
            [0xa9e0, 0xa9ff],
            [0xaa60, 0xaa7f],
        ])
    )
        return "myanmar";
    if (textHasCodePointInRanges(value, [[0x1780, 0x17ff]])) return "khmer";
    if (textHasCodePointInRanges(value, [[0x0f00, 0x0fff]])) return "tibetan";
    if (textHasCodePointInRanges(value, CJK_CODEPOINT_RANGES)) return "cjk";
    if (textHasCodePointInRanges(value, [[0x0400, 0x052f]])) return "cyrillic";
    if (
        textHasCodePointInRanges(value, [
            [0x0370, 0x03ff],
            [0x1f00, 0x1fff],
        ])
    )
        return "greek";
    if (textHasCodePointInRanges(value, [[0x0530, 0x058f]])) return "armenian";
    if (
        textHasCodePointInRanges(value, [
            [0x10a0, 0x10ff],
            [0x2d00, 0x2d2f],
        ])
    )
        return "georgian";

    if (value.indexOf("\u200c") >= 0 || value.indexOf("\u200d") >= 0 || textHasCodePointInRanges(value, COMPLEX_SHAPING_RANGES)) {
        return "complex";
    }

    if (latinGlyphExpression) {
        try {
            if (latinGlyphExpression.test(value.replace(/\s+/g, ""))) {
                return "latin";
            }
        } catch {
            // Conservative generic fallback below.
        }
    }

    // eslint-disable-next-line no-control-regex -- Keep the established Latin fallback classification.
    if (/^[\x00-\x7f]*$/.test(value) || looksLikeLatinFallback(value.replace(/\s+/g, ""))) {
        return "latin";
    }

    /* Unknown scripts stay whole-shaped, but still receive full effects. */
    return "universal";
}

export function usesWholeShapedMotion(profile: string) {
    return (
        [
            "arabic",
            "hebrew",
            "devanagari",
            "bengali",
            "gurmukhi",
            "gujarati",
            "odia",
            "tamil",
            "telugu",
            "kannada",
            "malayalam",
            "sinhala",
            "thai",
            "lao",
            "myanmar",
            "khmer",
            "tibetan",
            "complex",
            "universal",
        ].indexOf(profile) >= 0
    );
}

function usesCueTokenization(profile: string) {
    return !!CUE_TOKEN_SCRIPT_PROFILES[profile];
}

const LATIN_LETTER_FALLBACK_RANGES: readonly (readonly [number, number])[] = Object.freeze([
    [0x0041, 0x005a],
    [0x0061, 0x007a],
    [0x00c0, 0x024f],
    [0x1d00, 0x1d7f],
    [0x1d80, 0x1dbf],
    [0x1e00, 0x1eff],
    [0x2c60, 0x2c7f],
    [0xa720, 0xa7ff],
    [0xab30, 0xab6f],
    [0x10780, 0x107bf],
]);

function looksLikeLatinFallback(text: string) {
    let hasLatinLetter = false;

    for (const character of String(text || "")) {
        const codePoint = character.codePointAt(0)!;

        if (codePointInRanges(codePoint, LATIN_LETTER_FALLBACK_RANGES)) {
            hasLatinLetter = true;
            continue;
        }

        if (
            isFallbackMarkCodePoint(codePoint) ||
            isVariationOrModifier(codePoint) ||
            (codePoint >= 0x0030 && codePoint <= 0x0039) ||
            (codePoint >= 0x0020 && codePoint <= 0x0040) ||
            (codePoint >= 0x005b && codePoint <= 0x0060) ||
            (codePoint >= 0x007b && codePoint <= 0x00bf) ||
            (codePoint >= 0x2000 && codePoint <= 0x2bff) ||
            (codePoint >= 0x1f000 && codePoint <= 0x1faff)
        ) {
            continue;
        }

        return false;
    }

    return hasLatinLetter;
}

export function snapBoundary(boundaries: number[], position: number, direction: "backward" | "forward") {
    if (boundaries.includes(position)) return position;

    if (direction === "backward") {
        for (let i = boundaries.length - 1; i >= 0; i -= 1) {
            if (boundaries[i]! < position) return boundaries[i]!;
        }
        return 0;
    }

    for (const boundary of boundaries) {
        if (boundary > position) return boundary;
    }

    return boundaries[boundaries.length - 1] ?? 0;
}

function cueDerivedTokenRanges(text: string, cueRecords: TextCueRecord[] | null) {
    const ranges: TextRange[] = [];

    (cueRecords || []).forEach((record) => {
        let start = Math.max(0, Math.min(text.length, Number(record.startPos) || 0));
        let end = Math.max(start, Math.min(text.length, Number(record.endPos) || 0));

        while (start < end && /\s/u.test(text.charAt(start))) start += 1;
        while (end > start && /\s/u.test(text.charAt(end - 1))) end -= 1;

        if (end <= start) return;

        const previous = ranges[ranges.length - 1];
        if (previous && start < previous.end) {
            previous.end = Math.max(previous.end, end);
            previous.text = text.slice(previous.start, previous.end);
            return;
        }

        ranges.push({
            start,
            end,
            text: text.slice(start, end),
        });
    });

    return ranges;
}

export function getWordRanges(text: string, cueRecords: TextCueRecord[] | null) {
    const profile = detectScriptProfile(text);
    const preservesRomanizedCuePhrases =
        Array.isArray(cueRecords) && cueRecords.some((record) => record && record.cue && record.cue.__akRomanizedPhraseCue === true);

    /*
     * CJK and several naturally space-less scripts must not have word
     * boundaries invented by LyricMotion. If ELRC/Jellyfin supplies
     * multiple timing tokens, preserve those exact token spans. Google
     * Romanization retains those same source phrase cues: splitting their
     * Latin display text again would make several unrelated words sweep
     * and glow at one shared timestamp.
     */
    if ((usesCueTokenization(profile) || preservesRomanizedCuePhrases) && Array.isArray(cueRecords) && cueRecords.length > 1) {
        const cueRanges = cueDerivedTokenRanges(text, cueRecords);
        if (cueRanges.length > 1) return cueRanges;
    }

    const ranges: TextRange[] = [];
    const regex = /\S+/gu;
    let match;

    while ((match = regex.exec(text)) !== null) {
        ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
        });
    }

    return ranges;
}

export function getGraphemeRanges(text: string) {
    const ranges: TextRange[] = [];

    const boundaries = getGraphemeBoundaries(text);

    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const start = boundaries[index]!;
        const end = boundaries[index + 1]!;

        ranges.push({
            start,
            end,
            text: text.slice(start, end),
        });
    }

    return ranges;
}
