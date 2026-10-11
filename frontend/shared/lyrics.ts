/** Current rich-lyric and Jellyfin transport contracts. Positions are UTF-16 offsets. */
export interface Cue {
    position: number;
    endPosition: number;
    start: number;
    end?: number | null;
}
export interface LyricLine {
    id: string;
    text: string;
    start?: number | null;
    end?: number | null;
    cues?: Cue[];
    language?: string;
    translations?: Record<string, string>;
    pronunciation?: string | null;
    background?: LyricLine | null;
}
export interface RichLyrics {
    hash: string;
    source?: string;
    providerId?: string;
    language?: string;
    wordTimed?: boolean;
    manual?: boolean;
    title?: string;
    artist?: string;
    lines: LyricLine[];
}
interface NativeCue {
    Position: number;
    EndPosition: number;
    Start: number;
    End?: number | null;
}
export interface NativeLine {
    Text: string;
    Start?: number | null;
    End?: number | null;
    Cues: NativeCue[];
    LyricBridgeId: string;
}
export interface NativePayload {
    Metadata: { Title?: string; Artist?: string };
    Lyrics: NativeLine[];
}
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
