import type { BridgeDocument, ServiceCapability, SourceCapability } from "../../contracts/bridge.ts";
import type { RichLyrics } from "../../contracts/lyrics.ts";
import type { Preferences } from "../../contracts/preferences.ts";
import { type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import { nativePayload } from "../../shared/lyrics.ts";
import type { PreferenceSave } from "../preferences/preferences.ts";
import type { BridgeApi } from "../transport/ports.ts";
import { rendererPort } from "../transport/renderer-port.ts";
import { parseDocument, responseOrder as readResponseOrder } from "../transport/responses.ts";
import type { TrackScope } from "./contracts.ts";

interface Dependencies {
    beforeRelease(): void;
    afterRelease(): void;
    lifetime: Lifecycle;
    saveIdentity: (request?: Request | null) => string;
    ensureTools: () => void;
    discardOtherAccounts(): void;
    services: ServiceCapability[];
    sources: SourceCapability[];
    updateStatus: () => void;
    status: (message: string, error?: boolean, ttl?: number, operation?: string) => void;
    responseOrder: symbol;
    lyricViewHidden: boolean;
    metrics: { decorations: number; requests: number; stale: number; searchRowUpdates: number; searchSorts: number; maxSearchPaintMs: number };
    playbackPreview: { defer(owner: TrackScope, update: { data: BridgeDocument; renderNow: boolean; order?: number }): boolean };
    pendingPreference: (path: string) => PreferenceSave | undefined;
    defaults: Preferences;
    mergePreferences: () => void;
    lyricView: { index(document: RichLyrics | null | undefined): void };
    reportPreferenceFailures(): void;
    showError: (
        cause: unknown,
        parent?: HTMLElement | null | undefined,
        retryAction?: () => unknown,
        context?: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string },
    ) => void;
    refreshLanguageOptions(): void;
    render: (doc: RichLyrics | null | undefined) => void;
    refreshRows: () => void;
    updateSongPanel: (force?: boolean) => void;
    isLyrics: () => boolean;
    restoreGeneration: (target: TrackScope) => Promise<void>;
    transcriptionPanel: { restore(target: TrackScope): Promise<void> };
    api: BridgeApi;
    hasLyricRows(): boolean;
    searchUsageRefresh: (() => void) | null;
}

