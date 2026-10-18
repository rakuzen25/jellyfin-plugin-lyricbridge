/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";

export interface MediaState {
    mediaElement: HTMLMediaElement | null;
    mediaProbeAt: number;
    mediaSwitchCount: number;
    staleMediaEventDrops: number;
    playbackClockMedia: HTMLMediaElement | null;
    playbackClockSeconds: number;
    playbackClockRawSeconds: number;
    playbackClockFrameNow: number;
    playbackClockCorrectionMs: number;
    playbackClockHardSnaps: number;
    playbackClockSuspended: boolean;
    mediaStartOffsetSource: string;
    mediaStartOffsetTicks: number;
}

export interface MediaStatePort {
    readonly snapshot: ReadView<MediaState>;
}
