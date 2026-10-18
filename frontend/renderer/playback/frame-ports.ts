/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";

export interface FrameSchedulerState {
    rafId: number;
    frameTimer: number;
    animationLoopRunning: boolean;
    animationLoopStarts: number;
    animationLoopStops: number;
    animationLoopErrors: number;
    animationLoopRecoveries: number;
    lastAnimationLoopError: string;
    lastMediaWarning: number;
    performanceFrameCount: number;
    performanceWindowStart: number;
    measuredFps: number;
    lastRenderedFrameAt: number;
    forceNextFrame: boolean;
    pausedSettleUntil: number;
    renderedFrameCount: number;
    skippedRafFrames: number;
    lineTransitionCount: number;
    lastLineSyncCount: number;
    maxLineSyncCount: number;
}

export interface FrameSchedulerStatePort {
    readonly snapshot: ReadView<FrameSchedulerState>;
    setForceNextFrame(value: boolean): void;
    setLineTransitionCount(value: number): void;
    setLastLineSyncCount(value: number): void;
    setMaxLineSyncCount(value: number): void;
    setLastRenderedFrameAt(value: number): void;
}
