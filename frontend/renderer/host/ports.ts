/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";

export interface HostInstallationState {
    animationWatchdogTimer: number;
    lyricViewHidden: boolean;
    watchdogLineCursor: number;
    fontGeometryRefreshCount: number;
}

export interface HostInstallationStatePort {
    readonly snapshot: ReadView<HostInstallationState>;
    setLyricViewHidden(value: boolean): void;
}
