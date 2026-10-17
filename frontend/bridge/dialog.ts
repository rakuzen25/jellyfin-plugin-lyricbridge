import { button, e } from "./controls.ts";

interface DialogOptions {
    label: string;
    title?: string | HTMLElement;
    className?: string;
    wide?: boolean;
    workflow?: boolean;
    onClose(): void;
}

/** Shared non-modal dialog layout; feature owners retain request and save protections. */
export function createDialog(options: DialogOptions) {
    const root = e(
        "section",
        ["lb-popup lb-dialog", options.wide ? "lb-search" : "", options.workflow === false ? "" : "lb-workflow-dialog", options.className || ""]
            .filter(Boolean)
            .join(" "),
    );
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", options.label);
    const header = e("header", "lb-popup-header");
    const heading = options.title instanceof HTMLElement ? options.title : e("h2", "", options.title || options.label);
    const closeButton = button("Close", options.onClose, "", { icon: "close", iconOnly: true });
    const body = e("div", "lb-panel-body lb-dialog-body");
    const feedback = e("div", "lb-dialog-feedback");
    const footer = e("div", "lb-dialog-footer");
    header.append(heading, closeButton);
    root.append(header);
    if (options.workflow !== false) root.append(feedback, body, footer);
    const setBusy = (busy: boolean) => {
        root.setAttribute("aria-busy", String(busy));
        closeButton.disabled = busy;
    };
    return { root, closeButton, body, feedback, footer, setBusy };
}

/** Dialogs share a stacking context and leave playback controls accessible. */
export function mountDialog(root: HTMLElement) {
    document.body.append(root);
    queueMicrotask(() => {
        if (!root.isConnected || root.hidden || root.contains(document.activeElement)) return;
        (
            root.querySelector<HTMLElement>(
                ".lb-dialog-body input:not([disabled]),.lb-dialog-body select:not([disabled]),.lb-dialog-body button:not([disabled])",
            ) || root.querySelector<HTMLElement>(".lb-popup-header button")
        )?.focus({ preventScroll: true });
    });
}
