import type { FeedbackScope } from "../../shared/feedback.ts";
import { type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import { type PlaybackPreviewRequest } from "../preview/playback-preview.ts";
import type { TrackScope } from "../session/contracts.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import { mountDialog } from "./dialog.ts";

interface Dependencies {
    feedbackScope: FeedbackScope;
    trackSession: TrackSessionPort;
    searchPopup: HTMLElement | null;
    importPanel: { canClose(): boolean; dispose(): void };
    transcriptionPanel: { canClose(): boolean; dispose(): void };
    popup: HTMLElement | null;
    stopLanguagePlayback: () => void;
    isLyrics: () => boolean;
    lyricViewHidden: boolean;
    updateSongPanel: (force?: boolean) => void;
    buildDisplay: (parent: HTMLElement) => void;
    activateSettingsTab: (name: string) => void;
    updatePanelBounds: () => void;
    openPopup: (tabName?: string) => void;
    exportPanel: { dispose(): void };
    searchUsageRefresh: (() => void) | null;
    searchSession: { dispose(): void } | null;
    settingsButton: HTMLButtonElement | null;
    refreshSong: (force?: boolean) => Promise<void>;
    showError: (
        cause: unknown,
        parent?: HTMLElement | null | undefined,
        retryAction?: () => unknown,
        context?: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string },
    ) => void;
    previewController: { start(request: PlaybackPreviewRequest): void; end(restore?: boolean): void };
}

/** Owns workflow navigation behavior and its installation lifetime. */
export function createWorkflowNavigation(deps: Dependencies) {
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
            deps.feedbackScope.releaseWithin(workflowReturn.panel);
            workflowReturn.panel.remove();
        }
        workflowReturn = null;
    }

    function beginWorkflow(): boolean {
        if (
            !deps.trackSession.scope ||
            deps.searchPopup?.getAttribute("aria-busy") === "true" ||
            !deps.importPanel.canClose() ||
            !deps.transcriptionPanel.canClose()
        )
            return false;
        closeSearch(true, false, false);
        if (deps.popup) {
            const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            discardWorkflowReturn();
            workflowReturn = {
                scope: deps.trackSession.scope,
                panel: deps.popup,
                trigger,
                label: trigger?.getAttribute("aria-label") || trigger?.textContent?.trim() || "",
                section: trigger?.closest<HTMLElement>("[data-song-kind]")?.dataset.songKind || "",
                scrollTop: deps.popup.querySelector(".lb-panel-body")?.scrollTop || 0,
            };
            deps.stopLanguagePlayback();
            // Keep feedback handlers alive while the originating settings view is suspended.
            deps.popup.hidden = true;
            deps.popup.classList.remove("lb-popup");
            deps.popup = null;
        } else if (!workflowReturn)
            workflowReturn = { scope: deps.trackSession.scope, panel: null, trigger: null, label: "", section: "", scrollTop: 0 };
        return true;
    }

    function restoreWorkflowReturn() {
        const destination = workflowReturn;
        workflowReturn = null;
        if (
            !destination ||
            deps.trackSession.scope !== destination.scope ||
            destination.scope.controller.signal.aborted ||
            !deps.isLyrics() ||
            deps.lyricViewHidden
        ) {
            if (destination?.panel) {
                deps.feedbackScope.releaseWithin(destination.panel);
                destination.panel.remove();
            }
            return;
        }
        if (destination.panel) {
            deps.popup = destination.panel;
            deps.popup.hidden = false;
            deps.popup.classList.add("lb-popup");
            mountDialog(deps.popup);
            deps.updateSongPanel();
            deps.buildDisplay(requireValue(deps.popup.querySelector<HTMLElement>(".lb-display-panel")));
            deps.activateSettingsTab("Versions");
            deps.updatePanelBounds();
        } else deps.openPopup("Versions");
        const panel = deps.popup;
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
        deps.searchPopup?.querySelector<HTMLButtonElement>(".lb-popup-header button")?.click();
    }

    function startPlaybackPreview(request: PlaybackPreviewRequest) {
        deps.previewController.start(request);
    }

    function closeSearch(restore = true, force = false, returnToSettings = true) {
        if (!force && (deps.searchPopup?.getAttribute("aria-busy") === "true" || !deps.importPanel.canClose() || !deps.transcriptionPanel.canClose()))
            return;
        deps.exportPanel.dispose();
        deps.importPanel.dispose();
        deps.transcriptionPanel.dispose();
        if (deps.searchPopup) deps.feedbackScope.releaseWithin(deps.searchPopup);
        deps.searchUsageRefresh = null;
        deps.searchSession?.dispose();
        deps.searchSession = null;
        deps.searchPopup?.remove();
        deps.searchPopup = null;
        endPlaybackPreview(restore);
        if (force) discardWorkflowReturn();
        else if (returnToSettings) restoreWorkflowReturn();
        if (!deps.popup && returnToSettings) deps.settingsButton?.focus();
    }

    async function finishWorkflow() {
        const target = deps.trackSession.scope;
        const panel = deps.searchPopup;
        let failure: unknown;
        try {
            await deps.refreshSong(true);
        } catch (error) {
            failure = error;
        }
        if (deps.trackSession.scope !== target || deps.searchPopup !== panel) return;
        panel?.setAttribute("aria-busy", "false");
        closeSearch(false);
        if (failure)
            deps.showError(failure, deps.popup, () => deps.refreshSong(true), {
                operation: "action:refresh",
                secondary: "The change was saved. Refresh lyrics to display the updated selection.",
                retryLabel: "Refresh lyrics",
            });
    }

    function endPlaybackPreview(restore = true) {
        deps.previewController.end(restore);
    }
    return {
        workflowReturn,
        discardWorkflowReturn,
        beginWorkflow,
        restoreWorkflowReturn,
        requestWorkflowClose,
        startPlaybackPreview,
        closeSearch,
        finishWorkflow,
        endPlaybackPreview,
    };
}