/** Owns track session behavior and its installation lifetime. */
export function createTrackSession(deps: Dependencies) {
    let current: BridgeDocument | null = null;

    let scope: TrackScope | null = null;

    let sequence = 0;

    let lastRequest: Request | null = null;

    function documentState(): Readonly<BridgeDocument> {
        if (!current) throw new Error("Lyrics are not ready. Reload the current song.");
        return current;
    }

    function trackScope(): TrackScope {
        if (!scope) throw new Error("No song is active.");
        return scope;
    }

    function cancel() {
        deps.beforeRelease();
        scope?.controller.abort();
        if (scope?.timer) deps.lifetime.clearTimeout(scope.timer);
        if (scope?.loadingTimer) deps.lifetime.clearTimeout(scope.loadingTimer);
        if (scope?.overrideTimer) deps.lifetime.clearTimeout(scope.overrideTimer);
        scope = null;
        deps.afterRelease();
        current = null;
    }

    function begin(request: Request, itemId: string) {
        if (
            deps.saveIdentity(request) === deps.saveIdentity() &&
            scope?.itemId.replaceAll("-", "").toLowerCase() === itemId.replaceAll("-", "").toLowerCase()
        ) {
            lastRequest = request;
            deps.ensureTools();
            return scope;
        }
        cancel();
        lastRequest = request;
        rendererPort()?.beginTrack?.(itemId);
        deps.discardOtherAccounts();
        scope = { id: ++sequence, itemId, controller: new AbortController(), timer: undefined, issued: 0, accepted: 0 };
        deps.services = [];
        deps.sources = [];
        deps.ensureTools();
        trackScope().loadingStarted = performance.now();
        const target = trackScope();
        trackScope().loadingTimer = deps.lifetime.timeout(() => {
            if (scope !== target) return;
            if (current) deps.updateStatus();
            else
                target.loadingTimer = deps.lifetime.timeout(() => {
                    if (scope === target && !current) deps.status("Loading lyrics…");
                }, 700);
        }, 300);
        return scope;
    }

    function accept(
        data: BridgeDocument,
        target: TrackScope,
        renderNow = false,
        order: number | undefined = readResponseOrder(data, deps.responseOrder),
    ) {
        if (deps.lyricViewHidden || scope !== target || (order !== undefined && order < target.accepted)) {
            deps.metrics.stale++;
            return;
        }
        if (deps.playbackPreview.defer(target, { data, renderNow, order })) return;
        if (order !== undefined) target.accepted = order;
        const previous = current?.lyrics;
        const versionSignature = (doc: BridgeDocument | null) =>
            JSON.stringify([
                doc?.lyrics?.hash,
                doc?.variants?.map((v) => v.key),
                doc?.auxiliaryChoices,
                doc?.detectedLanguages,
                doc?.preferences?.sourceLanguage,
                doc?.preferences?.translationLanguage,
                doc?.songOverrides,
                doc?.savedOriginals,
                doc?.canDeleteOriginals,
            ]);
        const previousVersions = versionSignature(current);
        const account = deps.pendingPreference("preferences")?.body || data.accountPreferences || data.preferences;
        const overrides = deps.pendingPreference("items/" + target.itemId + "/language-preferences")?.body || data.songOverrides || {};
        current = { ...data, itemId: target.itemId, accountPreferences: { ...deps.defaults, ...account }, songOverrides: overrides };
        deps.mergePreferences();
        deps.lyricView.index(documentState().lyrics);
        if (!renderNow && JSON.stringify(nativePayload(previous)) !== JSON.stringify(nativePayload(documentState().lyrics)))
            rendererPort()?.applyRichPayload?.(nativePayload(documentState().lyrics), target.itemId);
        deps.ensureTools();
        deps.updateStatus();
        deps.reportPreferenceFailures();
        deps.refreshLanguageOptions();
        if (renderNow && JSON.stringify(nativePayload(previous).Lyrics) !== JSON.stringify(nativePayload(documentState().lyrics).Lyrics))
            deps.render(documentState().lyrics);
        else if (renderNow) deps.refreshRows();
        rendererPort()?.setSharedTimingOffset?.(documentState().timingCorrection?.seconds || 0);
        if (previousVersions !== versionSignature(current)) deps.updateSongPanel();
        if (!target.jobsRestored && deps.isLyrics()) {
            target.jobsRestored = true;
            void deps.restoreGeneration(target);
            void deps.transcriptionPanel.restore(target);
        }
        schedulePoll(target);
    }

    function schedulePoll(target: TrackScope) {
        if (target.timer) deps.lifetime.clearTimeout(target.timer);
        if (
            (current && !documentState().complete) ||
            (current?.pronunciation && ["queued", "running", "busy"].includes(requireValue(documentState().pronunciation).state))
        )
            target.timer = deps.lifetime.timeout(async () => {
                try {
                    const data = parseDocument(await deps.api("items/" + target.itemId + "/lyrics"), deps.defaults);
                    accept(data, target, true);
                } catch (error) {
                    if (!(error instanceof Error && error.name === "AbortError") && scope === target) deps.showError(error);
                }
            }, 600);
    }

    async function refreshSong(force = false) {
        const target = scope;
        if (!target) return;
        const data = parseDocument(await deps.api("items/" + target.itemId + "/lyrics"), deps.defaults);
        accept(data, target, true);
        if (scope !== target) return;
        if (force && (!current?.lyrics || !deps.hasLyricRows())) deps.render(current?.lyrics);
        deps.updateSongPanel(force);
        deps.searchUsageRefresh?.();
    }
    return {
        setPreferences(value: BridgeDocument["preferences"]) {
            if (current) current = { ...current, preferences: value };
        },
        setAccountPreferences(value: BridgeDocument["accountPreferences"]) {
            if (current) current = { ...current, accountPreferences: value };
        },
        setSongOverrides(value: BridgeDocument["songOverrides"]) {
            if (current) current = { ...current, songOverrides: value };
        },
        setAuxiliaryChoices(value: BridgeDocument["auxiliaryChoices"]) {
            if (current) current = { ...current, auxiliaryChoices: value };
        },
        documentState,
        trackScope,
        cancel,
        begin,
        accept,
        schedulePoll,
        refreshSong,
        get current(): Readonly<BridgeDocument> | null {
            return current;
        },
        replaceCurrent(value: BridgeDocument | null) {
            current = value;
        },
        get scope(): TrackScope | null {
            return scope;
        },
        replaceScope(value: TrackScope | null) {
            scope = value;
        },
        get sequence(): number {
            return sequence;
        },
        replaceSequence(value: number) {
            sequence = value;
        },
        get lastRequest(): Request | null {
            return lastRequest;
        },
        replaceLastRequest(value: Request | null) {
            lastRequest = value;
        },
    };
}
