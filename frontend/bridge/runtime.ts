import type {} from "../platform/globals.ts";
import type {} from "../platform/globals.ts";
import { FeedbackScope, confirmFeedback } from "../shared/feedback.ts";
import { isRecord, requireValue } from "../shared/invariants.ts";
import { Lifecycle } from "../shared/lifecycle.ts";
import { nativePayload, rows } from "../shared/lyrics.ts";
import { createTransportControls } from "./host/transport-controls.ts";
import { createGenerationController } from "./jobs/generation-controller.ts";
import { createLyricPresentation } from "./lyrics/presentation.ts";
import { createPreferenceController } from "./preferences/controller.ts";
import { createSongSection } from "./preferences/song-section.ts";
import { createCatalogController } from "./services/catalog-controller.ts";
import { createTrackSession } from "./session/track-session.ts";
import { createExportPanel } from "./transfer/export-panel.ts";
import { rendererPort } from "./transport/renderer-port.ts";
import { feedbackHost, glassFeedback } from "./ui/feedback.ts";
import { createPlaybackFeedback } from "./ui/playback-feedback.ts";
import { createSettingsPanel } from "./ui/settings-panel.ts";
import { createWorkflowNavigation } from "./ui/workflow-navigation.ts";
import { createMixSection } from "./versions/mix-section.ts";

