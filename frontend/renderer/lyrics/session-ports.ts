/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";
import type { RenderGap, RenderLine } from "./models.ts";
import type { LyricInput } from "./payload.ts";

export interface LyricSessionState {
    lyrics: LyricInput[] | null;
    generation: number;
    decoratedGeneration: number;
    lyricsRequestSeq: number;
    lyricsRequestKey: string;
    lyricsRequestKeys: Map<number, string>;
    lyricsAcceptedKey: string;
    lyricsAcceptedSeq: number;
    lyricsStaleResponseDrops: number;
    lineData: RenderLine[];
    animationWatchdogRecoveries: number;
    geometryTimer: number;
    backgroundAnchorTimer: number;
    decorationRetryStartedAt: number;
    decorationRetryCount: number;
    decorationRetryExpiredCount: number;
    lastActiveLine: number;
    lastActiveLineSignature: string;
    activeLineIndexes: number[];
    activeLineScratch: number[];
    handoffLineIndexes: Set<number>;
    retiredLineElements: HTMLElement[];
    lineEndPrefix: number[];
    instrumentalGaps: RenderGap[];
    activeInstrumentalGapIndex: number;
    instrumentalPhaseActiveIndex: number;
    instrumentalPastCount: number;
    instrumentalGapRenderCount: number;
    instrumentalGapMaxDurationTicks: number;
    timedCueCount: number;
    lyricTimingMode: string;
    backgroundVocalCount: number;
    overlapFrameCount: number;
    maxSimultaneousLines: number;
    shapedWordCount: number;
    scriptProfileCounts: Record<string, number>;
}

export interface LyricSessionStatePort {
    clearHandoffLineIndexes(): void;
    resetActiveLineScratch(): number[];
    readonly snapshot: ReadView<LyricSessionState>;
    setDecoratedGeneration(value: number): void;
    setAnimationWatchdogRecoveries(value: number): void;
    setLastActiveLine(value: number): void;
    setLastActiveLineSignature(value: string): void;
    setActiveLineIndexes(value: number[]): void;
    setGeometryTimer(value: number): void;
    setInstrumentalPastCount(value: number): void;
    setInstrumentalPhaseActiveIndex(value: number): void;
    setInstrumentalGaps(value: RenderGap[]): void;
    setActiveInstrumentalGapIndex(value: number): void;
    setInstrumentalGapMaxDurationTicks(value: number): void;
    setInstrumentalGapRenderCount(value: number): void;
    setRetiredLineElements(value: HTMLElement[]): void;
    setBackgroundAnchorTimer(value: number): void;
    setBackgroundVocalCount(value: number): void;
    setLineData(value: RenderLine[]): void;
    setLineEndPrefix(value: number[]): void;
    setShapedWordCount(value: number): void;
    setScriptProfileCounts(value: Record<string, number>): void;
    appendLineData(...values: RenderLine[]): number;
    setScriptProfileCountsEntry(key: string, value: number): void;
    setDecorationRetryStartedAt(value: number): void;
    setDecorationRetryCount(value: number): void;
    setDecorationRetryExpiredCount(value: number): void;
    setOverlapFrameCount(value: number): void;
    setMaxSimultaneousLines(value: number): void;
    addHandoffLineIndexes(value: number): void;
    removeHandoffLineIndexes(key: number): boolean;
    advanceGeneration(delta: number): number;
}
