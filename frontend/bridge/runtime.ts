import { createExportPanel } from "./export-panel.ts";
import { createGenerationController } from "./generation-controller.ts";
import { PlaybackNotifications } from "./playback-notifications.ts";
import { FeedbackScope, confirmFeedback, type FeedbackAction, type FeedbackSeverity } from "../shared/feedback.ts";
import { feedbackHost, glassFeedback } from "./feedback.ts";
import { Lifecycle } from "../shared/lifecycle.ts";
import { isRecord, requireValue } from "../shared/invariants.ts";
import type { LyricLine, RichLyrics } from "../shared/lyrics.ts";
import { nativePayload, rows } from "../shared/lyrics.ts";
import type {} from "../shared/runtime.ts";
import { createApi } from "./api.ts";
import { auxiliary as auxiliaryText } from "./auxiliary.ts";
import type { BridgeDocument, ServiceCapability, SourceCapability, TrackScope } from "./contracts.ts";
import { button, disclosure, e, section, select } from "./controls.ts";
import { createDisplayPanel } from "./display-panel.ts";
import { createDialog, mountDialog } from "./dialog.ts";
import { createTranscriptionPanel } from "./transcription-panel.ts";
import { createImportPanel } from "./import-panel.ts";
import { createLyricDecoration } from "./lyric-view.ts";
import type { AuxiliaryKind, Preferences } from "./models.ts";
import type { PreferenceSave } from "./preferences.ts";
import { PreferenceQueue, preferenceIdentity } from "./preferences.ts";
import { PreviewSession } from "./preview-session.ts";
import { displayFailure, parseDocument, parseServices, parseSources, responseOrder as readResponseOrder } from "./responses.ts";
import type { SearchQuery, SearchResults } from "./search-models.ts";
import { createSearchPanel } from "./search-panel.ts";
import { SearchSession } from "./search-session.ts";
import { sourceUsage } from "./source-usage.ts";
import { installLyricTransport } from "./transport.ts";
import { createVersionPanel } from "./version-panel.ts";
/* LyricBridge: track-scoped multilingual transport and accessible lyric controls. */
export function installBridge() {
    "use strict";
    if (window.LyricBridge) return;
    const lifetime = new Lifecycle();
    const feedbackScope = new FeedbackScope(glassFeedback);
    const baseFetch = window.fetch.bind(window),
        defaults: Preferences = {
            translationLanguage: "zh-Hans",
            sourceLanguage: "auto",
            showTranslation: true,
            showPronunciation: true,
            japaneseRomaji: true,
            originalChineseScript: "Simplified",
            romanizationSystem: "Hepburn",
            rowOrder: "pronunciation-first",
            originalSize: 40,
            pronunciationSize: 24,
            translationSize: 24,
            rowSpacing: 6,
        };
    let current: BridgeDocument | null = null,
        scope: TrackScope | null = null,
        sequence = 0,
        lastRequest: Request | null = null,
        tools: HTMLElement | null = null,
        notifications: PlaybackNotifications | null = null,
        settingsButton: HTMLButtonElement | null = null,
        popup: HTMLElement | null = null,
        searchPopup: HTMLElement | null = null,
        languagePlayback: { scope: TrackScope | null; input: HTMLElement } | null = null,
        refreshFrame = 0,
        services: ServiceCapability[] = [],
        sources: SourceCapability[] = [];
    let workflowReturn: {
        scope: TrackScope;
        panel: HTMLElement | null;
        trigger: HTMLElement | null;
        label: string;
        section: string;
        scrollTop: number;
    } | null = null;
    function discardWorkflowReturn() {
        if (workflowReturn?.panel) {
            feedbackScope.releaseWithin(workflowReturn.panel);
            workflowReturn.panel.remove();
        }
        workflowReturn = null;
    }
    function beginWorkflow(): boolean {
        if (!scope || searchPopup?.getAttribute("aria-busy") === "true" || !importPanel.canClose() || !transcriptionPanel.canClose()) return false;
        closeSearch(true, false, false);
        if (popup) {
            const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            discardWorkflowReturn();
            workflowReturn = {
                scope,
                panel: popup,
                trigger,
                label: trigger?.getAttribute("aria-label") || trigger?.textContent?.trim() || "",
                section: trigger?.closest<HTMLElement>("[data-song-kind]")?.dataset.songKind || "",
                scrollTop: popup.querySelector(".lb-panel-body")?.scrollTop || 0,
            };
            stopLanguagePlayback();
            // Keep feedback handlers alive while the originating settings view is suspended.
            popup.hidden = true;
            popup.classList.remove("lb-popup");
            popup = null;
        } else if (!workflowReturn) workflowReturn = { scope, panel: null, trigger: null, label: "", section: "", scrollTop: 0 };
        return true;
    }
    function restoreWorkflowReturn() {
        const destination = workflowReturn;
        workflowReturn = null;
        if (!destination || scope !== destination.scope || destination.scope.controller.signal.aborted || !isLyrics() || lyricViewHidden) {
            if (destination?.panel) {
                feedbackScope.releaseWithin(destination.panel);
                destination.panel.remove();
            }
            return;
        }
        if (destination.panel) {
            popup = destination.panel;
            popup.hidden = false;
            popup.classList.add("lb-popup");
            mountDialog(popup);
            updateSongPanel();
            buildDisplay(requireValue(popup.querySelector<HTMLElement>(".lb-display-panel")));
            activateSettingsTab("Versions");
            updatePanelBounds();
        } else openPopup("Versions");
        const panel = popup;
        if (!panel) return;
        const body = panel.querySelector<HTMLElement>(".lb-panel-body");
        if (body) body.scrollTop = destination.scrollTop;
        const trigger = destination.trigger?.isConnected
            ? destination.trigger
            : [...panel.querySelectorAll<HTMLElement>("button")].find(
                  (node) =>
                      (node.getAttribute("aria-label") || node.textContent?.trim()) === destination.label &&
                      (!destination.section || node.closest<HTMLElement>("[data-song-kind]")?.dataset.songKind === destination.section),
              );
        (trigger || panel.querySelector<HTMLElement>('[role="tab"][data-tab="Versions"]'))?.focus({ preventScroll: true });
    }
    function requestWorkflowClose() {
        searchPopup?.querySelector<HTMLButtonElement>(".lb-popup-header button")?.click();
    }
    function documentState(): BridgeDocument {
        if (!current) throw new Error("Lyrics are not ready. Reload the current song.");
        return current;
    }
    function trackScope(): TrackScope {
        if (!scope) throw new Error("No song is active.");
        return scope;
    }
    const metrics = { decorations: 0, requests: 0, stale: 0, searchRowUpdates: 0, searchSorts: 0, maxSearchPaintMs: 0 };
    const responseOrder = Symbol("lyric-response-order");
    let unattributedErrors = new WeakMap<object, string>();
    let noticeSequence = 0;
    const media = () => document.querySelector("audio");
    const lyricContainer = () =>
        [...document.querySelectorAll<HTMLElement>(".lyricsContainer")].filter((n) => n.getClientRects().length && !n.closest(".hide")).at(-1);
    const lyricHost = () =>
        [...document.querySelectorAll<HTMLElement>(".lyricPage")].filter((n) => n.getClientRects().length && !n.closest(".hide,[hidden]")).at(-1);
    let lyricViewHidden = false;
    const isLyrics = () => !lyricViewHidden && (location.hash.includes("lyrics") || location.pathname.endsWith("demo.html"));
    function safeMessage(error: unknown) {
        return (
            (error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "") ||
            "The lyric action failed. Please retry."
        );
    }
    const api = createApi({ request: () => lastRequest, scope: () => scope, fetch: baseFetch, responseOrder, received: () => metrics.requests++ });
    function cancel() {
        window.JellyfinLyricMotion?.setSharedTimingOffset?.(0);
        languagePlayback = null;
        document.querySelectorAll<HTMLElement>(".lb-instrumental-view").forEach((n) => n.remove());
        notifications?.dispose();
        notifications = null;
        unattributedErrors = new WeakMap();
        feedbackScope.dispose();
        scope?.controller.abort();
        if (scope?.timer) lifetime.clearTimeout(scope.timer);
        if (scope?.loadingTimer) lifetime.clearTimeout(scope.loadingTimer);
        if (scope?.overrideTimer) lifetime.clearTimeout(scope.overrideTimer);
        scope = null;
        if (refreshFrame) lifetime.cancelFrame(refreshFrame);
        refreshFrame = 0;
        discardWorkflowReturn();
        closePopup();
        closeSearch(false, true, false);
        settingsButton?.remove();
        settingsButton = null;
        tools?.remove();
        tools = null;
        current = null;
    }
    function begin(request: Request, itemId: string) {
        if (
            saveIdentity(request) === saveIdentity() &&
            scope?.itemId.replaceAll("-", "").toLowerCase() === itemId.replaceAll("-", "").toLowerCase()
        ) {
            lastRequest = request;
            ensureTools();
            return scope;
        }
        cancel();
        lastRequest = request;
        window.JellyfinLyricMotion?.beginTrack?.(itemId);
        preferenceQueue.discardOtherAccounts();
        scope = { id: ++sequence, itemId, controller: new AbortController(), timer: undefined, issued: 0, accepted: 0 };
        services = [];
        sources = [];
        ensureTools();
        trackScope().loadingStarted = performance.now();
        const target = trackScope();
        trackScope().loadingTimer = lifetime.timeout(() => {
            if (scope !== target) return;
            if (current) updateStatus();
            else
                target.loadingTimer = lifetime.timeout(() => {
                    if (scope === target && !current) status("Loading lyrics…");
                }, 700);
        }, 300);
        return scope;
    }
    const lyricView = createLyricDecoration({ defaults, current: () => current, decorated: () => metrics.decorations++, ensureTools });
    const decorate = lyricView.decorate;
    const auxiliary = (line: LyricLine, kind: AuxiliaryKind, preferences: Preferences, document = current) =>
        auxiliaryText(line, kind, preferences, document);
    function refreshRows() {
        searchUsageRefresh?.();
        if (refreshFrame) return;
        refreshFrame = lifetime.frame(() => {
            refreshFrame = 0;
            if (decorate([...(lyricContainer()?.querySelectorAll<HTMLElement>(".lyricsLine") || [])], lyricView.rows))
                window.JellyfinLyricMotion?.refreshLayout?.(true);
        });
    }
    function render(doc: RichLyrics | null | undefined) {
        window.JellyfinLyricMotion?.setSharedTimingOffset?.(current?.timingCorrection?.seconds || 0);
        const payload = nativePayload(doc);
        window.JellyfinLyricMotion?.applyRichPayload?.(payload, scope?.itemId);
        const container = lyricContainer();
        if (!container) return;
        container.replaceChildren(
            ...payload.Lyrics.map((line, i) => {
                const node = e("div", "lyricsLine dynamicLyric", line.Text);
                node.id = "lyricPosition" + i;
                node.dataset.lyrictime = String(line.Start ?? "");
                node.onclick = () => {
                    if (media() && line.Start != null) media()!.currentTime = line.Start / 10000000;
                };
                return node;
            }),
        );
        ensureTools();
        if (!doc) mountTimingBar(null);
        refreshRows();
    }
    function accept(data: BridgeDocument, target: TrackScope, renderNow = false, order: number | undefined = readResponseOrder(data, responseOrder)) {
        if (lyricViewHidden || scope !== target || (order !== undefined && order < target.accepted)) {
            metrics.stale++;
            return;
        }
        if (playbackPreview.defer(target, { data, renderNow, order })) return;
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
        const account = pendingPreference("preferences")?.body || data.accountPreferences || data.preferences;
        const overrides = pendingPreference("items/" + target.itemId + "/language-preferences")?.body || data.songOverrides || {};
        current = { ...data, itemId: target.itemId, accountPreferences: { ...defaults, ...account }, songOverrides: overrides };
        mergePreferences();
        lyricView.index(documentState().lyrics);
        if (!renderNow && JSON.stringify(nativePayload(previous)) !== JSON.stringify(nativePayload(documentState().lyrics)))
            window.JellyfinLyricMotion?.applyRichPayload?.(nativePayload(documentState().lyrics), target.itemId);
        ensureTools();
        updateStatus();
        for (const entry of preferenceSaves.values())
            if (entry.error && entry.identity === saveIdentity())
                showError(entry.error, tools, () => flushPreference(entry), { operation: "action:preferences" });
        updateLanguageOptions(popup?.querySelector<HTMLElement>(".lb-display-panel"));
        if (renderNow && JSON.stringify(nativePayload(previous).Lyrics) !== JSON.stringify(nativePayload(documentState().lyrics).Lyrics))
            render(documentState().lyrics);
        else if (renderNow) refreshRows();
        window.JellyfinLyricMotion?.setSharedTimingOffset?.(documentState().timingCorrection?.seconds || 0);
        if (previousVersions !== versionSignature(current)) updateSongPanel();
        if (!target.jobsRestored && isLyrics()) {
            target.jobsRestored = true;
            void restoreGeneration(target);
            void transcriptionPanel.restore(target);
        }
        schedulePoll(target);
    }
    function schedulePoll(target: TrackScope) {
        if (target.timer) lifetime.clearTimeout(target.timer);
        if (
            (current && !documentState().complete) ||
            (current?.pronunciation && ["queued", "running", "busy"].includes(requireValue(documentState().pronunciation).state))
        )
            target.timer = lifetime.timeout(async () => {
                try {
                    const data = parseDocument(await api("items/" + target.itemId + "/lyrics"), defaults);
                    accept(data, target, true);
                } catch (error) {
                    if (!(error instanceof Error && error.name === "AbortError") && scope === target) showError(error);
                }
            }, 600);
    }
    async function refreshSong(force = false) {
        const target = scope;
        if (!target) return;
        const data = parseDocument(await api("items/" + target.itemId + "/lyrics"), defaults);
        accept(data, target, true);
        if (scope !== target) return;
        if (force) render(current?.lyrics);
        updateSongPanel(force);
        searchUsageRefresh?.();
    }
    function notice(node: HTMLElement | null | undefined, message: string, ttl = 0, expire?: () => void, severity?: FeedbackSeverity) {
        if (!node) return;
        feedbackScope.update(node, {
            message,
            severity: severity || (ttl ? "success" : /^(Loading|Searching|Saving|Submitting|Testing)/.test(message) ? "progress" : "info"),
            ttl,
            expire,
        });
    }
    function status(message: string, error = false, ttl = 0, operation = ttl ? "action:status" : "retrieval") {
        ensureTools();
        notifications?.set(
            operation,
            { message, severity: error ? "error" : ttl ? "success" : /^(Loading|Searching|Generating)/.test(message) ? "progress" : "info", ttl },
            operation === "retrieval" ? "lb-status" : operation === "local-pronunciation" ? "lb-local-status" : "lb-action-status",
        );
    }
    function showError(
        cause: unknown,
        parent: HTMLElement | null | undefined = undefined,
        retryAction: () => unknown = retry,
        context: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string } = {},
    ) {
        const error = displayFailure(cause);
        if (error.name === "AbortError" || (error.scope && error.scope !== scope)) return;
        const host = parent?.isConnected ? parent : tools;
        if (!host) return;
        const key = error.noticeKey || error.details?.diagnosticId || error.details?.code || safeMessage(error);
        if (error.persistent && scope?.dismissedNotices?.has(key)) return;
        if (key.startsWith("job:") && scope?.dismissedJobs?.has(key.slice(4))) return;
        const overlay = host === tools && !!notifications;
        let operation = context.operation || (error.noticeKey ? "notice:" + error.noticeKey : "");
        if (!operation) {
            operation = cause && typeof cause === "object" ? unattributedErrors.get(cause) || "" : "";
            if (!operation) {
                operation = "notice:unattributed:" + ++noticeSequence;
                if (cause && typeof cause === "object") unattributedErrors.set(cause, operation);
            }
        }
        if (!overlay)
            document.querySelectorAll<HTMLElement>('.lb-feedback[data-notice-key="' + CSS.escape(key) + '"]').forEach((n) => {
                if (!n.closest(".lb-tools") && n.parentNode !== host) n.remove();
            });
        let box = overlay
            ? notifications?.get(operation)
            : host.querySelector<HTMLElement>(':scope > .lb-feedback[data-notice-key="' + CSS.escape(key) + '"]');
        if (!box) {
            if (overlay)
                box = requireValue(notifications).set(
                    operation,
                    { message: safeMessage(error), severity: "error" },
                    operation === "retrieval" ? "lb-status" : operation === "local-pronunciation" ? "lb-local-status" : "",
                );
            else {
                box = feedbackHost();
                box.setAttribute("role", "alert");
                host.append(box);
            }
        }
        const signature = JSON.stringify([safeMessage(error), error.details, error.providerErrors]);
        if (!overlay && box.dataset.noticeSignature === signature) return;
        box.dataset.noticeSignature = signature;
        box.dataset.noticeKey = key;
        const informational = error.details?.code === "local_lyrics_missing";
        box.classList.toggle("lb-notice", informational);
        const d = error.details;
        const actions: FeedbackAction[] = [];
        const dismiss = () => {
            if (error.persistent && scope) {
                trackScope().dismissedNotices ??= new Set();
                requireValue(trackScope().dismissedNotices).add(key);
            }
            if (key.startsWith("job:") && scope) {
                trackScope().dismissedJobs ??= new Set();
                requireValue(trackScope().dismissedJobs).add(key.slice(4));
            }
            if (d?.code === "local_romaji_failed" && scope) trackScope().dismissedLocalError = safeMessage(error);
            if (overlay) notifications?.remove(operation);
            else {
                feedbackScope.releaseWithin(box);
                box.remove();
            }
        };
        if (d?.code === "sign_in_required") actions.push({ label: "Sign in", run: () => (location.hash = "/login") });
        else if (d?.code === "service_not_configured")
            actions.push({
                label: "Set up service",
                run: () => {
                    if (current?.canSelect) location.hash = "/configurationpage?name=lyricbridge";
                    else status("Ask an administrator to set up this service.", true);
                },
            });
        else if (d?.retryable)
            actions.push({
                label: context.retryLabel || "Retry",
                run: () => {
                    if (overlay) notifications?.remove(operation);
                    else {
                        feedbackScope.releaseWithin(box);
                        box.remove();
                    }
                    return retryAction();
                },
            });
        if (!host.classList.contains("lb-job-banner")) actions.push({ label: "Dismiss", run: dismiss });
        const options = {
            message: informational ? "Jellyfin has no lyrics for this song. Try importing a file." : safeMessage(error),
            severity: context.severity || (informational ? ("info" as const) : ("error" as const)),
            secondary: context.secondary,
            actions,
            details:
                d && !informational
                    ? [
                          d.code +
                              (d.diagnosticId ? " · Reference " + d.diagnosticId : "") +
                              (d.retryAt ? " · Retry after " + new Date(d.retryAt).toLocaleTimeString() : ""),
                          ...(d.issues || []).map((issue) => (issue.location ? issue.location + ": " : "") + issue.message),
                          ...(d.issueCount && d.issueCount > (d.issues?.length || 0)
                              ? [`${d.issueCount} issues in total; showing the first ${d.issues?.length || 0}.`]
                              : []),
                          ...(error.providerErrors || []).map(
                              (sourceError) => sourceError.message + (sourceError.diagnosticId ? " · Reference " + sourceError.diagnosticId : ""),
                          ),
                      ]
                    : [],
        };
        if (overlay) requireValue(notifications).set(operation, options);
        else feedbackScope.update(box, options);
    }

    async function retry() {
        try {
            const target = scope;
            const data = parseDocument(await api("items/" + requireValue(target).itemId + "/retry", "POST"), defaults);
            accept(data, requireValue(target), true);
        } catch (error) {
            showError(error, tools, retry, { operation: "retrieval" });
        }
    }
    function ensureTools() {
        if (!scope || !isLyrics()) return;
        const host = lyricHost();
        if (!host) return;
        if (tools?.isConnected && notifications) {
            notifications.setHost(host);
            if (settingsButton && settingsButton.parentNode !== host) host.append(settingsButton);
            return;
        }
        tools = e("div", "lb-tools");
        tools.setAttribute("aria-label", "Playback notifications");
        document.body.append(tools);
        notifications = new PlaybackNotifications(tools, host);
        notifications.set("retrieval", { message: "" }, "lb-status");
        settingsButton = button(
            "Lyrics settings",
            () => {
                if (popup) closePopup();
                else openPopup();
            },
            "lb-settings-trigger",
            { icon: "settings", iconOnly: true },
        );
        host.append(settingsButton);
        const bar = [...document.querySelectorAll<HTMLElement>(".ak-lyrics-tools-bar")].find((n) => n.getClientRects().length && !n.closest(".hide"));
        if (bar) mountTimingBar(bar);
    }
    function mountTimingBar(bar: HTMLElement | null) {
        if (!scope || !isLyrics()) return;
        if (!settingsButton) ensureTools();
        const host = bar?.closest(".lyricPage") || lyricHost();
        if (host && settingsButton && settingsButton.parentNode !== host) host.append(settingsButton);
    }
    function updateStatus() {
        if (!current) return;
        ensureTools();
        if (!notifications) return;
        const data = documentState(),
            target = trackScope();
        const messages: Record<string, string> = {
            searching: `Searching… ${data.finished || 0}/${data.total || 0} sources`,
            ready: "",
            partial: "",
            instrumental: "",
            rejected: "",
            missing: "No lyrics found",
            cleared: "No version selected · automatic search paused",
            failed: "No lyrics available (some sources failed)",
        };
        const initialWait = data.state === "searching" && performance.now() - (target.loadingStarted || 0) < 300;
        notifications.set(
            "retrieval",
            {
                message: initialWait ? "" : messages[data.state ?? ""] || "",
                severity: data.state === "failed" ? "error" : data.state === "searching" ? "progress" : "info",
                actions: ["missing", "failed", "cleared"].includes(data.state || "") ? [{ label: "Search again", run: retry }] : [],
                details:
                    data.state !== "partial"
                        ? (data.errors || []).map((error) => error.message + (error.diagnosticId ? " · Reference " + error.diagnosticId : ""))
                        : [],
            },
            "lb-status",
        );
        if (data.state !== "searching" && target.loadingTimer) lifetime.clearTimeout(target.loadingTimer);
        document.querySelectorAll<HTMLElement>(".lb-instrumental-view").forEach((node) => node.remove());
        if (data.state === "instrumental") {
            const message = e("div", "lb-instrumental-view", "Instrumental music, please enjoy.");
            message.setAttribute("role", "status");
            lyricHost()?.append(message);
            if (lyricContainer()?.querySelector(".lyricsLine")) render(null);
        }
        if (data.state === "partial" && data.errors?.length) {
            const key =
                "providers:" +
                data.errors
                    .map((error) => error.diagnosticId || error.code + ":" + error.message)
                    .sort()
                    .join("|");
            showError(
                {
                    message: "Some sources unavailable. Showing available lyrics.",
                    details: { code: "partial_provider_failure", retryable: true },
                    providerErrors: data.errors,
                    noticeKey: key,
                    persistent: true,
                },
                tools,
                retry,
                { operation: "retrieval", severity: "warning" },
            );
        }
        if (
            !searchPopup &&
            data.canSelect &&
            data.better &&
            target.dismissedUpgrade !== (data.better.hash || data.better.source + ":" + data.better.providerId)
        ) {
            const reason = data.improvement?.reason;
            notifications.set(
                "improvement",
                {
                    message:
                        reason === "recording-match"
                            ? "Better recording match"
                            : reason === "auxiliary-completeness"
                              ? "Lyric update available"
                              : reason === "match-score"
                                ? "Better lyric match"
                                : "Better timing",
                    severity: "info",
                    actions: [
                        { label: "Preview", run: () => openVersions(requireValue(documentState().better)) },
                        {
                            label: "Dismiss",
                            run: () => {
                                target.dismissedUpgrade =
                                    requireValue(data.better).hash || requireValue(data.better).source + ":" + requireValue(data.better).providerId;
                                notifications?.remove("improvement");
                            },
                        },
                    ],
                },
                "lb-upgrade lb-upgrade-offer",
            );
        } else notifications.remove("improvement");
        if (data.pronunciation?.state === "running" || data.pronunciation?.state === "queued")
            notifications.set("local-pronunciation", { message: "Generating pronunciation…", severity: "progress" }, "lb-local-status");
        else if (data.pronunciation?.state === "failed" && target.dismissedLocalError !== data.pronunciation.error) {
            const retryLocal = async () => {
                try {
                    await api("items/" + target.itemId + "/pronunciation", "POST", {
                        hash: requireValue(documentState().lyrics).hash,
                        includeSupplied: documentState().auxiliaryChoices?.pronunciation !== "auto",
                        retry: true,
                    });
                    if (scope === target) await refreshSong();
                } catch (error) {
                    if (scope === target) showError(error, tools, retryLocal, { operation: "local-pronunciation", retryLabel: "Retry generation" });
                }
            };
            showError({ message: data.pronunciation.error, details: { code: "local_romaji_failed", retryable: true } }, tools, retryLocal, {
                operation: "local-pronunciation",
                retryLabel: "Retry generation",
            });
        } else notifications.remove("local-pronunciation");
    }
    function closePopup() {
        if (popup) feedbackScope.releaseWithin(popup);
        stopLanguagePlayback();
        if (!popup) return;
        const trigger = settingsButton;
        popup.remove();
        popup = null;
        trigger?.focus();
    }
    function updatePanelBounds() {
        const bar = [...document.querySelectorAll<HTMLElement>(".nowPlayingBar")].find(
            (n) => n.getClientRects().length && !n.classList.contains("hide"),
        );
        const view = window.visualViewport;
        const bottom = bar ? Math.max(8, innerHeight - bar.getBoundingClientRect().top + 8) : 100;
        const keyboard = view ? Math.max(0, innerHeight - view.height - view.offsetTop) : 0;
        for (const panel of [popup, searchPopup]) if (panel) panel.style.setProperty("--lb-panel-bottom", Math.max(bottom, keyboard + 8) + "px");
    }
    lifetime.on(window, "resize", updatePanelBounds);
    if (window.visualViewport) lifetime.on(window.visualViewport, "resize", updatePanelBounds);
    function activateSettingsTab(name: string) {
        if (!popup) return;
        popup.dataset.tab = name;
        popup.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
            const selected = tab.dataset.tab === name;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        popup.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach((panel) => (panel.hidden = panel.dataset.tab !== name));
    }
    function openPopup(tabName = "Song") {
        if (searchPopup) {
            requestWorkflowClose();
            return;
        }
        if (!importPanel.canClose() || !transcriptionPanel.canClose()) return;
        if (popup) {
            if (typeof tabName === "string") activateSettingsTab(tabName);
            else closePopup();
            return;
        }
        const heading = e("div", "lb-settings-heading");
        heading.append(
            e("h2", "", current?.track?.title || current?.lyrics?.title || "Lyrics settings"),
            e("p", "lb-settings-artist", current?.track?.artist || current?.lyrics?.artist || ""),
        );
        popup = createDialog({ label: "Lyrics settings", workflow: false, title: heading, className: "lb-settings-panel", onClose: closePopup }).root;
        const tabs = e("div", "lb-tabs");
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("aria-label", "Lyrics settings");
        const body = e("div", "lb-panel-body");
        for (const [name, cls] of [
            ["Song", "lb-song-panel"],
            ["Versions", "lb-versions-panel"],
            ["Display", "lb-display-panel"],
        ]) {
            const tab = button(requireValue(name), () => activateSettingsTab(requireValue(name)));
            tab.dataset.tab = name;
            tab.id = "lb-tab-" + name;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-controls", "lb-panel-" + name);
            tabs.append(tab);
            const panel = e("div", cls);
            panel.id = "lb-panel-" + name;
            panel.dataset.tab = name;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", tab.id);
            body.append(panel);
        }
        tabs.addEventListener("keydown", (event) => {
            const values = [...tabs.querySelectorAll<HTMLElement>('[role="tab"]')],
                i = values.indexOf(document.activeElement instanceof HTMLElement ? document.activeElement : requireValue(values[0]));
            if (i < 0) return;
            const next =
                event.key === "ArrowRight"
                    ? (i + 1) % values.length
                    : event.key === "ArrowLeft"
                      ? (i + values.length - 1) % values.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? values.length - 1
                          : null;
            if (next !== null) {
                event.preventDefault();
                activateSettingsTab(requireValue(requireValue(values[next]).dataset.tab));
                requireValue(values[next]).focus();
            }
        });
        popup.append(tabs, body);
        mountDialog(popup);
        updatePanelBounds();
        updateSongPanel();
        buildDisplay(requireValue(popup.querySelector<HTMLElement>(".lb-display-panel")));
        activateSettingsTab(typeof tabName === "string" ? tabName : "Song");
        requireValue(tabs.querySelector<HTMLElement>('[aria-selected="true"]')).focus();
        const panel = popup;
        popup.addEventListener("focusout", () =>
            lifetime.timeout(() => {
                if (popup === panel && !panel.contains(document.activeElement)) updateSongPanel();
            }, 0),
        );
    }
    function confirmation(
        parent: HTMLElement,
        message: string,
        action: () => unknown,
        label: string = "Confirm",
        trigger: HTMLElement | undefined = undefined,
    ) {
        const previous = parent.querySelector<HTMLElement>(":scope > .lb-confirmation");
        if (previous) {
            feedbackScope.releaseWithin(previous);
            previous.remove();
        }
        const box = feedbackHost("confirmation");
        box.setAttribute("role", "alert");
        const view = feedbackScope.update(box, { message, severity: "warning" });
        const actions = view.actions;
        actions.classList.add("lb-song-actions");
        actions.hidden = false;
        const cancel = button(
            "Cancel",
            () => {
                feedbackScope.releaseWithin(box);
                box.remove();
                trigger?.focus();
            },
            "",
            { icon: "close" },
        );
        const confirm = button(
            label,
            async () => {
                confirm.disabled = true;
                cancel.disabled = true;
                await confirmFeedback(
                    action,
                    () => {
                        feedbackScope.releaseWithin(box);
                        box.remove();
                        trigger?.focus();
                    },
                    (error) => showError(error, box),
                );
                confirm.disabled = false;
                cancel.disabled = false;
            },
            "lb-danger",
            { icon: "check" },
        );
        actions.append(cancel, confirm);
        box.append(actions);
        parent.append(box);
        cancel.focus();
    }
    function richLines(doc: RichLyrics | null | undefined) {
        return doc?.lines.flatMap((line) => (line.background ? [line, line.background] : [line])) || [];
    }
    function accountPreferences() {
        return { ...defaults, ...(current?.accountPreferences || current?.preferences) };
    }
    function mergePreferences() {
        if (!current) return;
        const overrides = documentState().songOverrides;
        documentState().preferences = {
            ...accountPreferences(),
            ...(overrides?.sourceLanguage != null ? { sourceLanguage: overrides.sourceLanguage } : {}),
            ...(overrides?.translationLanguage != null ? { translationLanguage: overrides.translationLanguage } : {}),
            ...(overrides?.originalChineseScript != null ? { originalChineseScript: overrides.originalChineseScript } : {}),
        };
    }
    function songPreference(key: "sourceLanguage" | "translationLanguage" | "originalChineseScript", value: string) {
        const target = trackScope();
        if (!target || !current) return;
        documentState().songOverrides = { ...current.songOverrides, [key]: value || null };
        enqueuePreference("items/" + target.itemId + "/language-preferences", requireValue(documentState().songOverrides));
        mergePreferences();
        refreshRows();
        updateLanguageOptions(popup?.querySelector<HTMLElement>(".lb-display-panel"));
        updateSongPanel();
        notice(popup?.querySelector<HTMLElement>(".lb-song-save-status"), "Saving…");
    }
    async function saveSongPreferences(target: TrackScope | null = scope) {
        if (!target || scope !== target) return;
        const path = "items/" + target.itemId + "/language-preferences";
        const entry = enqueuePreference(path, requireValue(documentState().songOverrides));
        clearTimeout(entry.timer);
        await flushPreference(entry);
    }
    function updateSongPanel(force = false) {
        if (playbackPreview.baseline) return;
        const parent = popup?.querySelector<HTMLElement>(".lb-song-panel");
        if (!parent) return;
        if (force || !parent.contains(document.activeElement)) buildSongSummary(parent);
        buildVersionsPanel();
    }
    function buildSongSummary(parent: HTMLElement) {
        const expanded = [...parent.querySelectorAll<HTMLDetailsElement>("details[open]")].map((n) => n.dataset.section);
        parent.replaceChildren();
        const doc = current?.lyrics;
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
                if (kind === "pronunciation" && originalLanguages().size === 1 && originalLanguages().has("en")) continue;
                const values =
                    kind === "original"
                        ? []
                        : richLines(doc)
                              .map((line) => auxiliary(line, kind, documentState().preferences))
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
                            activateSettingsTab("Versions");
                            requireValue(popup)
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
                    closePopup();
                    document.querySelector<HTMLElement>(".ak-lyrics-timing-chip")?.click();
                },
                "",
                { icon: "timing" },
            );
            summary.append(timing);
        } else {
            summary.append(e("p", "", stateText[current?.state ?? ""] || "Lyrics are loading. Display settings are available."));
            if (current?.state === "instrumental")
                summary.append(e("small", "lb-help", "Reported by " + (documentState().instrumental?.[0]?.source || "provider")));
            const actions = e("div", "lb-song-actions");
            actions.append(
                button(
                    "Manage versions",
                    () => {
                        activateSettingsTab("Versions");
                        const original = popup?.querySelector<HTMLElement>('[data-song-kind="original"]');
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
        const account = accountPreferences(),
            overrides = current?.songOverrides || {};
        const name = (value: string) =>
            languageChoices.find((c) => c[0] === value)?.[1] || (value === "auto" ? "Auto-detect" : value === "zh" ? "Chinese" : value);
        select(
            language,
            "Original language",
            overrides.sourceLanguage || "",
            [
                ["", "Use account default (" + name(account.sourceLanguage) + ")"],
                ["auto", "Auto-detect"],
                ...languageChoices.filter((c) => !c[0].startsWith("zh-")),
                ["zh", "Chinese"],
            ],
            (v) => songPreference("sourceLanguage", v),
        );
        select(
            language,
            "Translation language",
            overrides.translationLanguage || "",
            [["", "Use account default (" + name(account.translationLanguage) + ")"], ...languageChoices],
            (v) => songPreference("translationLanguage", v),
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
            (value) => songPreference("originalChineseScript", value),
        );
        const save = e("p", "lb-song-save-status");
        save.setAttribute("role", "status");
        language.append(save);
        const reset = button(
            "Reset song language overrides",
            async () => {
                const target = scope;
                documentState().songOverrides = { sourceLanguage: null, translationLanguage: null, originalChineseScript: null };
                requireValue(target).overrideDirty = true;
                requireValue(target).overrideRevision = (requireValue(target).overrideRevision || 0) + 1;
                mergePreferences();
                refreshRows();
                await saveSongPreferences(requireValue(target));
                if (scope === target) buildSongSummary(parent);
            },
            "",
            { icon: "reset" },
        );
        reset.disabled = !overrides.sourceLanguage && !overrides.translationLanguage;
        language.append(reset);
        parent.querySelectorAll("details").forEach((n) => (n.open = expanded.includes(n.dataset.section)));
    }
    function buildSharedTiming(parent: HTMLElement) {
        const target = scope;
        const shared = current?.timingCorrection?.seconds || 0;
        const hash = current?.lyrics?.hash;
        const fingerprint = current?.timingFingerprint;
        parent.append(e("p", "lb-help", "Shared: " + shared.toFixed(1) + " s. Your timing adjustment is additional."));
        if (!current?.lyrics || !documentState().canSelect || !documentState().timingFingerprint) return;
        const feedback = e("p", "lb-version-status");
        parent.append(feedback);
        async function save(reset: boolean) {
            if (!target || scope !== target || !parent.isConnected) return;
            const motion = window.JellyfinLyricMotion,
                seconds = reset ? 0 : shared + (motion?.timing?.().seconds || 0);
            notice(feedback, "Saving…");
            try {
                await api("items/" + target.itemId + "/timing", "POST", {
                    hash,
                    fingerprint,
                    seconds,
                });
                if (scope !== target) return;
                if (!reset) motion?.setTimingOffset?.(0, true, false);
                await refreshSong();
                if (scope !== target || !parent.isConnected) return;
                parent.replaceChildren();
                buildSharedTiming(parent);
                status("Shared timing correction saved", false, 4000);
            } catch (error) {
                showError(error, parent);
            }
        }
        const actions = e("div", "lb-song-actions");
        actions.append(
            button("Save timing for everyone", () => save(false), "", { icon: "timing" }),
            button("Reset shared timing", () => save(true), "", { icon: "reset" }),
        );
        parent.append(actions);
    }
    const languageChoices: [string, string][] = [
        ["zh-Hans", "Chinese (Simplified)"],
        ["zh-Hant", "Chinese (Traditional)"],
        ["en", "English"],
        ["ja", "Japanese"],
        ["ko", "Korean"],
        ["ar", "Arabic"],
        ["fr", "French"],
        ["de", "German"],
        ["es", "Spanish"],
        ["ru", "Russian"],
        ["hi", "Hindi"],
    ];
    const preferenceQueue = new PreferenceQueue({
        request: () => lastRequest,
        fetch: baseFetch,
        saved: async (path) => {
            if (lifetime.isDisposed) return;
            notifications?.remove("action:preferences");
            notice(popup?.querySelector(path === "preferences" ? ".lb-save-status" : ".lb-song-save-status"), "Saved", 4000);
            if (scope) await refreshSong();
        },
        failed: (error, retry) => {
            if (!lifetime.isDisposed)
                showError(error, popup?.querySelector<HTMLElement>(".lb-display-panel") || tools, retry, { operation: "action:preferences" });
        },
    });
    const preferenceSaves = preferenceQueue.entries;
    function saveIdentity(request: Request | null = lastRequest) {
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
        if (!current) current = { preferences: { ...defaults }, itemId: trackScope().itemId };
        documentState().accountPreferences = { ...accountPreferences(), [key]: value };
        mergePreferences();
        enqueuePreference("preferences", { ...requireValue(documentState().accountPreferences) });
        refreshRows();
        if (key === "sourceLanguage") updateSongPanel();
        updateLivePreview();
        notice(popup?.querySelector<HTMLElement>(".lb-save-status"), "Saving…");
    }

    const { buildDisplay, originalLanguages, updateLanguageOptions, updateLivePreview } = createDisplayPanel({
        context: {
            get current() {
                return current;
            },
            set current(value) {
                current = value;
            },
            get popup() {
                return popup;
            },
            set popup(value) {
                popup = value;
            },
        },
        accountPreferences: (...args) => accountPreferences(...args),
        languageChoices,
        preference: (...args) => preference(...args),
        defaults,
    });

    async function capabilities() {
        const target = scope;
        if (!target) return;
        const [nextServices, nextSources] = await Promise.all([
            services.length ? services : api("services"),
            sources.length ? sources : api("sources"),
        ]);
        if (scope !== target) return;
        services = parseServices(nextServices);
        sources = parseSources(nextSources);
    }
    const { stopLanguagePlayback, drawJobDetails, buildVersionsPanel } = createVersionPanel({
        context: {
            get popup() {
                return popup;
            },
            set popup(value) {
                popup = value;
            },
            get languagePlayback() {
                return languagePlayback;
            },
            set languagePlayback(value) {
                languagePlayback = value;
            },
            get scope() {
                return scope;
            },
            set scope(value) {
                scope = value;
            },
            get current() {
                return current;
            },
            set current(value) {
                current = value;
            },
            get services() {
                return services;
            },
            set services(value) {
                services = value;
            },
        },
        documentState: (...args) => documentState(...args),
        originalLanguages: (...args) => originalLanguages(...args),
        languageChoices,
        trackScope: (...args) => trackScope(...args),
        richLines: (...args) => richLines(...args),
        auxiliary: (...args) => auxiliary(...args),
        startPlaybackPreview: (...args) => startPlaybackPreview(...args),
        notice: (...args) => notice(...args),
        api: (...args) => api(...args),
        refreshSong: (...args) => refreshSong(...args),
        showError: (...args) => showError(...args),
        confirmation: (...args) => confirmation(...args),
        status: (...args) => status(...args),
        closeSearch: (...args) => closeSearch(...args),
        openVersions: (...args) => openVersions(...args),
        importLyrics: (...args) => importLyrics(...args),
        transcribeAudio: () => transcriptionPanel.open(),
        exportLyrics: () => exportPanel.open(),
        capabilities: (...args) => capabilities(...args),
        generate: (...args) => generate(...args),
        mark: (...args) => mark(...args),
        reject: () => action("reject-matches"),
    });

    async function action(name: string) {
        const target = scope;
        try {
            await api("items/" + requireValue(target).itemId + "/" + name, "POST");
            if (scope === target) {
                await refreshSong(true);
                if (scope === target && name === "reject-matches") status("Lyrics removed", false, 4000, "action:remove-lyrics");
            }
        } catch (error) {
            if (scope === target) throw error;
            throw new DOMException("The song changed", "AbortError");
        }
    }
    async function mark(clear: boolean) {
        const target = scope;
        try {
            await api("items/" + requireValue(target).itemId + "/instrumental", "POST", { clear });
            if (scope === target) await refreshSong(true);
        } catch (error) {
            if (scope === target) throw error;
            throw new DOMException("The song changed", "AbortError");
        }
    }
    const { generate, restoreGeneration } = createGenerationController({
        scope: () => scope,
        current: () => current,
        services: () => services,
        notifications: () => notifications,
        popup: () => popup,
        tools: () => tools,
        trackScope,
        documentState,
        api,
        auxiliary,
        refreshSong,
        safeMessage,
        notice,
        status,
        showError,
        openPopup,
        drawJobDetails: (...args) => drawJobDetails(...args),
    });

    let searchUsageRefresh: (() => void) | null = null;
    const playbackPreview = new PreviewSession<TrackScope, BridgeDocument>();
    let searchSession: SearchSession<SearchQuery, SearchResults> | null = null,
        searchPlaybackBar: HTMLElement | null = null;
    function startPlaybackPreview(doc: BridgeDocument, label: string, actions: HTMLElement[]) {
        playbackPreview.begin(requireValue(scope), requireValue(current), media()?.currentTime || 0);
        if (searchPopup) searchPopup.hidden = true;
        current = doc;
        render(documentState().lyrics);
        searchPlaybackBar?.remove();
        searchPlaybackBar = e("div", "lb-preview-playback-bar");
        searchPlaybackBar.setAttribute("role", "region");
        searchPlaybackBar.setAttribute("aria-label", "Lyric version playback preview");
        searchPlaybackBar.append(e("span", "", label), ...actions);
        tools?.append(searchPlaybackBar);
        notifications?.refreshBounds();
        searchPlaybackBar.querySelector("button")?.focus();
    }
    function closeSearch(restore = true, force = false, returnToSettings = true) {
        if (!force && (searchPopup?.getAttribute("aria-busy") === "true" || !importPanel.canClose() || !transcriptionPanel.canClose())) return;
        exportPanel.dispose();
        importPanel.dispose();
        transcriptionPanel.dispose();
        if (searchPopup) feedbackScope.releaseWithin(searchPopup);
        searchUsageRefresh = null;
        searchSession?.dispose();
        searchSession = null;
        searchPopup?.remove();
        searchPopup = null;
        endPlaybackPreview(restore);
        if (force) discardWorkflowReturn();
        else if (returnToSettings) restoreWorkflowReturn();
        if (!popup && returnToSettings) settingsButton?.focus();
    }
    async function finishWorkflow() {
        const target = scope,
            panel = searchPopup;
        let failure: unknown;
        try {
            await refreshSong(true);
        } catch (error) {
            failure = error;
        }
        if (scope !== target || searchPopup !== panel) return;
        panel?.setAttribute("aria-busy", "false");
        closeSearch(false);
        if (failure)
            showError(failure, popup, () => refreshSong(true), {
                operation: "action:refresh",
                secondary: "The change was saved. Refresh lyrics to display the updated selection.",
                retryLabel: "Refresh lyrics",
            });
    }
    function endPlaybackPreview(restore = true) {
        if (searchPopup) searchPopup.hidden = false;
        searchPlaybackBar?.remove();
        searchPlaybackBar = null;
        notifications?.refreshBounds();
        const ending = playbackPreview.finish(scope, restore);
        if (ending.baseline && scope) {
            current = ending.baseline.doc;
            render(documentState().lyrics);
            if (media()) requireValue(media()).currentTime = ending.baseline.time;
            updateStatus();
        }
        if (ending.pending && scope) accept(ending.pending.data, scope, true, ending.pending.order);
        if (scope && current) updateStatus();
    }
    const exportPanel = createExportPanel({
        scope: () => scope,
        panel: () => searchPopup,
        documentState,
        mount: (panel) => {
            searchPopup = panel;
            mountDialog(panel);
        },
        beginWorkflow,
        closeSearch,
        api,
        feedback: (node, options) => feedbackScope.update(node, options),
        updatePanelBounds,
    });
    const importPanel = createImportPanel({
        scope: () => scope,
        panel: () => searchPopup,
        mount: (panel) => {
            searchPopup = panel;
            mountDialog(panel);
        },
        beginWorkflow,
        closeSearch,
        endPlaybackPreview,
        startPlaybackPreview,
        api,
        defaults,
        status: (message) => status(message, false, 4000),
        showError,
        updatePanelBounds,
        saved: () => playbackPreview.discard(),
        finishWorkflow,
        notice: (node, message, severity) => notice(node, message, 0, undefined, severity),
        feedback: (node, options) => feedbackScope.update(node, options),
    });
    const transcriptionPanel = createTranscriptionPanel({
        scope: () => scope,
        panel: () => searchPopup,
        mount: (panel) => {
            searchPopup = panel;
            mountDialog(panel);
        },
        beginWorkflow,
        closeSearch,
        endPlaybackPreview,
        startPlaybackPreview,
        documentState,
        api,
        notifications: () => notifications,
        refreshSong: () => refreshSong(true),
        saved: () => playbackPreview.discard(),
        finishWorkflow,
        updatePanelBounds,
        play: (start, end) => {
            const audio = media();
            if (!audio) return () => {};
            audio.currentTime = start / 10_000_000;
            const stop = () => {
                audio.removeEventListener("timeupdate", tick);
                audio.pause();
            };
            const tick = () => {
                if (audio.currentTime >= end / 10_000_000) stop();
            };
            audio.addEventListener("timeupdate", tick);
            void audio.play().catch(() => stop());
            return stop;
        },
    });
    async function importLyrics(existing: boolean) {
        const target = scope;
        const submit = async (text: string) => {
            try {
                await api("items/" + requireValue(target).itemId + "/import", "POST", { text, existingLocal: existing });
                if (scope !== target) return;
                playbackPreview.discard();
                await finishWorkflow();
                status("Local lyrics selected", false, 4000);
            } catch (error) {
                if (scope !== target) return;
                showError(error, popup?.querySelector<HTMLElement>(".lb-original-feedback") || searchPopup || tools);
            }
        };
        if (existing) return submit("");
        importPanel.open();
    }
    function buildMixPreview(parent: HTMLElement, donor: BridgeDocument, kind: AuxiliaryKind, target: TrackScope) {
        parent.replaceChildren(e("h3", "", "Use supplied " + kind + " from " + requireValue(donor.lyrics).source));
        const base = documentState().lyrics,
            language = documentState().preferences.translationLanguage;
        const all = (doc: RichLyrics | null | undefined) =>
            (doc?.lines ?? []).flatMap((line) => (line.background ? [line, line.background] : [line]));
        const donorLines = all(donor.lyrics),
            mapping: Record<string, string> = {},
            used = new Set<string>();
        let previous = -1;
        const text = (line: LyricLine) =>
            kind === "pronunciation"
                ? line.pronunciation
                : line.translations?.[language] ||
                  Object.entries(line.translations || {})
                      .filter(([key]) => key.split("-")[0] === language.split("-")[0])
                      .map(([, value]) => value)[0];
        const normalize = (value: string) =>
            value
                .normalize("NFKC")
                .replace(/[^\p{L}\p{N}]/gu, "")
                .toLowerCase();
        const rows = e("div", "lb-mix-lines");
        parent.append(e("p", "lb-help", "Review the mapping. Unmatched rows are skipped; original timing is retained."), rows);
        for (const line of all(base)) {
            let candidates = donorLines
                .map((l, i) => ({ l, i }))
                .filter(
                    ({ l, i }) => i > previous && !used.has(l.id) && text(l) && normalize(l.text) === normalize(line.text) && normalize(line.text),
                );
            if (candidates.length > 1 && line.start != null)
                candidates = candidates.filter(({ l }) => l.start != null && Math.abs(l.start - requireValue(line.start)) <= 5000000);
            const suggested = donor.suggestedOriginHash === requireValue(base).hash ? donor.suggestedMapping?.[line.id] : null;
            const selected = suggested
                ? donorLines.map((l, i) => ({ l, i })).find(({ l }) => l.id === suggested && text(l))
                : candidates.length === 1
                  ? candidates[0]
                  : null;
            if (selected) {
                mapping[line.id] = selected.l.id;
                used.add(selected.l.id);
                previous = selected.i;
            }
            select(
                rows,
                line.text,
                selected?.l.id || "",
                [["", "Unmatched — skip"], ...donorLines.filter(text).map((l) => [l.id, l.text + " · " + text(l)] as const)],
                (value) => {
                    if (value) mapping[line.id] = value;
                    else delete mapping[line.id];
                },
            );
        }
        const result = e("p", "lb-version-status");
        result.textContent = Object.keys(mapping).length + " matched · " + (all(base).length - Object.keys(mapping).length) + " unmatched";
        parent.append(result);
        rows.addEventListener(
            "change",
            () =>
                (result.textContent = Object.keys(mapping).length + " matched · " + (all(base).length - Object.keys(mapping).length) + " unmatched"),
        );
        parent.append(
            button(
                "Use mapped " + kind,
                async () => {
                    const workflow = searchPopup;
                    if (workflow?.getAttribute("aria-busy") === "true") return;
                    workflow?.setAttribute("aria-busy", "true");
                    const close = workflow?.querySelector<HTMLButtonElement>(".lb-popup-header button");
                    if (close) close.disabled = true;
                    notice(result, "Saving mapped rows…");
                    try {
                        await api("items/" + target.itemId + "/mix", "POST", {
                            hash: requireValue(base).hash,
                            donorHash: requireValue(donor.lyrics).hash,
                            kind,
                            language,
                            mapping,
                        });
                        if (scope !== target || searchPopup !== workflow) return;
                        await finishWorkflow();
                        status("Source rows saved", false, 4000);
                    } catch (error) {
                        if (scope === target && searchPopup === workflow) showError(error, parent);
                    } finally {
                        if (searchPopup === workflow) {
                            workflow?.setAttribute("aria-busy", "false");
                            if (close) close.disabled = false;
                        }
                    }
                },
                "",
                { icon: "check" },
            ),
        );
    }
    const { openVersions } = createSearchPanel({
        canOpen: () => importPanel.canClose() && transcriptionPanel.canClose(),
        responseOrder,
        hideImprovement: () => notifications?.remove("improvement"),
        context: {
            get scope() {
                return scope;
            },
            set scope(value) {
                scope = value;
            },
            get searchPopup() {
                return searchPopup;
            },
            set searchPopup(value) {
                searchPopup = value;
            },
            get current() {
                return current;
            },
            set current(value) {
                current = value;
            },
            get sources() {
                return sources;
            },
            set sources(value) {
                sources = value;
            },
            get searchUsageRefresh() {
                return searchUsageRefresh;
            },
            set searchUsageRefresh(value) {
                searchUsageRefresh = value;
            },
            get searchPlaybackBar() {
                return searchPlaybackBar;
            },
            set searchPlaybackBar(value) {
                searchPlaybackBar = value;
            },
            get lastRequest() {
                return lastRequest;
            },
            set lastRequest(value) {
                lastRequest = value;
            },
            get searchSession() {
                return searchSession;
            },
            set searchSession(value) {
                searchSession = value;
            },
        },
        beginWorkflow,
        closeSearch: (...args) => closeSearch(...args),
        documentState: (...args) => documentState(...args),
        api: (...args) => api(...args),
        playbackPreview,
        finishWorkflow,
        feedback: (node, options) => feedbackScope.update(node, options),
        refreshSong: (...args) => refreshSong(...args),
        updatePanelBounds: (...args) => updatePanelBounds(...args),
        metrics,
        defaults,
        buildMixPreview: (...args) => buildMixPreview(...args),
        auxiliary: (...args) => auxiliary(...args),
        status: (...args) => status(...args),
        showError: (...args) => showError(...args),
        startPlaybackPreview: (...args) => startPlaybackPreview(...args),
        sourceUsage: (...args) => sourceUsage(...args),
        languageChoices,
        baseFetch: (...args) => baseFetch(...args),
        notice: (...args) => notice(...args),
        capabilities: (...args) => capabilities(...args),
    });

    lifetime.own(
        installLyricTransport({
            begin,
            async fetch(request, itemId) {
                const target = begin(request, itemId);
                try {
                    const data = parseDocument(await api("items/" + itemId + "/lyrics"), defaults);
                    accept(data, target);
                    return new Response(
                        JSON.stringify(
                            nativePayload(
                                scope === target && (readResponseOrder(data, responseOrder) ?? 0) < target.accepted ? current?.lyrics : data.lyrics,
                            ),
                        ),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                } catch (error) {
                    if (scope === target) showError(error, tools, retry, { operation: "retrieval" });
                    return new Response(JSON.stringify(nativePayload(null)), { status: 200, headers: { "Content-Type": "application/json" } });
                }
            },
            transform(data, target, order, status) {
                if (status !== 200) {
                    if (scope === target)
                        showError(
                            {
                                message:
                                    isRecord(data) && isRecord(data.error) && typeof data.error.message === "string"
                                        ? data.error.message
                                        : "Couldn’t retrieve lyrics",
                                details: isRecord(data) ? data.error : undefined,
                            },
                            tools,
                            retry,
                            { operation: "retrieval" },
                        );
                    return data;
                }
                if (!isRecord(data) || !("state" in data || data.lyrics)) return data;
                const parsed = parseDocument(data, defaults);
                const doc = scope === target && order < target.accepted ? current?.lyrics : parsed.lyrics;
                accept(parsed, target, false, order);
                return nativePayload(doc);
            },
            error(target) {
                if (scope === target)
                    showError({ message: "Network error retrieving lyrics.", details: { code: "network_error", retryable: true } }, tools, retry, {
                        operation: "retrieval",
                    });
            },
        }),
    );
    lifetime.on(document, "lyricbridge:timing-panel", (event) => {
        if (!(event instanceof CustomEvent) || !(event.detail instanceof HTMLElement) || !scope || !isLyrics()) return;
        const panel = event.detail;
        if (!panel.isConnected || panel.querySelector(".lb-shared-timing")) return;
        const timing = disclosure("Shared timing", "lb-shared-timing", false);
        timing.root.dataset.section = "timing";
        panel.append(timing.root);
        buildSharedTiming(timing.content);
    });
    lifetime.on(document, "keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            if (searchPopup) requestWorkflowClose();
            else closePopup();
        }
    });
    // Jellyfin can hide a cached view without changing the URL. Its view
    // lifecycle owns track UI and polling, independently of preference saves.
    lifetime.on(
        document,
        "viewbeforehide",
        (event) => {
            if (!(event.target instanceof Element) || !event.target.matches(".lyricPage")) return;
            lyricViewHidden = true;
            cancel();
        },
        true,
    );
    lifetime.on(
        document,
        "viewshow",
        (event) => {
            if (!(event.target instanceof Element) || !event.target.matches(".lyricPage")) return;
            lyricViewHidden = false;
            ensureTools();
        },
        true,
    );
    lifetime.on(window, "hashchange", () => {
        if (!isLyrics()) cancel();
        else ensureTools();
    });
    // Reuse Jellyfin's own lyric button and click handler; keep it available
    // before HasLyrics is known, including the compact mobile transport bar.
    let transportButton: HTMLElement | null = null,
        transportMountObserver: MutationObserver | null = null,
        releaseTransportObserver: (() => void) | null = null;
    function updateTransportLyrics() {
        if (!transportButton?.isConnected) transportButton = document.querySelector<HTMLElement>(".nowPlayingBar .openLyricsButton");
        if (!transportButton) return;
        const audio = media(),
            video = document.querySelector("video"),
            music = !!(audio?.currentSrc || audio?.getAttribute("src")) && !(video?.currentSrc && !video.paused && !video.ended);
        transportButton.classList.toggle("lb-transport-lyrics", music);
        transportButton.setAttribute("aria-label", transportButton.title || "Lyrics");
        if (transportMountObserver) {
            releaseTransportObserver?.();
            releaseTransportObserver = null;
            transportMountObserver = null;
        }
    }
    function mountTransportLyrics() {
        updateTransportLyrics();
        if (transportButton?.isConnected || transportMountObserver || !document.body) return;
        const observer = new MutationObserver(updateTransportLyrics);
        transportMountObserver = observer;
        releaseTransportObserver = lifetime.own(() => observer.disconnect());
        transportMountObserver.observe(document.body, { childList: true, subtree: true });
    }
    for (const name of ["play", "pause", "loadedmetadata", "loadstart", "emptied", "ended"] as const)
        lifetime.on(
            document,
            name,
            (event) => {
                if (event.target instanceof HTMLMediaElement) mountTransportLyrics();
            },
            true,
        );
    lifetime.on(window, "hashchange", mountTransportLyrics);
    if (document.readyState === "loading") lifetime.on(document, "DOMContentLoaded", mountTransportLyrics, { once: true });
    else mountTransportLyrics();
    const publicApi = {
        dispose() {
            if (lifetime.isDisposed) return;
            for (const entry of preferenceSaves.values()) void flushPreference(entry);
            cancel();
            transportButton?.classList.remove("lb-transport-lyrics");
            lifetime.dispose();
            if (window.LyricBridge === publicApi) delete window.LyricBridge;
        },
        lifecycleDiagnostics: () => lifetime.snapshot(),
        decorate,
        mountTimingBar,
        rows,
        auxiliary,
        refreshRows,
        refreshSong,
        sourceUsage,
        rendererSnapshot: () => (current ? { itemId: scope?.itemId, payload: nativePayload(documentState().lyrics) } : null),
        get current() {
            return current;
        },
        get metrics() {
            return { ...metrics };
        },
    };
    window.LyricBridge = publicApi;
    return publicApi;
}
