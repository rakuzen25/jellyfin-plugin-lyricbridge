import { readView } from "../../shared/read-view.ts";
import {
    SONG_PREFERENCES_MAX_ENTRIES,
    SONG_PREFERENCES_STORAGE_KEY,
    TIMING_OFFSET_MAX_SECONDS,
    TIMING_OFFSET_MIN_SECONDS,
} from "../common/settings.ts";
import type { LyricSessionStatePort } from "../lyrics/session-ports.ts";
import type { PronunciationStatePort } from "../pronunciation/ports.ts";
import type { SongPreferencesState } from "./song-ports.ts";
/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { isRecord } from "../../shared/invariants.ts";

import type { LyricInput } from "../lyrics/payload.ts";
import { cueValue, lyricTextProfile } from "../lyrics/payload.ts";
import { finiteTick } from "../playback/ticks.ts";
function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

interface Dependencies {
    lyricsPort: LyricSessionStatePort;
    pronunciationPort: PronunciationStatePort;
    resetTimingInteraction: () => void;
    lyricSignature: (lyrics: LyricInput[]) => string;
    stableHash: (input: string) => number;
    updateRomanizationToggleUi: () => void;
    updateTimingControlsUi: () => void;
}
export function createSongPreferences(dependencies: Dependencies) {
    const state: SongPreferencesState = {
        songPreferenceKey: "",
        songPreferences: Object.create(null),
        timingOffsetSeconds: 0,
        sharedTimingOffsetSeconds: 0,
    };
    const snapshot = readView(state);

    const { lyricsPort, pronunciationPort, lyricSignature, stableHash, updateRomanizationToggleUi, updateTimingControlsUi, resetTimingInteraction } =
        dependencies;
    function finiteNumber(value: unknown, fallback = 0) {
        const numeric = Number(value);
        return isFiniteNumber(numeric) ? numeric : fallback;
    }

    function clampTimingOffsetSeconds(value: unknown) {
        const numeric = finiteNumber(value, 0);
        const magnitude = Math.round((Math.abs(numeric) + Number.EPSILON) * 10) / 10;
        const rounded = numeric < 0 ? -magnitude : magnitude;
        return Math.max(TIMING_OFFSET_MIN_SECONDS, Math.min(TIMING_OFFSET_MAX_SECONDS, rounded));
    }

    function loadSongPreferences() {
        state.songPreferences = Object.create(null);
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(SONG_PREFERENCES_STORAGE_KEY) || "{}");
            if (isRecord(parsed)) {
                Object.keys(parsed).forEach((key) => {
                    const entry = parsed[key];
                    if (!isRecord(entry)) return;
                    state.songPreferences[key] = {
                        romanization: entry.romanization === "romanized" ? "romanized" : "native",
                        timingOffsetSeconds: clampTimingOffsetSeconds(entry.timingOffsetSeconds),
                        timingFingerprint: String(entry.timingFingerprint || ""),
                        updatedAt: finiteNumber(entry.updatedAt, 0),
                    };
                });
            }
        } catch {
            state.songPreferences = Object.create(null);
        }
    }

    function songPreferenceKeyForLyrics(lyrics: LyricInput[] | null = lyricsPort.snapshot.lyrics) {
        const requestKey = String(lyricsPort.snapshot.lyricsAcceptedKey || lyricsPort.snapshot.lyricsRequestKey || "");
        if (requestKey) return requestKey;
        if (!lyrics || !lyrics.length) return "";
        const signature = lyricSignature(lyrics);
        const firstStart = finiteNumber(cueValue(lyrics[0], "Start", "start"), 0);
        const lastStart = finiteNumber(cueValue(lyrics[lyrics.length - 1], "Start", "start"), 0);
        return `lyrics:${stableHash(signature).toString(16)}:${lyrics.length}:${firstStart}:${lastStart}`;
    }

    function timingTimelineFingerprint(lyrics: LyricInput[] | null = lyricsPort.snapshot.lyrics) {
        if (!lyrics || !lyrics.length) return "";
        const parts: string[] = [];

        lyrics.forEach((lyric, lineIndex: number) => {
            const profile = lyricTextProfile(lyric);
            const start = finiteTick(cueValue(lyric, "Start", "start"));
            const end = finiteTick(cueValue(lyric, "End", "end"));
            const rawCues = cueValue(lyric, "Cues", "cues");
            const cues = Array.isArray(rawCues) ? rawCues : [];
            const cueSignature = cues
                .map((cue) =>
                    [
                        finiteTick(cueValue(cue, "Position", "position")),
                        finiteTick(cueValue(cue, "EndPosition", "endPosition")),
                        finiteTick(cueValue(cue, "Start", "start")),
                        finiteTick(cueValue(cue, "End", "end")),
                    ]
                        .map((value) => (value === null ? "null" : value))
                        .join(":"),
                )
                .join(",");

            parts.push(`${lineIndex}:${start === null ? "null" : start}:${end === null ? "null" : end}:${profile.rawText}:${cueSignature}`);
        });

        return `timeline:${stableHash(parts.join("|")).toString(16)}:${lyrics.length}`;
    }

    function pruneSongPreferences() {
        const keys = Object.keys(state.songPreferences || {});
        if (keys.length <= SONG_PREFERENCES_MAX_ENTRIES) return;
        keys.sort(
            (left, right) =>
                finiteNumber(state.songPreferences[left] && state.songPreferences[left].updatedAt, 0) -
                finiteNumber(state.songPreferences[right] && state.songPreferences[right].updatedAt, 0),
        );
        keys.slice(0, keys.length - SONG_PREFERENCES_MAX_ENTRIES).forEach((key) => delete state.songPreferences[key]);
    }

    function persistSongPreferences() {
        try {
            pruneSongPreferences();
            localStorage.setItem(SONG_PREFERENCES_STORAGE_KEY, JSON.stringify(state.songPreferences));
        } catch {
            // Quota/private-mode failures should not affect live playback.
        }
    }

    function applySongPreferences(lyrics: LyricInput[] | null = lyricsPort.snapshot.lyrics) {
        const key = songPreferenceKeyForLyrics(lyrics);
        state.songPreferenceKey = key;
        const entry = key && state.songPreferences[key] ? state.songPreferences[key] : null;
        pronunciationPort.setRomanizationMode(entry && entry.romanization === "romanized" ? "romanized" : "native");
        const currentTimingFingerprint = timingTimelineFingerprint(lyrics);
        const storedOffset = entry ? clampTimingOffsetSeconds(entry.timingOffsetSeconds) : 0;
        const timingMatches = !!entry && !!entry.timingFingerprint && entry.timingFingerprint === currentTimingFingerprint;

        /*
         * Never carry an timing correction for an unidentified timeline onto a
         * replacement lyric timeline. Romanization preference remains safe to
         * restore independently, while timing defaults to the source file.
         */
        state.timingOffsetSeconds = timingMatches ? storedOffset : 0;
        resetTimingInteraction();
        updateRomanizationToggleUi();
        updateTimingControlsUi();
    }

    function persistCurrentSongPreference() {
        const key = state.songPreferenceKey || songPreferenceKeyForLyrics();
        if (!key) return false;
        state.songPreferenceKey = key;

        const isDefault = pronunciationPort.snapshot.romanizationMode !== "romanized" && Math.abs(state.timingOffsetSeconds) < 0.0001;

        if (isDefault) {
            delete state.songPreferences[key];
        } else {
            state.songPreferences[key] = {
                romanization: pronunciationPort.snapshot.romanizationMode === "romanized" ? "romanized" : "native",
                timingOffsetSeconds: clampTimingOffsetSeconds(state.timingOffsetSeconds),
                timingFingerprint: timingTimelineFingerprint(),
                updatedAt: Date.now(),
            };
        }

        persistSongPreferences();
        return true;
    }

    return {
        snapshot,
        setTimingOffsetSeconds(value: number): void {
            state.timingOffsetSeconds = value;
        },
        setSharedTimingOffsetSeconds(value: number): void {
            state.sharedTimingOffsetSeconds = value;
        },
        setSongPreferenceKey(value: string): void {
            state.songPreferenceKey = value;
        },

        finiteNumber,
        clampTimingOffsetSeconds,
        loadSongPreferences,
        songPreferenceKeyForLyrics,
        timingTimelineFingerprint,
        pruneSongPreferences,
        persistSongPreferences,
        applySongPreferences,
        persistCurrentSongPreference,
    };
}
