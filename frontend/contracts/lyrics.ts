interface NativeCue {
    Position: number;
    EndPosition: number;
    Start: number;
    End?: number | null;
}
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
