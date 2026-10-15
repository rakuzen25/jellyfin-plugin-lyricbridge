/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. Derived from the maintained LyricMotion fork. */
import { finiteTick } from "./ticks.ts";
export interface CueInput {
    [key: string]: unknown;
}
export interface CueRange {
    cue: CueInput;
    cueIndex: number;
    startPosition: number;
    endPosition: number;
}
function cueValue(cue: CueInput, pascal: string, camel: string): unknown {
    return cue[pascal] !== undefined ? cue[pascal] : cue[camel];
}
export function orderedCuesBySourcePosition(cues: CueInput[] | null | undefined): CueInput[] {
    const source = Array.isArray(cues) ? cues : [];
    if (source.length < 2) return source.slice();

    /*
     * Source positions are optional provider data. Sort only when every
     * cue supplies a finite position. Treating null as Number(null) === 0
     * can incorrectly drag an unknown cue to the front of the line and
     * corrupt both word spans and Romanized source-boundary mapping.
     * When positions are incomplete, provider array order is the only
     * stable ordering evidence we actually have.
     */
    const positions = source.map((cue) => finiteTick(cueValue(cue, "Position", "position")));

    if (positions.some((position) => position === null)) {
        return source.slice();
    }

    return source
        .map((cue, index) => ({ cue, index, position: positions[index]! }))
        .sort((left, right) => left.position! - right.position! || left.index - right.index)
        .map((entry) => entry.cue);
}

export function normalizedCueTextRanges(cues: CueInput[] | null | undefined, rawTextLength: number): CueRange[] {
    const source = Array.isArray(cues) ? cues : [];
    const textLength = Math.max(0, Number(rawTextLength) || 0);
    if (!source.length || !textLength) return [];

    const positions = source.map((cue) => finiteTick(cueValue(cue, "Position", "position")));

    /* Without source positions there is no reliable way to identify the
     * timed text. Rendering it as word karaoke creates transparent or
     * misaligned spans, so leave that row line-synchronised instead. */
    if (positions.some((position) => position === null)) return [];

    return source.reduce<CueRange[]>((ranges, cue, cueIndex) => {
        const rawStart = Math.max(0, Math.min(textLength, positions[cueIndex]!));
        const explicitEnd = finiteTick(cueValue(cue, "EndPosition", "endPosition"));
        let rawEnd = explicitEnd === null ? rawStart : Math.max(0, Math.min(textLength, explicitEnd));

        if (rawEnd <= rawStart) {
            const immediatelyFollowingCue = source[cueIndex + 1];
            const immediatelyFollowingPosition = immediatelyFollowingCue ? positions[cueIndex + 1] : null;

            /*
             * The converter represents a non-default word end as an
             * empty ELRC timestamp at the word boundary. When it shares
             * a position with the next visible cue there is deliberately
             * no text for this cue. Do not extend it across the following
             * word: cueEndTicks() uses its timestamp as the prior word's
             * endpoint and this empty record is omitted from painting.
             */
            if (immediatelyFollowingPosition === rawStart) {
                return ranges;
            }

            rawEnd = textLength;
            for (let nextIndex = cueIndex + 1; nextIndex < positions.length; nextIndex++) {
                const nextPosition = positions[nextIndex]!;
                if (nextPosition !== null && nextPosition > rawStart) {
                    rawEnd = Math.min(textLength, nextPosition);
                    break;
                }
            }
        }

        if (rawEnd > rawStart) {
            ranges.push({
                cue,
                cueIndex,
                startPosition: rawStart,
                endPosition: rawEnd,
            });
        }
        return ranges;
    }, []);
}
