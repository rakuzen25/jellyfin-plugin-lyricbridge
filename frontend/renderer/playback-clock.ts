/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. Derived from the maintained LyricMotion fork. */
export type ClockMedia = Pick<HTMLMediaElement, "currentTime" | "playbackRate" | "paused" | "seeking" | "ended" | "readyState">;
export interface PlaybackClockState {
    playbackClockMedia: ClockMedia | null;
    playbackClockSeconds: number;
    playbackClockRawSeconds: number;
    playbackClockFrameNow: number;
    playbackClockCorrectionMs: number;
    playbackClockSuspended: boolean;
    playbackClockHardSnaps: number;
}
const CLOCK_CORRECTION_GAIN = 0.22;
const CLOCK_HARD_SNAP_SECONDS = 0.42;
const CLOCK_MAX_CORRECTION_SECONDS = 0.012;
const CLOCK_MAX_DRIFT_SECONDS = 0.65;
export function resetClock(state: PlaybackClockState, media: ClockMedia | null = null, frameNow = performance.now()) {
    const raw = media ? Math.max(0, Number(media.currentTime) || 0) : 0;

    state.playbackClockMedia = media;
    state.playbackClockSeconds = raw;
    state.playbackClockRawSeconds = raw;
    state.playbackClockFrameNow = frameNow;
    state.playbackClockCorrectionMs = 0;
}

export function projectClock(state: PlaybackClockState, media: ClockMedia, frameNow: number): number {
    const raw = Math.max(0, Number(media.currentTime) || 0);

    const rateValue = Number(media.playbackRate);

    const playbackRate = Number.isFinite(rateValue) && rateValue > 0 ? rateValue : 1;

    const mustAnchor =
        state.playbackClockMedia !== media ||
        !Number.isFinite(state.playbackClockSeconds) ||
        !Number.isFinite(state.playbackClockFrameNow) ||
        frameNow < state.playbackClockFrameNow ||
        media.paused ||
        media.seeking ||
        media.ended ||
        state.playbackClockSuspended ||
        media.readyState < 2;

    if (mustAnchor) {
        resetClock(state, media, frameNow);

        return raw;
    }

    const elapsed = Math.max(0, Math.min(0.25, (frameNow - state.playbackClockFrameNow) / 1000));

    let projected = state.playbackClockSeconds + elapsed * playbackRate;

    let allowRegression = false;

    const rawDelta = raw - state.playbackClockRawSeconds;

    if (Math.abs(rawDelta) > 0.0005) {
        const error = raw - projected;

        if (rawDelta < -0.05 || error >= CLOCK_HARD_SNAP_SECONDS) {
            projected = raw;
            allowRegression = rawDelta < -0.05;
            state.playbackClockHardSnaps += 1;
            state.playbackClockCorrectionMs = 0;
        } else {
            const correction = Math.max(-CLOCK_MAX_CORRECTION_SECONDS, Math.min(CLOCK_MAX_CORRECTION_SECONDS, error * CLOCK_CORRECTION_GAIN));

            projected += correction;
            state.playbackClockCorrectionMs = correction * 1000;
        }

        state.playbackClockRawSeconds = raw;
    } else {
        state.playbackClockCorrectionMs *= 0.88;
    }

    projected = Math.max(raw - CLOCK_MAX_DRIFT_SECONDS, Math.min(raw + CLOCK_MAX_DRIFT_SECONDS, projected));

    if (!allowRegression) {
        projected = Math.max(state.playbackClockSeconds, projected);
    }

    state.playbackClockSeconds = Math.max(0, projected);

    state.playbackClockFrameNow = frameNow;

    return state.playbackClockSeconds;
}
