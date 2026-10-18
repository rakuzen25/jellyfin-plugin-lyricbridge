import type {} from "../../platform/globals.ts";
import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { LyricLine, RichLyrics } from "../../contracts/lyrics.ts";
import type { AuxiliaryKind, Preferences } from "../../contracts/preferences.ts";
import type {} from "../../platform/globals.ts";
import { type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { TrackScope } from "../session/contracts.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import type { BridgeApi } from "../transport/ports.ts";
import { rendererPort } from "../transport/renderer-port.ts";
import { button, e, section, select } from "../ui/controls.ts";

interface Dependencies {
    playbackPreview: { readonly baseline: object | null };
    popup: HTMLElement | null;
    buildVersionsPanel: () => void;
    trackSession: TrackSessionPort;
    originalLanguages: () => Set<string | undefined>;
    richLines: (doc: RichLyrics | null | undefined) => LyricLine[];
    auxiliary: (
        line: LyricLine,
        kind: AuxiliaryKind,
        preferences: Preferences,
        document?: Readonly<BridgeDocument> | null,
    ) => { text: string; key: string; provenance: string } | null;
    documentState: () => Readonly<BridgeDocument>;
    activateSettingsTab: (name: string) => void;
    closePopup: () => void;
    accountPreferences: () => {
        translationLanguage: string;
        sourceLanguage: string;
        showTranslation: boolean;
        showPronunciation: boolean;
        japaneseRomaji: boolean;
        originalChineseScript: string;
        romanizationSystem: string;
        rowOrder: string;
        originalSize: number;
        pronunciationSize: number;
        translationSize: number;
        rowSpacing: number;
    };
    languageChoices: [string, string][];
    songPreference: (key: "sourceLanguage" | "translationLanguage" | "originalChineseScript", value: string) => void;
    mergePreferences: () => void;
    refreshRows: () => void;
    saveSongPreferences: (target?: TrackScope | null) => Promise<void>;
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: () => void, severity?: FeedbackSeverity) => void;
    api: BridgeApi;
    refreshSong: (force?: boolean) => Promise<void>;
    status: (message: string, error?: boolean, ttl?: number, operation?: string) => void;
    showError: (
        cause: unknown,
        parent?: HTMLElement | null | undefined,
        retryAction?: () => unknown,
        context?: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string },
    ) => void;
}

