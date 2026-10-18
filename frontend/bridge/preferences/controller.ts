import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { RichLyrics } from "../../contracts/lyrics.ts";
import type { Preferences } from "../../contracts/preferences.ts";
import { type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import type { TrackScope } from "../session/contracts.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import type { PlaybackNotifications } from "../ui/playback-notifications.ts";
import type { PreferenceSave } from "./preferences.ts";
import { PreferenceQueue, preferenceIdentity } from "./preferences.ts";

interface Dependencies {
    defaults: Preferences;
    trackSession: TrackSessionPort;
    documentState: () => Readonly<BridgeDocument>;
    trackScope: () => TrackScope;
    refreshRows: () => void;
    updateLanguageOptions: (parent: HTMLElement | null | undefined) => void;
    popup: HTMLElement | null;
    updateSongPanel: (force?: boolean) => void;
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: () => void, severity?: FeedbackSeverity) => void;
    updateLivePreview: () => void;
    baseFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) &
        ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>);
    lifetime: Lifecycle;
    notifications: PlaybackNotifications | null;
    refreshSong: (force?: boolean) => Promise<void>;
    showError: (
        cause: unknown,
        parent?: HTMLElement | null | undefined,
        retryAction?: () => unknown,
        context?: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string },
    ) => void;
    tools: HTMLElement | null;
}

/** Owns preference controller behavior and its installation lifetime. */
export function createPreferenceController(deps: Dependencies) {
    function richLines(doc: RichLyrics | null | undefined) {
        return doc?.lines.flatMap((line) => (line.background ? [line, line.background] : [line])) || [];
    }

    function accountPreferences() {
        return { ...deps.defaults, ...(deps.trackSession.current?.accountPreferences || deps.trackSession.current?.preferences) };
    }

    function mergePreferences() {
        if (!deps.trackSession.current) return;
        const overrides = deps.documentState().songOverrides;
        deps.trackSession.setPreferences({
            ...accountPreferences(),
            ...(overrides?.sourceLanguage != null ? { sourceLanguage: overrides.sourceLanguage } : {}),
            ...(overrides?.translationLanguage != null ? { translationLanguage: overrides.translationLanguage } : {}),
            ...(overrides?.originalChineseScript != null ? { originalChineseScript: overrides.originalChineseScript } : {}),
        });
    }

    function songPreference(key: "sourceLanguage" | "translationLanguage" | "originalChineseScript", value: string) {
        const target = deps.trackScope();
        if (!target || !deps.trackSession.current) return;
        deps.trackSession.setSongOverrides({ ...deps.trackSession.current.songOverrides, [key]: value || null });
        enqueuePreference("items/" + target.itemId + "/language-preferences", requireValue(deps.documentState().songOverrides));
        mergePreferences();
        deps.refreshRows();
        deps.updateLanguageOptions(deps.popup?.querySelector<HTMLElement>(".lb-display-panel"));
        deps.updateSongPanel();
        deps.notice(deps.popup?.querySelector<HTMLElement>(".lb-song-save-status"), "Saving…");
    }

    async function saveSongPreferences(target: TrackScope | null = deps.trackSession.scope) {
        if (!target || deps.trackSession.scope !== target) return;
        const path = "items/" + target.itemId + "/language-preferences";
        const entry = enqueuePreference(path, requireValue(deps.documentState().songOverrides));
        clearTimeout(entry.timer);
        await flushPreference(entry);
    }

    const preferenceQueue = new PreferenceQueue({
        request: () => deps.trackSession.lastRequest,
        fetch: deps.baseFetch,
        saved: async (path) => {
            if (deps.lifetime.isDisposed) return;
            deps.notifications?.remove("action:preferences");
            deps.notice(deps.popup?.querySelector(path === "preferences" ? ".lb-save-status" : ".lb-song-save-status"), "Saved", 4000);
            if (deps.trackSession.scope) await deps.refreshSong();
        },
        failed: (error, retry) => {
            if (!deps.lifetime.isDisposed)
                deps.showError(error, deps.popup?.querySelector<HTMLElement>(".lb-display-panel") || deps.tools, retry, {
                    operation: "action:preferences",
                });
        },
    });

    function reportPreferenceFailures() {
        preferenceQueue.reportFailures(saveIdentity(), (error, retry) =>
            deps.showError(error, deps.tools, retry, { operation: "action:preferences" }),
        );
    }
    function flushPreferences() {
        preferenceQueue.flushAll();
    }
    function discardOtherAccounts() {
        preferenceQueue.discardOtherAccounts();
    }

    function saveIdentity(request: Request | null = deps.trackSession.lastRequest) {
        return preferenceIdentity(request);
    }

    function pendingPreference(path: string) {
        return preferenceQueue.pending(path);
    }

    function enqueuePreference(path: string, body: Record<string, unknown>) {
        return preferenceQueue.enqueue(path, body);
    }

    async function flushPreference(entry: PreferenceSave | undefined) {
        await preferenceQueue.flush(entry);
    }

    function preference(key: keyof Preferences, value: Preferences[keyof Preferences]) {
        if (!deps.trackSession.current) deps.trackSession.replaceCurrent({ preferences: { ...deps.defaults }, itemId: deps.trackScope().itemId });
        deps.trackSession.setAccountPreferences({ ...accountPreferences(), [key]: value });
        mergePreferences();
        enqueuePreference("preferences", { ...requireValue(deps.documentState().accountPreferences) });
        deps.refreshRows();
        if (key === "sourceLanguage") deps.updateSongPanel();
        deps.updateLivePreview();
        deps.notice(deps.popup?.querySelector<HTMLElement>(".lb-save-status"), "Saving…");
    }
    return {
        richLines,
        accountPreferences,
        mergePreferences,
        songPreference,
        saveSongPreferences,
        discardOtherAccounts,
        reportPreferenceFailures,
        flushPreferences,
        saveIdentity,
        pendingPreference,
        enqueuePreference,
        flushPreference,
        preference,
    };
}
