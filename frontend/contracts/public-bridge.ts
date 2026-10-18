import type { BridgeDocument } from "./bridge.ts";
import type { LyricLine, NativeLine, NativePayload, RichLyrics } from "./lyrics.ts";
import type { AuxiliaryKind, Preferences } from "./preferences.ts";
export interface BridgePort {
    dispose(): void;
    lifecycleDiagnostics(): Readonly<{
        disposed: boolean;
        cleanups: number;
        frames: number;
        timers: number;
        intervals: number;
    }>;
    readonly current: BridgeDocument | null;
    decorate(
        elements: HTMLElement[],
        payloads?: readonly {
            LyricBridgeId?: string;
            lyricBridgeId?: string;
        }[],
        doc?: BridgeDocument | null,
    ): boolean | undefined;
    mountTimingBar(bar: HTMLElement | null): void;
    rows(document: RichLyrics | null | undefined): NativeLine[];
    auxiliary(
        line: LyricLine,
        kind: AuxiliaryKind,
        preferences: Preferences,
        document?: BridgeDocument | null,
    ): { text: string; provenance: string; key: string } | null;
    refreshRows(): void;
    refreshSong(force?: boolean): Promise<void>;
    sourceUsage(doc: BridgeDocument | null): Map<string, string[]>;
    rendererSnapshot(): { itemId?: string; payload: NativePayload } | null;
    readonly metrics: Record<string, number>;
}