/** Owns song section behavior and its installation lifetime. */
export function createSongSection(deps: Dependencies) {
    function updateSongPanel(force = false) {
        if (deps.playbackPreview.baseline) return;
        const parent = deps.popup?.querySelector<HTMLElement>(".lb-song-panel");
        if (!parent) return;
        if (force || !parent.contains(document.activeElement)) buildSongSummary(parent);
        deps.buildVersionsPanel();
    }

    function buildSongSummary(parent: HTMLElement) {
        const expanded = [...parent.querySelectorAll<HTMLDetailsElement>("details[open]")].map((n) => n.dataset.section);
        parent.replaceChildren();
        const doc = deps.trackSession.current?.lyrics;
        const stateText: Record<string, string> = {
            instrumental: "Instrumental — no sung lyrics",
            missing: "No lyrics found",
            cleared: "No version selected · automatic search paused",
            failed: "Lyrics could not be retrieved",
            rejected: "Lyrics removed · automatic search paused",
            searching: "Searching for lyrics…",
        };
        const summary = section("Playing now");
        parent.append(summary);
        if (doc) {
            for (const [title, value, kind] of [
                [
                    "Original",
                    doc.source + " · " + ((doc.wordTimed ?? doc.lines.some((l) => l.cues?.length)) ? "Word timing" : "Line / plain lyrics"),
                    "original",
                ],
                ["Pronunciation", null, "pronunciation"],
                ["Translation", null, "translation"],
            ] as const) {
                if (kind === "pronunciation" && deps.originalLanguages().size === 1 && deps.originalLanguages().has("en")) continue;
                const values =
                    kind === "original"
                        ? []
                        : deps
                              .richLines(doc)
                              .map((line) => deps.auxiliary(line, kind, deps.documentState().preferences))
                              .filter(Boolean);
                const row = e("div", "lb-summary-row");
                row.append(
                    e("strong", "", title),
                    e(
                        "span",
                        "lb-provenance",
                        value || [...new Set(values.map((v) => requireValue(v).provenance))].join(", ") || "No rows available",
                    ),
                );
                row.append(
                    button(
                        "Change",
                        () => {
                            deps.activateSettingsTab("Versions");
                            requireValue(deps.popup)
                                .querySelector<HTMLElement>('[data-song-kind="' + kind + '"]')
                                ?.scrollIntoView({ block: "nearest" });
                        },
                        "lb-text-button",
                        { icon: "edit" },
                    ),
                );
                summary.append(row);
            }
            const timing = button(
                "Adjust timing",
                () => {
                    deps.closePopup();
                    document.querySelector<HTMLElement>(".ak-lyrics-timing-chip")?.click();
                },
                "",
                { icon: "timing" },
            );
            summary.append(timing);
        } else {
            summary.append(e("p", "", stateText[deps.trackSession.current?.state ?? ""] || "Lyrics are loading. Display settings are available."));
            if (deps.trackSession.current?.state === "instrumental")
                summary.append(e("small", "lb-help", "Reported by " + (deps.documentState().instrumental?.[0]?.source || "provider")));
            const actions = e("div", "lb-song-actions");
            actions.append(
                button(
                    "Manage versions",
                    () => {
                        deps.activateSettingsTab("Versions");
                        const original = deps.popup?.querySelector<HTMLElement>('[data-song-kind="original"]');
                        if (original) {
                            original.tabIndex = -1;
                            original.focus({ preventScroll: true });
                            original.scrollIntoView({ block: "start" });
                        }
                    },
                    "",
                    { icon: "edit" },
                ),
            );
            summary.append(actions);
        }
        const language = section("Languages for this song");
        language.append(e("p", "lb-help", "Your account"));
        parent.append(language);
        const account = deps.accountPreferences();
        const overrides = deps.trackSession.current?.songOverrides || {};
        const name = (value: string) =>
            deps.languageChoices.find((c) => c[0] === value)?.[1] || (value === "auto" ? "Auto-detect" : value === "zh" ? "Chinese" : value);
        select(
            language,
            "Original language",
            overrides.sourceLanguage || "",
            [
                ["", "Use account default (" + name(account.sourceLanguage) + ")"],
                ["auto", "Auto-detect"],
                ...deps.languageChoices.filter((c) => !c[0].startsWith("zh-")),
                ["zh", "Chinese"],
            ],
            (v) => deps.songPreference("sourceLanguage", v),
        );
        select(
            language,
            "Translation language",
            overrides.translationLanguage || "",
            [["", "Use account default (" + name(account.translationLanguage) + ")"], ...deps.languageChoices],
            (v) => deps.songPreference("translationLanguage", v),
        );
        select(
            language,
            "Original Chinese script",
            overrides.originalChineseScript || "",
            [
                ["", "Use account default (" + account.originalChineseScript + ")"],
                ["Simplified", "Simplified"],
                ["Traditional", "Traditional"],
            ],
            (value) => deps.songPreference("originalChineseScript", value),
        );
        const save = e("p", "lb-song-save-status");
        save.setAttribute("role", "status");
        language.append(save);
        const reset = button(
            "Reset song language overrides",
            async () => {
                const target = deps.trackSession.scope;
                deps.trackSession.setSongOverrides({ sourceLanguage: null, translationLanguage: null, originalChineseScript: null });
                requireValue(target).overrideDirty = true;
                requireValue(target).overrideRevision = (requireValue(target).overrideRevision || 0) + 1;
                deps.mergePreferences();
                deps.refreshRows();
                await deps.saveSongPreferences(requireValue(target));
                if (deps.trackSession.scope === target) buildSongSummary(parent);
            },
            "",
            { icon: "reset" },
        );
        reset.disabled = !overrides.sourceLanguage && !overrides.translationLanguage;
        language.append(reset);
        parent.querySelectorAll("details").forEach((n) => (n.open = expanded.includes(n.dataset.section)));
    }

    function buildSharedTiming(parent: HTMLElement) {
        const target = deps.trackSession.scope;
        const shared = deps.trackSession.current?.timingCorrection?.seconds || 0;
        const hash = deps.trackSession.current?.lyrics?.hash;
        const fingerprint = deps.trackSession.current?.timingFingerprint;
        parent.append(e("p", "lb-help", "Shared: " + shared.toFixed(1) + " s. Your timing adjustment is additional."));
        if (!deps.trackSession.current?.lyrics || !deps.documentState().canSelect || !deps.documentState().timingFingerprint) return;
        const feedback = e("p", "lb-version-status");
        parent.append(feedback);
        async function save(reset: boolean) {
            if (!target || deps.trackSession.scope !== target || !parent.isConnected) return;
            const motion = rendererPort();
            const seconds = reset ? 0 : shared + (motion?.timing?.().seconds || 0);
            deps.notice(feedback, "Saving…");
            try {
                await deps.api("items/" + target.itemId + "/timing", "POST", {
                    hash,
                    fingerprint,
                    seconds,
                });
                if (deps.trackSession.scope !== target) return;
                if (!reset) motion?.setTimingOffset?.(0, true, false);
                await deps.refreshSong();
                if (deps.trackSession.scope !== target || !parent.isConnected) return;
                parent.replaceChildren();
                buildSharedTiming(parent);
                deps.status("Shared timing correction saved", false, 4000);
            } catch (error) {
                deps.showError(error, parent);
            }
        }
        const actions = e("div", "lb-song-actions");
        actions.append(
            button("Save timing for everyone", () => save(false), "", { icon: "timing" }),
            button("Reset shared timing", () => save(true), "", { icon: "reset" }),
        );
        parent.append(actions);
    }
    return { updateSongPanel, buildSongSummary, buildSharedTiming };
}
