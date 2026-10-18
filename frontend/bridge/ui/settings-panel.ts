import type {} from "../../platform/globals.ts";
import type {} from "../../platform/globals.ts";
import type { FeedbackScope } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import { button, e } from "./controls.ts";
import { createDialog, mountDialog } from "./dialog.ts";

interface Dependencies {
    feedbackScope: FeedbackScope;
    stopLanguagePlayback: () => void;
    settingsButton: HTMLButtonElement | null;
    searchPopup: HTMLElement | null;
    requestWorkflowClose: () => void;
    importPanel: { canClose(): boolean; dispose(): void };
    transcriptionPanel: { canClose(): boolean; dispose(): void };
    trackSession: TrackSessionPort;
    updateSongPanel: (force?: boolean) => void;
    buildDisplay: (parent: HTMLElement) => void;
    lifetime: Lifecycle;
}

/** Owns settings panel behavior and its installation lifetime. */
export function createSettingsPanel(deps: Dependencies) {
    let popup: HTMLElement | null = null;

    function closePopup() {
        if (popup) deps.feedbackScope.releaseWithin(popup);
        deps.stopLanguagePlayback();
        if (!popup) return;
        const trigger = deps.settingsButton;
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
        for (const panel of [popup, deps.searchPopup]) if (panel) panel.style.setProperty("--lb-panel-bottom", Math.max(bottom, keyboard + 8) + "px");
    }

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
        if (deps.searchPopup) {
            deps.requestWorkflowClose();
            return;
        }
        if (!deps.importPanel.canClose() || !deps.transcriptionPanel.canClose()) return;
        if (popup) {
            if (typeof tabName === "string") activateSettingsTab(tabName);
            else closePopup();
            return;
        }
        const heading = e("div", "lb-settings-heading");
        heading.append(
            e("h2", "", deps.trackSession.current?.track?.title || deps.trackSession.current?.lyrics?.title || "Lyrics settings"),
            e("p", "lb-settings-artist", deps.trackSession.current?.track?.artist || deps.trackSession.current?.lyrics?.artist || ""),
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
            const values = [...tabs.querySelectorAll<HTMLElement>('[role="tab"]')];
            const i = values.indexOf(document.activeElement instanceof HTMLElement ? document.activeElement : requireValue(values[0]));
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
        deps.updateSongPanel();
        deps.buildDisplay(requireValue(popup.querySelector<HTMLElement>(".lb-display-panel")));
        activateSettingsTab(typeof tabName === "string" ? tabName : "Song");
        requireValue(tabs.querySelector<HTMLElement>('[aria-selected="true"]')).focus();
        const panel = popup;
        popup.addEventListener("focusout", () =>
            deps.lifetime.timeout(() => {
                if (popup === panel && !panel.contains(document.activeElement)) deps.updateSongPanel();
            }, 0),
        );
    }
    return {
        closePopup,
        updatePanelBounds,
        activateSettingsTab,
        openPopup,
        get popup(): HTMLElement | null {
            return popup;
        },
        replacePopup(value: HTMLElement | null) {
            popup = value;
        },
    };
}
