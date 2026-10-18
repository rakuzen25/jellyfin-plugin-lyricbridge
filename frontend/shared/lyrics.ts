import type { LyricLine, NativeLine, NativePayload, RichLyrics } from "../contracts/lyrics.ts";
/** Current rich-lyric and Jellyfin transport contracts. Positions are UTF-16 offsets. */

export function rows(document: RichLyrics | null | undefined): NativeLine[] {
    if (!document) return [];
    const result: NativeLine[] = [];
    function append(line: LyricLine, background = false): void {
        const marker = background ? "[ak:bg]" : "";
        result.push({
            Text: marker + line.text,
            Start: line.start,
            End: line.end,
            Cues: (line.cues ?? []).map((cue) => ({
                Position: cue.position + marker.length,
                EndPosition: cue.endPosition + marker.length,
                Start: cue.start,
                End: cue.end,
            })),
            LyricBridgeId: line.id,
        });
        if (line.background) append(line.background, true);
    }
    document.lines.forEach((line) => append(line));
    return result.sort((left, right) => (left.Start ?? Infinity) - (right.Start ?? Infinity));
}
export function nativePayload(document: RichLyrics | null | undefined): NativePayload {
    return {
        Metadata: { Title: document?.title, Artist: document?.artist },
        Lyrics: rows(document),
    };
}
