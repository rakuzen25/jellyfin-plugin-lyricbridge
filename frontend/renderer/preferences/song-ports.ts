/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";
import type { SongPreference } from "../lyrics/models.ts";

export interface SongPreferencesState {
    songPreferenceKey: string;
    songPreferences: Record<string, SongPreference>;
    timingOffsetSeconds: number;
    sharedTimingOffsetSeconds: number;
}

export interface SongPreferencesStatePort {
    readonly snapshot: ReadView<SongPreferencesState>;
    setTimingOffsetSeconds(value: number): void;
    setSharedTimingOffsetSeconds(value: number): void;
    setSongPreferenceKey(value: string): void;
}