import type { Preferences } from "../contracts/preferences.ts";
import { createDisplayPanel } from "./preferences/display-panel.ts";
import { PlaybackPreview } from "./preview/playback-preview.ts";
import type { SearchQuery, SearchResults } from "./search/search-models.ts";
import { createSearchPanel } from "./search/search-panel.ts";
import type { SearchSession } from "./search/search-session.ts";
import { sourceUsage } from "./search/source-usage.ts";
import { createTranscriptionPanel } from "./transcription/panel.ts";
import { createImportPanel } from "./transfer/import-panel.ts";
import { createApi } from "./transport/api.ts";
import { parseDocument, responseOrder as readResponseOrder } from "./transport/responses.ts";
import { installLyricTransport } from "./transport/transport.ts";
import { button, disclosure } from "./ui/controls.ts";
import { mountDialog } from "./ui/dialog.ts";
import { createVersionPanel } from "./versions/version-panel.ts";
/* LyricBridge: track-scoped multilingual transport and accessible lyric controls. */
export function installBridge() {
    "use strict";
    if (window.LyricBridge) return;
    const lifetime = new Lifecycle();
    const feedbackScope = new FeedbackScope(glassFeedback);
    const baseFetch = window.fetch.bind(window);
    const defaults: Preferences = {
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
    const trackSession = createTrackSession({
        beforeRelease() {
            rendererPort()?.setSharedTimingOffset?.(0);
            document.querySelectorAll<HTMLElement>(".lb-instrumental-view").forEach((n) => n.remove());
            playbackFeedback.notifications?.dispose();
            playbackFeedback.replaceNotifications(null);
            playbackFeedback.replaceUnattributedErrors(new WeakMap());
            feedbackScope.dispose();
        },
        afterRelease() {
            if (lyricPresentation.refreshFrame) lifetime.cancelFrame(lyricPresentation.refreshFrame);
            lyricPresentation.replaceRefreshFrame(0);
            discardWorkflowReturn();
            closePopup();
            closeSearch(false, true, false);
            playbackFeedback.settingsButton?.remove();
            playbackFeedback.replaceSettingsButton(null);
            playbackFeedback.tools?.remove();
            playbackFeedback.replaceTools(null);
        },
        discardOtherAccounts: () => discardOtherAccounts(),
        reportPreferenceFailures: () => reportPreferenceFailures(),
        refreshLanguageOptions: () => updateLanguageOptions(settingsPanel.popup?.querySelector<HTMLElement>(".lb-display-panel")),
        hasLyricRows: () => !!lyricContainer()?.querySelector(".lyricsLine"),
        get lifetime() {
            return lifetime;
        },
        saveIdentity: (...args) => saveIdentity(...args),
        ensureTools: (...args) => ensureTools(...args),
        get services() {
            return catalog.services;
        },
        set services(value) {
            catalog.replaceServices(value);
        },
        get sources() {
            return catalog.sources;
        },
        set sources(value) {
            catalog.replaceSources(value);
        },
        updateStatus: (...args) => updateStatus(...args),
        status: (...args) => status(...args),
        get responseOrder() {
            return responseOrder;
        },
        get lyricViewHidden() {
            return lyricPresentation.lyricViewHidden;
        },
        set lyricViewHidden(value) {
            lyricPresentation.replaceLyricViewHidden(value);
        },
        get metrics() {
            return metrics;
        },
        get playbackPreview() {
            return playbackPreview;
        },
        pendingPreference: (...args) => pendingPreference(...args),
        get defaults() {
            return defaults;
        },
        mergePreferences: (...args) => mergePreferences(...args),
        get lyricView() {
            return lyricView;
        },
        showError: (...args) => showError(...args),
        render: (...args) => render(...args),
        refreshRows: (...args) => refreshRows(...args),
        updateSongPanel: (...args) => updateSongPanel(...args),
        isLyrics: (...args) => isLyrics(...args),
        restoreGeneration: (...args) => restoreGeneration(...args),
        get transcriptionPanel() {
            return transcriptionPanel;
        },
        api: (...args) => api(...args),
        get searchUsageRefresh() {
            return searchUsageRefresh;
        },
        set searchUsageRefresh(value) {
            searchUsageRefresh = value;
        },
    });
    const { documentState, trackScope, cancel, begin, accept, refreshSong } = trackSession;

    const playbackFeedback = createPlaybackFeedback({
        get feedbackScope() {
            return feedbackScope;
        },
        retry: (...args) => retry(...args),
        get trackSession() {
            return trackSession;
        },
        safeMessage: (...args) => safeMessage(...args),
        trackScope: (...args) => trackScope(...args),
        isLyrics: (...args) => isLyrics(...args),
        lyricHost: (...args) => lyricHost(...args),
        get settingsPanel() {
            return settingsPanel;
        },
        closePopup: (...args) => closePopup(...args),
        openPopup: (...args) => openPopup(...args),
        documentState: (...args) => documentState(...args),
        get lifetime() {
            return lifetime;
        },
        lyricContainer: (...args) => lyricContainer(...args),
        render: (...args) => render(...args),
        get searchPopup() {
            return searchPopup;
        },
        set searchPopup(value) {
            searchPopup = value;
        },
        openVersions: (...args) => openVersions(...args),
        api: (...args) => api(...args),
        refreshSong: (...args) => refreshSong(...args),
    });
    const { notice, status, showError, ensureTools, mountTimingBar, updateStatus } = playbackFeedback;

    const settingsPanel = createSettingsPanel({
        get feedbackScope() {
            return feedbackScope;
        },
        stopLanguagePlayback: (...args) => stopLanguagePlayback(...args),
        get settingsButton() {
            return playbackFeedback.settingsButton;
        },
        set settingsButton(value) {
            playbackFeedback.replaceSettingsButton(value);
        },
        get searchPopup() {
            return searchPopup;
        },
        set searchPopup(value) {
            searchPopup = value;
        },
        requestWorkflowClose: (...args) => requestWorkflowClose(...args),
        get importPanel() {
            return importPanel;
        },
        get transcriptionPanel() {
            return transcriptionPanel;
        },
        get trackSession() {
            return trackSession;
        },
        updateSongPanel: (...args) => updateSongPanel(...args),
        buildDisplay: (...args) => buildDisplay(...args),
        get lifetime() {
            return lifetime;
        },
    });
    const { closePopup, updatePanelBounds, activateSettingsTab, openPopup } = settingsPanel;
    let searchPopup: HTMLElement | null = null;
    const lyricPresentation = createLyricPresentation({
        get defaults() {
            return defaults;
        },
        get trackSession() {
            return trackSession;
        },
        get metrics() {
            return metrics;
        },
        ensureTools: (...args) => ensureTools(...args),
        get searchUsageRefresh() {
            return searchUsageRefresh;
        },
        set searchUsageRefresh(value) {
            searchUsageRefresh = value;
        },
        get lifetime() {
            return lifetime;
        },
        media: (...args) => media(...args),
        mountTimingBar: (...args) => mountTimingBar(...args),
    });
    const { lyricContainer, isLyrics, lyricView, decorate, auxiliary, refreshRows, render } = lyricPresentation;
    const catalog = createCatalogController({
        get trackSession() {
            return trackSession;
        },
        api: (...args) => api(...args),
        get defaults() {
            return defaults;
        },
        accept: (...args) => accept(...args),
        showError: (...args) => showError(...args),
        get tools() {
            return playbackFeedback.tools;
        },
        set tools(value) {
            playbackFeedback.replaceTools(value);
        },
        refreshSong: (...args) => refreshSong(...args),
        status: (...args) => status(...args),
    });
    const { retry, capabilities, action, mark } = catalog;

    const { discardWorkflowReturn, beginWorkflow, requestWorkflowClose, startPlaybackPreview, closeSearch, finishWorkflow, endPlaybackPreview } =
        createWorkflowNavigation({
            get feedbackScope() {
                return feedbackScope;
            },
            get trackSession() {
                return trackSession;
            },
            get searchPopup() {
                return searchPopup;
            },
            set searchPopup(value) {
                searchPopup = value;
            },
            get importPanel() {
                return importPanel;
            },
            get transcriptionPanel() {
                return transcriptionPanel;
            },
            get popup() {
                return settingsPanel.popup;
            },
            set popup(value) {
                settingsPanel.replacePopup(value);
            },
            stopLanguagePlayback: (...args) => stopLanguagePlayback(...args),
            isLyrics: (...args) => isLyrics(...args),
            get lyricViewHidden() {
                return lyricPresentation.lyricViewHidden;
            },
            set lyricViewHidden(value) {
                lyricPresentation.replaceLyricViewHidden(value);
            },
            updateSongPanel: (...args) => updateSongPanel(...args),
            buildDisplay: (...args) => buildDisplay(...args),
            activateSettingsTab: (...args) => activateSettingsTab(...args),
            updatePanelBounds: (...args) => updatePanelBounds(...args),
            openPopup: (...args) => openPopup(...args),
            get exportPanel() {
                return exportPanel;
            },
            get searchUsageRefresh() {
                return searchUsageRefresh;
            },
            set searchUsageRefresh(value) {
                searchUsageRefresh = value;
            },
            get searchSession() {
                return searchSession;
            },
            set searchSession(value) {
                searchSession = value;
            },
            get settingsButton() {
                return playbackFeedback.settingsButton;
            },
            set settingsButton(value) {
                playbackFeedback.replaceSettingsButton(value);
            },
            refreshSong: (...args) => refreshSong(...args),
            showError: (...args) => showError(...args),
            get previewController() {
                return previewController;
            },
        });

    const metrics = { decorations: 0, requests: 0, stale: 0, searchRowUpdates: 0, searchSorts: 0, maxSearchPaintMs: 0 };
    const responseOrder = Symbol("lyric-response-order");
    const media = () => document.querySelector("audio");

    const lyricHost = () =>
        [...document.querySelectorAll<HTMLElement>(".lyricPage")].filter((n) => n.getClientRects().length && !n.closest(".hide,[hidden]")).at(-1);

    function safeMessage(error: unknown) {
        return (
            (error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "") ||
            "The lyric action failed. Please retry."
        );
    }
    const api = createApi({
        request: () => trackSession.lastRequest,
        scope: () => trackSession.scope,
        fetch: baseFetch,
        responseOrder,
        received: () => metrics.requests++,
    });

    lifetime.on(window, "resize", updatePanelBounds);
    if (window.visualViewport) lifetime.on(window.visualViewport, "resize", updatePanelBounds);

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
    const {
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
        preference,
    } = createPreferenceController({
        get defaults() {
            return defaults;
        },
        get trackSession() {
            return trackSession;
        },
        documentState: (...args) => documentState(...args),
        trackScope: (...args) => trackScope(...args),
        refreshRows: (...args) => refreshRows(...args),
        updateLanguageOptions: (...args) => updateLanguageOptions(...args),
        get popup() {
            return settingsPanel.popup;
        },
        set popup(value) {
            settingsPanel.replacePopup(value);
        },
        updateSongPanel: (...args) => updateSongPanel(...args),
        notice: (...args) => notice(...args),
        updateLivePreview: (...args) => updateLivePreview(...args),
        baseFetch: (...args) => baseFetch(...args),
        get lifetime() {
            return lifetime;
        },
        get notifications() {
            return playbackFeedback.notifications;
        },
        set notifications(value) {
            playbackFeedback.replaceNotifications(value);
        },
        refreshSong: (...args) => refreshSong(...args),
        showError: (...args) => showError(...args),
        get tools() {
            return playbackFeedback.tools;
        },
        set tools(value) {
            playbackFeedback.replaceTools(value);
        },
    });

    const { updateSongPanel, buildSharedTiming } = createSongSection({
        get playbackPreview() {
            return playbackPreview;
        },
        get popup() {
            return settingsPanel.popup;
        },
        set popup(value) {
            settingsPanel.replacePopup(value);
        },
        buildVersionsPanel: (...args) => buildVersionsPanel(...args),
        get trackSession() {
            return trackSession;
        },
        originalLanguages: (...args) => originalLanguages(...args),
        richLines: (...args) => richLines(...args),
        auxiliary: (...args) => auxiliary(...args),
        documentState: (...args) => documentState(...args),
        activateSettingsTab: (...args) => activateSettingsTab(...args),
        closePopup: (...args) => closePopup(...args),
        accountPreferences: (...args) => accountPreferences(...args),
        get languageChoices() {
            return languageChoices;
        },
        songPreference: (...args) => songPreference(...args),
        mergePreferences: (...args) => mergePreferences(...args),
        refreshRows: (...args) => refreshRows(...args),
        saveSongPreferences: (...args) => saveSongPreferences(...args),
        notice: (...args) => notice(...args),
        api: (...args) => api(...args),
        refreshSong: (...args) => refreshSong(...args),
        status: (...args) => status(...args),
        showError: (...args) => showError(...args),
    });

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

    const { buildDisplay, originalLanguages, updateLanguageOptions, updateLivePreview } = createDisplayPanel({
        context: {
            get current() {
                return trackSession.current;
            },
            set current(value) {
                trackSession.replaceCurrent(value);
            },
            get popup() {
                return settingsPanel.popup;
            },
            set popup(value) {
                settingsPanel.replacePopup(value);
            },
        },
        accountPreferences: (...args) => accountPreferences(...args),
        languageChoices,
        preference: (...args) => preference(...args),
        defaults,
    });

    const { stopLanguagePlayback, drawJobDetails, buildVersionsPanel } = createVersionPanel({
        context: {
            get popup() {
                return settingsPanel.popup;
            },
            set popup(value) {
                settingsPanel.replacePopup(value);
            },
            get scope() {
                return trackSession.scope;
            },
            set scope(value) {
                trackSession.replaceScope(value);
            },
            get current() {
                return trackSession.current;
            },
            set current(value) {
                trackSession.replaceCurrent(value);
            },
            get services() {
                return catalog.services;
            },
            set services(value) {
                catalog.replaceServices(value);
            },
        },
        documentState: (...args) => documentState(...args),
        originalLanguages: (...args) => originalLanguages(...args),
        languageChoices,
        trackScope: (...args) => trackScope(...args),
        richLines: (...args) => richLines(...args),
        auxiliary: (...args) => auxiliary(...args),
        startPlaybackPreview: (...args) => startPlaybackPreview(...args),
        stopPlaybackPreview: (panel) => {
            if (previewController.panel === panel) endPlaybackPreview();
        },
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

    const { generate, restoreGeneration } = createGenerationController({
        setAuxiliaryChoices: (value) => trackSession.setAuxiliaryChoices(value),
        scope: () => trackSession.scope,
        current: () => trackSession.current,
        services: () => catalog.services,
        notifications: () => playbackFeedback.notifications,
        popup: () => settingsPanel.popup,
        tools: () => playbackFeedback.tools,
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
    const previewController = new PlaybackPreview({
        scope: () => trackSession.scope,
        current: () => trackSession.current,
        time: () => media()?.currentTime || 0,
        render: (doc) => {
            trackSession.replaceCurrent(doc);
            render(documentState().lyrics);
            updateStatus();
        },
        mount: (bar) => playbackFeedback.notifications?.setPreview(bar),
        pending: (doc, order) => {
            if (trackSession.scope) accept(doc, trackSession.scope, true, order);
        },
    });
    const playbackPreview = previewController.session;
    let searchSession: SearchSession<SearchQuery, SearchResults> | null = null;

    const exportPanel = createExportPanel({
        scope: () => trackSession.scope,
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
        scope: () => trackSession.scope,
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
        scope: () => trackSession.scope,
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
        notifications: () => playbackFeedback.notifications,
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
        const target = trackSession.scope;
        const submit = async (text: string) => {
            try {
                await api("items/" + requireValue(target).itemId + "/import", "POST", { text, existingLocal: existing });
                if (trackSession.scope !== target) return;
                playbackPreview.discard();
                await finishWorkflow();
                status("Local lyrics selected", false, 4000);
            } catch (error) {
                if (trackSession.scope !== target) return;
                showError(error, settingsPanel.popup?.querySelector<HTMLElement>(".lb-original-feedback") || searchPopup || playbackFeedback.tools);
            }
        };
        if (existing) return submit("");
        importPanel.open();
    }
    const { buildMixPreview } = createMixSection({
        documentState: (...args) => documentState(...args),
        get searchPopup() {
            return searchPopup;
        },
        set searchPopup(value) {
            searchPopup = value;
        },
        notice: (...args) => notice(...args),
        api: (...args) => api(...args),
        get trackSession() {
            return trackSession;
        },
        finishWorkflow: (...args) => finishWorkflow(...args),
        status: (...args) => status(...args),
        showError: (...args) => showError(...args),
    });
    const { openVersions } = createSearchPanel({
        canOpen: () => importPanel.canClose() && transcriptionPanel.canClose(),
        responseOrder,
        hideImprovement: () => playbackFeedback.notifications?.remove("improvement"),
        context: {
            get scope() {
                return trackSession.scope;
            },
            set scope(value) {
                trackSession.replaceScope(value);
            },
            get searchPopup() {
                return searchPopup;
            },
            set searchPopup(value) {
                searchPopup = value;
            },
            get current() {
                return trackSession.current;
            },
            set current(value) {
                trackSession.replaceCurrent(value);
            },
            get sources() {
                return catalog.sources;
            },
            set sources(value) {
                catalog.replaceSources(value);
            },
            get searchUsageRefresh() {
                return searchUsageRefresh;
            },
            set searchUsageRefresh(value) {
                searchUsageRefresh = value;
            },
            get lastRequest() {
                return trackSession.lastRequest;
            },
            set lastRequest(value) {
                trackSession.replaceLastRequest(value);
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
                                trackSession.scope === target && (readResponseOrder(data, responseOrder) ?? 0) < target.accepted
                                    ? trackSession.current?.lyrics
                                    : data.lyrics,
                            ),
                        ),
                        { status: 200, headers: { "Content-Type": "application/json" } },
                    );
                } catch (error) {
                    if (trackSession.scope === target) showError(error, playbackFeedback.tools, retry, { operation: "retrieval" });
                    return new Response(JSON.stringify(nativePayload(null)), { status: 200, headers: { "Content-Type": "application/json" } });
                }
            },
            transform(data, target, order, status) {
                if (status !== 200) {
                    if (trackSession.scope === target)
                        showError(
                            {
                                message:
                                    isRecord(data) && isRecord(data.error) && typeof data.error.message === "string"
                                        ? data.error.message
                                        : "Couldn’t retrieve lyrics",
                                details: isRecord(data) ? data.error : undefined,
                            },
                            playbackFeedback.tools,
                            retry,
                            { operation: "retrieval" },
                        );
                    return data;
                }
                if (!isRecord(data) || !("state" in data || data.lyrics)) return data;
                const parsed = parseDocument(data, defaults);
                const doc = trackSession.scope === target && order < target.accepted ? trackSession.current?.lyrics : parsed.lyrics;
                accept(parsed, target, false, order);
                return nativePayload(doc);
            },
            error(target) {
                if (trackSession.scope === target)
                    showError(
                        { message: "Network error retrieving lyrics.", details: { code: "network_error", retryable: true } },
                        playbackFeedback.tools,
                        retry,
                        {
                            operation: "retrieval",
                        },
                    );
            },
        }),
    );
    lifetime.on(document, "lyricbridge:timing-panel", (event) => {
        if (!(event instanceof CustomEvent) || !(event.detail instanceof HTMLElement) || !trackSession.scope || !isLyrics()) return;
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
            if (previewController.running) {
                endPlaybackPreview();
                return;
            }
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
            lyricPresentation.replaceLyricViewHidden(true);
            cancel();
        },
        true,
    );
    lifetime.on(
        document,
        "viewshow",
        (event) => {
            if (!(event.target instanceof Element) || !event.target.matches(".lyricPage")) return;
            lyricPresentation.replaceLyricViewHidden(false);
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
    const transportControls = createTransportControls({
        media: (...args) => media(...args),
        get lifetime() {
            return lifetime;
        },
    });
    const { mountTransportLyrics } = transportControls;

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
            flushPreferences();
            cancel();
            transportControls.transportButton?.classList.remove("lb-transport-lyrics");
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
        rendererSnapshot: () =>
            trackSession.current ? { itemId: trackSession.scope?.itemId, payload: nativePayload(documentState().lyrics) } : null,
        get current() {
            return trackSession.current;
        },
        get metrics() {
            return { ...metrics };
        },
    };
    window.LyricBridge = publicApi;
    return publicApi;
}
