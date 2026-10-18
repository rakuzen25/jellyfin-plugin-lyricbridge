/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
export interface AutoFollowPort {
    reset(reason: string, clearGeometry?: boolean): void;
    invalidateTarget(): void;
    readonly suspendedUntil: number;
    lyricLineIndexForTarget(target: EventTarget | null): number;
    suppressJellyfinLyricAutoFollow(reason?: string): void;
    resumeLyricAutoFollow(reason?: string): void;
    focusLyricLineIndex(lineIndex: number, options?: { force?: boolean; behavior?: ScrollBehavior; reason?: string }): boolean;
}
