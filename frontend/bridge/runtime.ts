import { RendererLifecycle } from "../renderer/lifecycle.ts";
import { isRecord, requireValue } from "../shared/invariants.ts";
import type { LyricLine, RichLyrics } from "../shared/lyrics.ts";
import { nativePayload, rows } from "../shared/lyrics.ts";
import type {} from "../shared/runtime.ts";
import { createApi } from "./api.ts";
import { auxiliary as auxiliaryText } from "./auxiliary.ts";
import type { BridgeDocument, ServiceCapability, SourceCapability, TrackScope } from "./contracts.ts";
import { button, e, icon, select } from "./controls.ts";
import { createDisplayPanel } from "./display-panel.ts";
import { GenerationMonitor, activeGeneration, parseGenerationJob } from "./generation-state.ts";
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
    const lifetime = new RendererLifecycle();
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
        settingsButton: HTMLButtonElement | null = null,
        popup: HTMLElement | null = null,
        searchPopup: HTMLElement | null = null,
        languagePlayback: { scope: TrackScope | null; input: HTMLElement } | null = null,
        refreshFrame = 0,
        services: ServiceCapability[] = [],
        sources: SourceCapability[] = [];
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
    const media = () => document.querySelector("audio");
    const lyricContainer = () =>
        [...document.querySelectorAll<HTMLElement>(".lyricsContainer")].filter((n) => n.getClientRects().length && !n.closest(".hide")).at(-1);
    const lyricHost = () =>
        [...document.querySelectorAll<HTMLElement>(".lyricPage")].filter((n) => n.getClientRects().length && !n.closest(".hide,[hidden]")).at(-1);
    const isLyrics = () => location.hash.includes("lyrics") || location.pathname.endsWith("demo.html");
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
        for (const timer of noticeTimers.values()) lifetime.clearTimeout(timer.timer);
        noticeTimers.clear();
        scope?.controller.abort();
        if (scope?.timer) lifetime.clearTimeout(scope.timer);
        if (scope?.loadingTimer) lifetime.clearTimeout(scope.loadingTimer);
        if (scope?.overrideTimer) lifetime.clearTimeout(scope.overrideTimer);
        scope = null;
        if (refreshFrame) lifetime.cancelFrame(refreshFrame);
        refreshFrame = 0;
        closePopup();
        closeSearch(false);
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
                window.JellyfinLyricMotion?.refreshLayout?.();
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
        if (scope !== target || (order !== undefined && order < target.accepted)) {
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
                doc?.previousSelection,
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
            if (entry.error && entry.identity === saveIdentity()) showError(entry.error, tools, () => flushPreference(entry));
        updateLanguageOptions(popup?.querySelector<HTMLElement>(".lb-display-panel"));
        if (
            renderNow &&
            (previous?.hash !== documentState().lyrics?.hash ||
                JSON.stringify(previous?.lines.map((l) => l.text)) !== JSON.stringify(documentState().lyrics?.lines.map((l) => l.text)))
        )
            render(documentState().lyrics);
        else if (renderNow) refreshRows();
        window.JellyfinLyricMotion?.setSharedTimingOffset?.(documentState().timingCorrection?.seconds || 0);
        if (previousVersions !== versionSignature(current)) updateSongPanel();
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
        updateSongPanel();
        searchUsageRefresh?.();
    }
    const noticeTimers = new Map<HTMLElement, { timer: number }>();
    function notice(node: HTMLElement | null | undefined, message: string, ttl = 0, expire: (() => void) | undefined = undefined) {
        if (!node) return;
        const old = noticeTimers.get(node);
        if (old) lifetime.clearTimeout(old.timer);
        noticeTimers.delete(node);
        node.textContent = message;
        node.hidden = !message;
        if (ttl && message) {
            const ticket = { timer: 0 };
            ticket.timer = lifetime.timeout(() => {
                if (noticeTimers.get(node) !== ticket) return;
                noticeTimers.delete(node);
                if (node.isConnected && node.textContent === message) {
                    if (expire) expire();
                    else {
                        node.textContent = "";
                        node.hidden = true;
                    }
                }
            }, ttl);
            noticeTimers.set(node, requireValue(ticket));
        }
    }
    function status(message: string, error = false, ttl = 0) {
        ensureTools();
        if (!tools) return;
        const node = tools.querySelector<HTMLElement>(".lb-status");
        notice(node, message, ttl);
        if (message) requireValue(node).prepend(icon(error ? "warning" : message.startsWith("Searching") ? "info" : "check"));
        requireValue(node).classList.toggle("lb-error", error);
    }
    function showError(cause: unknown, parent: HTMLElement | null | undefined = undefined, retryAction: () => unknown = retry) {
        const error = displayFailure(cause);
        if (error.name === "AbortError" || (error.scope && error.scope !== scope)) return;
        const host = parent?.isConnected ? parent : tools;
        if (!host) return;
        const key = error.noticeKey || error.details?.diagnosticId || error.details?.code || safeMessage(error);
        if (error.persistent && scope?.dismissedNotices?.has(key)) return;
        if (key.startsWith("job:") && scope?.dismissedJobs?.has(key.slice(4))) return;
        document.querySelectorAll<HTMLElement>('.lb-feedback[data-notice-key="' + CSS.escape(key) + '"]').forEach((n) => {
            if (n.parentNode !== host) n.remove();
        });
        let box = host.querySelector<HTMLElement>(':scope > .lb-feedback[data-notice-key="' + CSS.escape(key) + '"]');
        if (!box) {
            box = e("div", "lb-feedback");
            box.setAttribute("role", "alert");
            host.append(box);
        }
        const signature = JSON.stringify([safeMessage(error), error.details, error.providerErrors]);
        if (box.dataset.noticeSignature === signature) return;
        box.dataset.noticeSignature = signature;
        box.dataset.noticeKey = key;
        box.replaceChildren(icon("warning"), e("strong", "", safeMessage(error)));
        const d = error.details;
        if (d) {
            const details = e("details", "lb-error-details");
            details.append(
                e("summary", "", "Details"),
                e(
                    "p",
                    "",
                    `${d.code}${d.diagnosticId ? " · Reference " + d.diagnosticId : ""}${d.retryAt ? " · Retry after " + new Date(d.retryAt).toLocaleTimeString() : ""}`,
                ),
            );
            for (const sourceError of error.providerErrors || [])
                details.append(e("p", "", sourceError.message + (sourceError.diagnosticId ? " · Reference " + sourceError.diagnosticId : "")));
            box.append(details);
        }
        if (d?.code === "sign_in_required") box.append(button("Sign in", () => (location.hash = "/login")));
        else if (d?.code === "service_not_configured")
            box.append(
                button("Set up service", () => {
                    if (current?.canSelect) location.hash = "/configurationpage?name=lyricbridge";
                    else status("Ask an administrator to set up this service.", true);
                }),
            );
        else if (d?.retryable)
            box.append(
                button("Retry", () => {
                    box.remove();
                    retryAction();
                }),
            );
        if (!host.classList.contains("lb-job-banner"))
            box.append(
                button("Dismiss", () => {
                    if (error.persistent && scope) {
                        trackScope().dismissedNotices ??= new Set();
                        requireValue(trackScope().dismissedNotices).add(key);
                    }
                    if (key.startsWith("job:") && scope) {
                        trackScope().dismissedJobs ??= new Set();
                        requireValue(trackScope().dismissedJobs).add(key.slice(4));
                    }
                    if (d?.code === "local_romaji_failed" && scope) trackScope().dismissedLocalError = safeMessage(error);
                    box.remove();
                }),
            );
    }
    async function retry() {
        try {
            const target = scope;
            const data = parseDocument(await api("items/" + requireValue(target).itemId + "/retry", "POST"), defaults);
            accept(data, requireValue(target), true);
        } catch (error) {
            showError(error);
        }
    }
    function ensureTools() {
        if (!scope || !isLyrics()) return;
        const cachedHost = tools?.parentElement;
        const host = cachedHost?.isConnected && !cachedHost.closest(".hide,[hidden]") ? cachedHost : lyricHost();
        if (!host) return;
        if (tools?.isConnected) {
            if (tools.parentNode !== host) host.append(tools);
            if (settingsButton && settingsButton.parentNode !== host) host.append(settingsButton);
            return;
        }
        tools = e("div", "lb-tools");
        tools.setAttribute("aria-label", "Lyrics controls");
        const state = e("span", "lb-status", "");
        state.hidden = true;
        state.setAttribute("role", "status");
        state.setAttribute("aria-live", "polite");
        settingsButton = button(
            "Lyrics settings",
            () => {
                if (popup) closePopup();
                else openPopup();
            },
            "lb-settings-trigger",
        );
        tools.append(state);
        host.append(tools, settingsButton);
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
        if (documentState().state === "ready" && documentState().pronunciation?.state !== "failed")
            tools?.querySelector<HTMLElement>(":scope > .lb-feedback")?.remove();
        const messages: Record<string, string> = {
            searching: `Searching… ${documentState().finished || 0}/${documentState().total || 0} sources`,
            ready: "",
            partial: "",
            instrumental: "",
            rejected: "No correct lyric match selected",
            missing: "No lyrics found",
            failed: "No lyrics available (some sources failed)",
        };
        const initialWait = documentState().state === "searching" && performance.now() - requireValue(trackScope().loadingStarted) < 300;
        status(initialWait ? "" : (messages[documentState().state ?? ""] ?? ""), documentState().state === "failed");
        if (documentState().state !== "searching" && trackScope().loadingTimer) lifetime.clearTimeout(requireValue(trackScope().loadingTimer));
        requireValue(tools)
            .querySelectorAll<HTMLElement>(".lb-upgrade,.lb-retry,.lb-source-note,.lb-provider-details,.lb-local-status")
            .forEach((n) => n.remove());
        document.querySelectorAll<HTMLElement>(".lb-instrumental-view").forEach((n) => n.remove());
        if (documentState().state === "instrumental") {
            const message = e("div", "lb-instrumental-view", "Instrumental music, please enjoy.");
            message.setAttribute("role", "status");
            lyricHost()?.append(message);
            if (lyricContainer()?.querySelector<HTMLElement>(".lyricsLine")) render(null);
        }
        if (["missing", "failed", "rejected"].includes(requireValue(documentState().state)))
            requireValue(tools).append(button("Search again", retry, "lb-retry"));
        const providerKey =
            documentState().state === "partial" && documentState().errors?.length
                ? "providers:" +
                  requireValue(documentState().errors)
                      .map((error) => error.diagnosticId || error.code + ":" + error.message)
                      .sort()
                      .join("|")
                : null;
        requireValue(tools)
            .querySelectorAll<HTMLElement>(":scope > .lb-feedback")
            .forEach((node) => {
                if (node.dataset.noticeKey?.startsWith("providers:") && node.dataset.noticeKey !== providerKey) node.remove();
            });
        if (providerKey)
            showError(
                {
                    message: "Some lyric sources failed. Available lyrics were retained.",
                    details: { code: "partial_provider_failure", retryable: true },
                    providerErrors: documentState().errors,
                    noticeKey: providerKey,
                    persistent: true,
                },
                tools,
            );
        if (documentState().errors?.length && documentState().state !== "partial") {
            const d = e("details", "lb-provider-details");
            d.append(e("summary", "", "Source details"));
            requireValue(documentState().errors).forEach((error) =>
                d.append(e("p", "", error.message + (error.diagnosticId ? " · Reference " + error.diagnosticId : ""))),
            );
            requireValue(tools).append(d);
        }
        if (
            documentState().better &&
            trackScope().dismissedUpgrade !==
                (requireValue(documentState().better).hash ||
                    requireValue(documentState().better).source + ":" + requireValue(documentState().better).providerId)
        ) {
            requireValue(tools).append(
                button(
                    documentState().improvement?.reason === "recording-match"
                        ? "Better recording match available — Preview"
                        : "Better timing available — Preview",
                    () => openVersions(requireValue(documentState().better)),
                    "lb-upgrade lb-primary",
                ),
            );
            requireValue(tools).append(
                button(
                    "Dismiss timing offer",
                    () => {
                        trackScope().dismissedUpgrade =
                            requireValue(documentState().better).hash ||
                            requireValue(documentState().better).source + ":" + requireValue(documentState().better).providerId;
                        updateStatus();
                    },
                    "lb-upgrade",
                ),
            );
            if (!documentState().canSelect) requireValue(tools).append(e("span", "lb-source-note", "An administrator must apply this upgrade."));
        }
        if (documentState().pronunciation?.state === "running" || documentState().pronunciation?.state === "queued")
            requireValue(tools).append(e("span", "lb-local-status", "Generating pronunciation…"));
        if (
            documentState().pronunciation?.state === "failed" &&
            trackScope().dismissedLocalError !== requireValue(documentState().pronunciation).error
        )
            showError(
                { message: requireValue(documentState().pronunciation).error, details: { code: "local_romaji_failed", retryable: true } },
                null,
                async () => {
                    try {
                        await api("items/" + trackScope().itemId + "/pronunciation", "POST", {
                            hash: requireValue(documentState().lyrics).hash,
                            includeSupplied: documentState().auxiliaryChoices?.pronunciation !== "auto",
                            retry: true,
                        });
                        await refreshSong();
                    } catch (error) {
                        showError(error);
                    }
                },
            );
    }
    function closePopup() {
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
        if (popup) {
            if (typeof tabName === "string") activateSettingsTab(tabName);
            else closePopup();
            return;
        }
        popup = e("section", "lb-popup lb-settings-panel");
        popup.setAttribute("role", "dialog");
        popup.setAttribute("aria-label", "Lyrics settings");
        const head = e("header", "lb-popup-header");
        head.append(e("h2", "", current?.track?.title || current?.lyrics?.title || "Lyrics settings"), button("Close", closePopup));
        const tabs = e("div", "lb-tabs");
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("aria-label", "Lyrics settings");
        const body = e("div", "lb-panel-body");
        for (const [name, cls] of [
            ["Song", "lb-song-panel"],
            ["Display", "lb-display-panel"],
            ["Versions", "lb-versions-panel"],
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
        popup.append(head, tabs, body);
        document.body.append(popup);
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
        parent.querySelector<HTMLElement>(":scope > .lb-confirmation")?.remove();
        const box = e("div", "lb-confirmation");
        box.setAttribute("role", "alert");
        box.append(e("p", "", message));
        const actions = e("div", "lb-song-actions");
        const cancel = button("Cancel", () => {
            box.remove();
            trigger?.focus();
        });
        const confirm = button(
            label,
            async () => {
                confirm.disabled = true;
                try {
                    await action();
                    box.remove();
                } catch (error) {
                    showError(error, box);
                    confirm.disabled = false;
                }
            },
            "lb-danger",
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
        };
    }
    function songPreference(key: "sourceLanguage" | "translationLanguage", value: string) {
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
    function updateSongPanel() {
        if (playbackPreview.baseline) return;
        const parent = popup?.querySelector<HTMLElement>(".lb-song-panel");
        if (!parent) return;
        if (!parent.contains(document.activeElement)) buildSongSummary(parent);
        buildVersionsPanel();
    }
    function buildSongSummary(parent: HTMLElement) {
        const expanded = [...parent.querySelectorAll<HTMLDetailsElement>("details[open]")].map((n) => n.dataset.section);
        parent.replaceChildren();
        const doc = current?.lyrics;
        const stateText: Record<string, string> = {
            instrumental: "Instrumental — no sung lyrics",
            missing: "No lyrics found",
            failed: "Lyrics could not be retrieved",
            rejected: "Automatic matching paused",
            searching: "Searching for lyrics…",
        };
        const summary = e("section", "lb-setting-group");
        summary.append(e("h3", "", "Playing now"));
        parent.append(summary);
        if (doc) {
            for (const [title, value, kind] of [
                ["Original", doc.source + " · " + (doc.wordTimed ? "Word timing" : "Line / plain lyrics"), "original"],
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
                    ),
                );
                summary.append(row);
            }
            const timing = button("Adjust timing", () => {
                closePopup();
                document.querySelector<HTMLElement>(".ak-lyrics-timing-chip")?.click();
            });
            summary.append(timing);
        } else {
            summary.append(e("p", "", stateText[current?.state ?? ""] || "Lyrics are loading. Display settings are available."));
            if (current?.state === "instrumental")
                summary.append(e("small", "lb-help", "Reported by " + (documentState().instrumental?.[0]?.source || "provider")));
            const actions = e("div", "lb-song-actions");
            actions.append(
                button("Find lyrics", () => openVersions()),
                button("Search again", retry),
            );
            if (current?.canSelect) actions.append(button("Import lyrics", () => importLyrics(false)));
            summary.append(actions);
        }
        const language = e("section", "lb-setting-group");
        language.append(e("h3", "", "Languages for this song"), e("p", "lb-help", "Your account"));
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
        const save = e("p", "lb-song-save-status");
        save.setAttribute("role", "status");
        language.append(save);
        const reset = button("Reset song language overrides", async () => {
            const target = scope;
            documentState().songOverrides = { sourceLanguage: null, translationLanguage: null };
            requireValue(target).overrideDirty = true;
            requireValue(target).overrideRevision = (requireValue(target).overrideRevision || 0) + 1;
            mergePreferences();
            refreshRows();
            await saveSongPreferences(requireValue(target));
            if (scope === target) buildSongSummary(parent);
        });
        reset.disabled = !overrides.sourceLanguage && !overrides.translationLanguage;
        language.append(reset);
        const timing = e("details", "lb-setting-group");
        timing.dataset.section = "timing";
        timing.append(e("summary", "", "Shared timing"));
        parent.append(timing);
        buildSharedTiming(timing);
        if (current?.canSelect) {
            const more = e("details", "lb-setting-group lb-task-surface");
            more.dataset.section = "maintenance";
            more.append(e("summary", "", "Song maintenance"));
            parent.append(more);
            const maintenanceActions = e("div", "lb-song-actions");
            more.append(maintenanceActions);
            const markButton = button(documentState().state === "instrumental" ? "Clear instrumental mark" : "Mark instrumental", () =>
                confirmation(
                    more,
                    "Change the instrumental classification for everyone?",
                    () => mark(documentState().state === "instrumental"),
                    "Confirm classification",
                    markButton,
                ),
            );
            maintenanceActions.append(markButton);
            if (documentState().previousSelection)
                maintenanceActions.append(
                    button("Revert previous selection", () =>
                        confirmation(more, "Restore the previous library selection for everyone?", () => action("revert"), "Revert selection"),
                    ),
                );
        }
        parent.querySelectorAll("details").forEach((n) => (n.open = expanded.includes(n.dataset.section)));
    }
    function buildSharedTiming(parent: HTMLElement) {
        const shared = current?.timingCorrection?.seconds || 0;
        parent.append(e("p", "lb-help", "Shared: " + shared.toFixed(1) + " s. Your timing adjustment is additional."));
        if (!current?.lyrics || !documentState().canSelect || !documentState().timingFingerprint) return;
        const feedback = e("p", "lb-version-status");
        parent.append(feedback);
        async function save(reset: boolean) {
            const target = trackScope(),
                motion = window.JellyfinLyricMotion,
                seconds = reset ? 0 : shared + (motion?.timing?.().seconds || 0);
            notice(feedback, "Saving…");
            try {
                await api("items/" + target.itemId + "/timing", "POST", {
                    hash: requireValue(documentState().lyrics).hash,
                    fingerprint: documentState().timingFingerprint,
                    seconds,
                });
                if (scope !== target) return;
                if (!reset) motion?.setTimingOffset?.(0, true, false);
                await refreshSong();
                status("Shared timing correction saved", false, 4000);
            } catch (error) {
                showError(error, parent);
            }
        }
        const actions = e("div", "lb-song-actions");
        actions.append(
            button("Save timing for everyone", () => save(false)),
            button("Reset shared timing", () => save(true)),
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
            notice(popup?.querySelector(path === "preferences" ? ".lb-save-status" : ".lb-song-save-status"), "Saved", 4000);
            if (scope) await refreshSong();
        },
        failed: (error, retry) => {
            if (!lifetime.isDisposed) showError(error, popup?.querySelector<HTMLElement>(".lb-display-panel") || tools, retry);
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
        mark: (...args) => mark(...args),
        importLyrics: (...args) => importLyrics(...args),
        action: (...args) => action(...args),
        capabilities: (...args) => capabilities(...args),
        generate: (...args) => generate(...args),
    });

    async function action(name: string) {
        const target = scope;
        try {
            await api("items/" + requireValue(target).itemId + "/" + name, "POST");
            if (scope === target) await refreshSong(true);
        } catch (error) {
            if (scope === target) showError(error, popup?.querySelector<HTMLElement>("[role=tabpanel]:not([hidden])") || tools);
        }
    }
    async function mark(clear: boolean) {
        const target = scope;
        try {
            await api("items/" + requireValue(target).itemId + "/instrumental", "POST", { clear });
            if (scope === target) await refreshSong(true);
        } catch (error) {
            if (scope === target) showError(error, popup?.querySelector<HTMLElement>("[role=tabpanel]:not([hidden])") || tools);
        }
    }
    async function generate(kind: AuxiliaryKind, service: string, parent: HTMLElement, forceNew = false) {
        const target = trackScope(),
            text = e("p", "lb-job-status", "Submitting…");
        text.setAttribute("role", "status");
        parent.append(text);
        try {
            if (kind === "pronunciation" && !services.find((s) => s.service === service)?.pronunciation)
                throw new Error("This service cannot generate pronunciation.");
            if (forceNew && (!documentState().auxiliaryChoices?.[kind] || requireValue(documentState().auxiliaryChoices)[kind] === "auto")) {
                const previous = requireValue(documentState().lyrics)
                    .lines.map((line) => auxiliary(line, kind, documentState().preferences))
                    .find((value) => value?.key);
                if (previous) {
                    await api("items/" + target.itemId + "/language-version", "POST", {
                        hash: requireValue(documentState().lyrics).hash,
                        kind,
                        key: previous.key,
                    });
                    if (scope !== target) return;
                    documentState().auxiliaryChoices = {
                        ...{ translation: "auto", pronunciation: "auto", ...current?.auxiliaryChoices },
                        [kind]: previous.key,
                    };
                }
            }
            const options: Record<string, string | number> = {};
            for (const input of parent.querySelectorAll<HTMLInputElement>("[data-generation-key]"))
                if (!requireValue(input.closest<HTMLElement>(".lb-field")).hidden && input.value !== "" && input.value !== "inherit")
                    options[requireValue(input.dataset.generationKey)] = input.type === "number" ? Number(input.value) : input.value;
            const thinking = parent.querySelector<HTMLSelectElement>('[data-generation-key="reasoningEffort"]');
            if (service === "AI" && thinking?.value === "") options.reasoningEffort = "";
            const job = parseGenerationJob(
                await api("items/" + target.itemId + "/generate", "POST", {
                    ...options,
                    kind,
                    language: documentState().preferences.translationLanguage,
                    service,
                    forceNew,
                }),
            );
            if (scope !== target) return;
            if (job.state === "cached") {
                await refreshSong();
                status("Cached result ready", false, 4000);
                return;
            }
            if (target.jobs?.has(job.id)) {
                notice(text, "Request already in progress");
                return;
            }
            text.textContent = job.state === "pending" ? "Awaiting administrator approval" : "Queued";
            const banner = e("div", "lb-job-banner"),
                progress = e("span", "lb-job-progress", text.textContent);
            banner.setAttribute("role", "status");
            banner.dataset.jobId = job.id;
            banner.append(progress);
            tools?.querySelector<HTMLElement>('[data-job-id="' + job.id + '"]')?.remove();
            tools?.append(banner);
            const dismiss = button("Dismiss", () => {
                target.dismissedJobs ??= new Set();
                target.dismissedJobs.add(job.id);
                banner.remove();
            });
            const retryJob = async () => {
                try {
                    await api("jobs/" + job.id + "/retry", "POST");
                    if (scope !== target) return;
                    target.dismissedJobs?.delete(job.id);
                    dismiss.hidden = true;
                    banner.querySelector<HTMLElement>(".lb-feedback")?.remove();
                    poll();
                } catch (error) {
                    if (scope !== target) return;
                    showError(error, banner, retryJob);
                    dismiss.hidden = false;
                }
            };
            const monitor = new GenerationMonitor({
                signal: target.controller.signal,
                read: async (signal) => parseGenerationJob(await api("jobs/" + job.id, "GET", undefined, signal)),
                changed: async (next) => {
                    if (scope !== target || !next) return;
                    requireValue(target.jobs).set(job.id, next);
                    notice(text, next.request.service + " · " + next.state + " · " + next.progress + "%");
                    notice(progress, text.textContent);
                    const active = activeGeneration(next);
                    cancelButton.hidden = !active;
                    parentCancel.hidden = !active;
                    dismiss.hidden = false;
                    const detailHost = popup?.querySelector<HTMLElement>('[data-song-kind="' + kind + '"]');
                    if (detailHost?.getClientRects().length)
                        drawJobDetails(detailHost.querySelector<HTMLElement>(".lb-generation") || detailHost, kind);
                    else if ((next.failure || next.error) && !target.dismissedJobs?.has(job.id))
                        showError(
                            { message: next.failure?.message || next.error, details: next.failure, noticeKey: "job:" + job.id },
                            banner,
                            retryJob,
                        );
                    if (next.state === "complete") {
                        notice(progress, "Language rows ready", 4000, () => banner.remove());
                        notice(text, "Language rows ready", 4000);
                        await refreshSong();
                        return;
                    }
                    if (next.state === "cancelled" && !next.failure && !next.error) {
                        notice(progress, "Generation cancelled", 4000, () => banner.remove());
                        notice(text, "Generation cancelled", 4000);
                        return;
                    }
                },
                failed: (error, retry) => {
                    if (scope !== target) return;
                    showError(error, banner, retry);
                    dismiss.hidden = false;
                },
            });
            const poll = monitor.poll;
            const cancelJob = () =>
                api("jobs/" + job.id + "/cancel", "POST")
                    .then(poll)
                    .catch((error) => showError(error, banner));
            const parentCancel = button("Cancel request", cancelJob),
                cancelButton = button("Cancel request", cancelJob);
            parent.append(parentCancel);
            banner.append(
                button("Details", () => {
                    openPopup("Versions");
                    requireValue(popup)
                        .querySelector<HTMLElement>('[data-song-kind="' + kind + '"]')
                        ?.scrollIntoView({ block: "nearest" });
                }),
                cancelButton,
                dismiss,
            );
            target.jobs ??= new Map();
            target.jobActions ??= new Map();
            target.jobs.set(job.id, job);
            target.jobActions.set(job.id, { retry: retryJob, cancel: cancelJob });
            poll();
        } catch (error) {
            text.textContent = "";
            showError(error, parent);
        }
    }

    let searchUsageRefresh: (() => void) | null = null;
    const playbackPreview = new PreviewSession<TrackScope, BridgeDocument>();
    let searchSession: SearchSession<SearchQuery, SearchResults> | null = null,
        searchPlaybackBar: HTMLElement | null = null;
    function startPlaybackPreview(doc: BridgeDocument, label: string, actions: HTMLElement[]) {
        playbackPreview.begin(requireValue(scope), requireValue(current), media()?.currentTime || 0);
        current = doc;
        render(documentState().lyrics);
        searchPlaybackBar?.remove();
        searchPlaybackBar = e("div", "lb-preview-playback-bar");
        searchPlaybackBar.setAttribute("role", "region");
        searchPlaybackBar.setAttribute("aria-label", "Lyric version playback preview");
        searchPlaybackBar.append(e("span", "", label), ...actions);
        tools?.append(searchPlaybackBar);
        searchPlaybackBar.querySelector("button")?.focus();
    }
    function closeSearch(restore = true) {
        searchUsageRefresh = null;
        searchPlaybackBar?.remove();
        searchPlaybackBar = null;
        searchSession?.dispose();
        searchSession = null;
        searchPopup?.remove();
        searchPopup = null;
        const ending = playbackPreview.finish(scope, restore);
        if (ending.baseline && scope) {
            current = ending.baseline.doc;
            render(documentState().lyrics);
            if (media()) requireValue(media()).currentTime = ending.baseline.time;
            updateStatus();
        }
        if (ending.pending && scope) accept(ending.pending.data, scope, true, ending.pending.order);
        settingsButton?.focus();
    }
    async function importLyrics(existing: boolean) {
        const target = scope;
        const submit = async (text: string) => {
            try {
                await api("items/" + requireValue(target).itemId + "/import", "POST", { text, existingLocal: existing });
                if (scope !== target) return;
                playbackPreview.discard();
                closeSearch(false);
                await refreshSong(true);
                status("Local lyrics selected", false, 4000);
            } catch (error) {
                showError(error, searchPopup || popup || tools);
            }
        };
        if (existing) return submit("");
        const input = e("input");
        input.type = "file";
        input.accept = ".lrc,.txt,.qrc,.yrc,.ttml";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 1000000) {
                showError(new Error("Choose a lyric file up to 1 MB."), searchPopup || tools);
                return;
            }
            await submit(await file.text());
        };
        input.click();
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
            button("Use mapped " + kind, async () => {
                notice(result, "Saving mapped rows…");
                try {
                    await api("items/" + target.itemId + "/mix", "POST", {
                        hash: requireValue(base).hash,
                        donorHash: requireValue(donor.lyrics).hash,
                        kind,
                        language,
                        mapping,
                    });
                    if (scope !== target) return;
                    closeSearch(false);
                    await refreshSong();
                    status("Source rows saved", false, 4000);
                } catch (error) {
                    showError(error, parent);
                }
            }),
        );
    }
    const { openVersions } = createSearchPanel({
        responseOrder,
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
        closePopup: (...args) => closePopup(...args),
        closeSearch: (...args) => closeSearch(...args),
        documentState: (...args) => documentState(...args),
        confirmation: (...args) => confirmation(...args),
        api: (...args) => api(...args),
        playbackPreview,
        refreshSong: (...args) => refreshSong(...args),
        render: (...args) => render(...args),
        importLyrics: (...args) => importLyrics(...args),
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
                    if (scope === target) showError(error);
                    return new Response(JSON.stringify(nativePayload(null)), { status: 200, headers: { "Content-Type": "application/json" } });
                }
            },
            transform(data, target, order, status) {
                if (status !== 200) {
                    if (scope === target)
                        showError({
                            message:
                                isRecord(data) && isRecord(data.error) && typeof data.error.message === "string"
                                    ? data.error.message
                                    : "Couldn’t retrieve lyrics",
                            details: isRecord(data) ? data.error : undefined,
                        });
                    return data;
                }
                if (!isRecord(data) || !("state" in data || data.lyrics)) return data;
                const parsed = parseDocument(data, defaults);
                const doc = scope === target && order < target.accepted ? current?.lyrics : parsed.lyrics;
                accept(parsed, target, false, order);
                return nativePayload(doc);
            },
            error(target) {
                if (scope === target) showError({ message: "Network error retrieving lyrics.", details: { code: "network_error", retryable: true } });
            },
        }),
    );
    lifetime.on(document, "keydown", (event) => {
        if (event.key === "Escape") {
            closePopup();
            closeSearch();
        }
    });
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
