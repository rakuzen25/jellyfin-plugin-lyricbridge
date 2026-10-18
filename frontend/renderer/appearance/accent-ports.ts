/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";
import type { Accent } from "../lyrics/models.ts";

export interface AccentState {
    accentMode: string;
    accent: Accent | null;
    accentSignature: string;
    accentHistory: string[];
    accentBag: string[];
    accentRandomSource: string;
    accentSelectionReason: string;
    accentReplayArmed: boolean;
}

export interface AccentStatePort {
    readonly snapshot: ReadView<AccentState>;
    setAccentReplayArmed(value: boolean): void;
}
