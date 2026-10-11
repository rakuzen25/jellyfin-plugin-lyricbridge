/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { CueInput } from "./cue-ranges.ts";
import type { GeometryWord } from "./geometry.ts";
import type { WordSegment } from "./karaoke-animation.ts";
import type { LyricInput } from "./payload.ts";
import type { InstrumentalGap } from "./timeline.ts";
export interface RenderWord extends GeometryWord {
    lineIndex: number;
    wordIndex: number;
    startPos: number;
    endPos: number;
    scriptProfile: string;
    paintMode: string;
    motionGlow: boolean;
    glyphCount?: number;
}
export interface CueRecord {
    cue: CueInput;
    startPos: number;
    endPos: number;
    start: number;
    end: number;
    sourceCueIndexes?: number[];
}
export interface RenderSegment extends WordSegment {
    cueIndex: number;
}
export interface RenderLine {
    element: HTMLElement;
    displayLyric: LyricInput;
    lineIndex: number;
    text: string;
    cues: CueRecord[];
    words: RenderWord[];
    startTicks: number;
    endTicks: number;
    trustedEndTicks: number | null;
    isBackgroundVocal: boolean;
    vocalAgent: string | null;
    vocalKind: string | null;
    songSection: string | null;
    ownedText: string;
    ownedNodes: Element[];
    backgroundVocalRoleSource?: string | null;
    vocalLane?: string | null;
    vocalTone?: string | number | null;
    backgroundPlacement?: string;
    backgroundAnchorIndex?: number;
    backgroundVocalAnchorLineIndex?: number | null;
    backgroundVocalAttachment?: string;
    _akBand?: string;
    _akPhase?: string;
    _akOverlapCurrent?: boolean;
}
export interface RenderGap extends InstrumentalGap {
    surfaceElement?: SVGElement;
    fillClipElement?: SVGElement;
    lastWavePhase?: number;
    lastWaveAmplitude?: number;
    visualPhase?: string;
    lastRenderTicks?: number;
    phase?: string;
}
export interface Accent {
    id: string;
    name: string;
    rgb: string;
    secondaryRgb: string;
    tertiaryRgb: string;
    gain: number;
}
export interface SongPreference {
    romanization: string;
    timingOffsetSeconds: number;
    timingFingerprint: string;
    updatedAt: number;
}
export interface ArtworkFingerprint {
    width: number;
    height: number;
    hash: string;
    rgb: Uint8Array;
    edges: Float32Array;
    mean: number[];
}
export interface ArtworkCandidate {
    url: string;
    score: number;
    node: HTMLElement | null;
    urlItemId: string;
    nodeBound: boolean;
    playbackContext: boolean;
    boundToCurrentItem: boolean;
    inheritedArtworkCandidate: boolean;
    conflictsCurrentItem: boolean;
}
