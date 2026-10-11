/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import { requireValue } from "../shared/invariants.ts";
import type {} from "../shared/runtime.ts";
import { getCurrentLyricPage, getCurrentLyricsContainer, isLyricsPage } from "./host.ts";
import type { LyricInput } from "./payload.ts";
import type { RendererState } from "./state.ts";

interface Dependencies {
    ACCENT_STORAGE_KEY: "lyricbridge.renderer.accent";
    PREMIUM_ACCENTS: readonly {
        id: string;
        name: string;
        rgb: string;
        secondaryRgb: string;
        tertiaryRgb: string;
        gain: number;
    }[];
    state: Pick<
        RendererState,
        | "accentRandomSource"
        | "accentHistory"
        | "accentBag"
        | "lyricsAcceptedKey"
        | "lyricsRequestKey"
        | "accentSignature"
        | "accentReplayArmed"
        | "accentMode"
        | "accent"
        | "accentSelectionReason"
        | "lyrics"
    >;
    ACCENT_HISTORY_STORAGE_KEY: "lyricbridge.renderer.recentAccents";
    NEUTRAL_ACCENT: Readonly<{
        id: "neutral-fallback";
        name: "Neutral Fallback";
        rgb: "214, 226, 255";
        secondaryRgb: "196, 180, 255";
        tertiaryRgb: "255, 214, 238";
        gain: 0.72;
    }>;
    stableHash: (input: string) => number;
    lyricSignature: (lyrics: LyricInput[]) => string;
    wakeAnimationLoop: () => void;
}
export function createAccentController(dependencies: Dependencies) {
    const { ACCENT_STORAGE_KEY, PREMIUM_ACCENTS, state, ACCENT_HISTORY_STORAGE_KEY, NEUTRAL_ACCENT, stableHash, lyricSignature, wakeAnimationLoop } =
        dependencies;
    function readAccentMode() {
        try {
            const stored = localStorage.getItem(ACCENT_STORAGE_KEY);

            if (!stored) {
                return "shuffle";
            }

            if (stored === "shuffle" || stored === "off" || findAccent(stored)) {
                return stored;
            }

            /* Stale/hand-edited values must not poison every song load. */
            return "shuffle";
        } catch {
            return "shuffle";
        }
    }

    function findAccent(id: string | undefined) {
        return PREMIUM_ACCENTS.find((accent) => accent.id === id) || null;
    }

    function randomAccentIndex(length: number) {
        if (length <= 1) return 0;

        try {
            if (window.crypto && typeof window.crypto.getRandomValues === "function") {
                const value = new Uint32Array(1);

                window.crypto.getRandomValues(value);

                state.accentRandomSource = "crypto";

                return requireValue(value[0]) % length;
            }
        } catch {
            // A randomness failure must not prevent choosing a visual palette.
        }

        state.accentRandomSource = "math-random";

        return Math.floor(Math.random() * length);
    }

    function readAccentHistory() {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(ACCENT_HISTORY_STORAGE_KEY) || "[]");

            if (Array.isArray(parsed)) {
                return parsed.filter((id: unknown): id is string => typeof id === "string" && !!findAccent(id)).slice(-4);
            }
        } catch {
            // Storage may be disabled by the client/browser.
        }

        return [];
    }

    function writeAccentHistory(history: string[]) {
        state.accentHistory = history.slice(-4);

        try {
            localStorage.setItem(ACCENT_HISTORY_STORAGE_KEY, JSON.stringify(state.accentHistory));
        } catch {
            // In-memory history still prevents immediate repeats.
        }
    }

    function writeAccentBag() {
        try {
            if (typeof sessionStorage !== "undefined") {
                sessionStorage.setItem("lyricbridge.renderer.accentBag", JSON.stringify(state.accentBag));
            }
        } catch {
            // In-memory bag remains valid for this page lifetime.
        }
    }

    function loadAccentBag() {
        if (state.accentBag.length) return;

        try {
            if (typeof sessionStorage !== "undefined") {
                const parsed: unknown = JSON.parse(sessionStorage.getItem("lyricbridge.renderer.accentBag") || "[]");

                if (Array.isArray(parsed)) {
                    const seen: Record<string, boolean> = {};

                    state.accentBag = parsed.filter((id: unknown): id is string => {
                        if (typeof id !== "string") return false;
                        if (seen[id] || !findAccent(id)) {
                            return false;
                        }

                        seen[id] = true;
                        return true;
                    });
                }
            }
        } catch {
            state.accentBag = [];
        }
    }

    function refillAccentBag() {
        const bag = PREMIUM_ACCENTS.map((accent) => accent.id);

        for (let index = bag.length - 1; index > 0; index -= 1) {
            const swapIndex = randomAccentIndex(index + 1);

            const value = bag[index];
            bag[index] = requireValue(bag[swapIndex]);
            bag[swapIndex] = requireValue(value);
        }

        state.accentBag = bag;
        writeAccentBag();
    }

    function drawShuffledAccent() {
        loadAccentBag();

        if (!state.accentBag.length) {
            refillAccentBag();
        }

        const recent = state.accentHistory.length ? state.accentHistory.slice(-4) : readAccentHistory();

        let bagIndex = state.accentBag.findIndex((id) => !recent.includes(id));

        if (bagIndex < 0) bagIndex = 0;

        const id = state.accentBag.splice(bagIndex, 1)[0];

        writeAccentBag();
        writeAccentHistory(recent.concat(requireValue(id)));

        return findAccent(id) || NEUTRAL_ACCENT;
    }

    function applyAccentTheme() {
        if (!isLyricsPage()) return;

        const page = getCurrentLyricPage();
        const container = getCurrentLyricsContainer(false);

        if (!page && !container) return;

        const accent = currentAccent();
        const primary = accent.rgb;
        const secondary = accent.secondaryRgb || primary;
        const tertiary = accent.tertiaryRgb || secondary;

        /*
         * Apply the palette at BOTH scopes. Older releases declared fallback
         * glow variables directly on .ak-karaoke-container, which shadowed the
         * song-level variables set on .lyricPage and made every palette look
         * like Champagne Gold. Inline values on the live container make the
         * selected palette authoritative even when stale/custom CSS defines a
         * descendant fallback. The page copy keeps atmosphere/other descendants
         * on the same theme.
         */
        const targets = [];
        if (page) targets.push(page);
        if (container && container !== page) targets.push(container);

        targets.forEach((target) => {
            if (!target || !target.style) return;

            target.style.setProperty("--ak-glow-primary-rgb", primary);
            target.style.setProperty("--ak-glow-secondary-rgb", secondary);
            target.style.setProperty("--ak-glow-tertiary-rgb", tertiary);

            if (target.dataset) {
                target.dataset.akGlowTheme = accent.id;
            }
        });
    }

    function selectSongAccent(lyrics: LyricInput[], force: boolean = false, reason: string = "song-load") {
        const mode = readAccentMode();

        const songIdentity = state.lyricsAcceptedKey || state.lyricsRequestKey || "";

        const signature = stableHash(`${songIdentity}|${lyricSignature(lyrics)}`).toString(16);

        if (state.accentSignature !== signature) {
            state.accentReplayArmed = false;
        }

        if (mode === "off") {
            state.accentMode = "off";
            state.accent = {
                id: "off",
                name: "Off",
                rgb: "255, 255, 255",
                secondaryRgb: "255, 255, 255",
                tertiaryRgb: "255, 255, 255",
                gain: 0,
            };
            state.accentSignature = signature;
            state.accentSelectionReason = reason;
            applyAccentTheme();
            return;
        }

        if (mode !== "shuffle") {
            const forced = findAccent(mode);

            if (forced) {
                state.accentMode = mode;
                state.accent = forced;
                state.accentSignature = signature;
                state.accentSelectionReason = "forced";
                applyAccentTheme();
                return;
            }
        }

        if (!force && state.accentMode === "shuffle" && state.accentSignature === signature) {
            applyAccentTheme();
            return;
        }

        state.accentMode = "shuffle";
        state.accent = drawShuffledAccent();
        state.accentSignature = signature;
        state.accentSelectionReason = reason;
        applyAccentTheme();
    }

    function setAccentMode(mode: string) {
        const normalized = String(mode || "")
            .trim()
            .toLowerCase();

        if (normalized !== "shuffle" && normalized !== "off" && !findAccent(normalized)) {
            throw new Error(`Unknown accent "${mode}". Use "shuffle", "off", or: ` + PREMIUM_ACCENTS.map((accent) => accent.id).join(", "));
        }

        try {
            localStorage.setItem(ACCENT_STORAGE_KEY, normalized);
        } catch {
            // Ignore storage failures.
        }

        state.accentReplayArmed = false;

        if (state.lyrics) {
            selectSongAccent(state.lyrics, true, "mode-change");
        } else {
            state.accentMode = normalized;

            if (normalized === "off") {
                state.accent = {
                    id: "off",
                    name: "Off",
                    rgb: "255, 255, 255",
                    secondaryRgb: "255, 255, 255",
                    tertiaryRgb: "255, 255, 255",
                    gain: 0,
                };
            } else if (normalized !== "shuffle") {
                state.accent = findAccent(normalized) || NEUTRAL_ACCENT;
            } else {
                state.accent = drawShuffledAccent();
            }

            state.accentSelectionReason = "mode-change";

            applyAccentTheme();
        }

        return {
            mode: state.accentMode,
            accent: requireValue(state.accent).id,
            name: requireValue(state.accent).name,
            primaryRgb: requireValue(state.accent).rgb,
            secondaryRgb: requireValue(state.accent).secondaryRgb,
            tertiaryRgb: requireValue(state.accent).tertiaryRgb,
        };
    }

    function rerollAccent() {
        try {
            localStorage.setItem(ACCENT_STORAGE_KEY, "shuffle");
        } catch {
            // Ignore storage failures.
        }

        state.accentMode = "shuffle";
        state.accentReplayArmed = false;

        if (state.lyrics) {
            selectSongAccent(state.lyrics, true, "manual-reroll");
        } else {
            state.accent = drawShuffledAccent();

            state.accentSelectionReason = "manual-reroll";

            applyAccentTheme();
        }

        wakeAnimationLoop();

        return {
            mode: state.accentMode,
            accent: requireValue(state.accent).id,
            name: requireValue(state.accent).name,
            primaryRgb: requireValue(state.accent).rgb,
            secondaryRgb: requireValue(state.accent).secondaryRgb,
            tertiaryRgb: requireValue(state.accent).tertiaryRgb,
        };
    }

    function currentAccent() {
        return state.accent || NEUTRAL_ACCENT;
    }

    return {
        readAccentMode,
        findAccent,
        randomAccentIndex,
        readAccentHistory,
        writeAccentHistory,
        writeAccentBag,
        loadAccentBag,
        refillAccentBag,
        drawShuffledAccent,
        applyAccentTheme,
        selectSongAccent,
        setAccentMode,
        rerollAccent,
        currentAccent,
    };
}
