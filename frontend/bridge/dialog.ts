import { button, e } from "./controls.ts";

interface DialogOptions {
    label: string;
    title?: string | HTMLElement;
    className?: string;
    wide?: boolean;
    closeLabel?: string;
    onClose(): void;
}

/** Shared playback dialog chrome; feature owners retain their request/save lifecycle. */
export function createDialog(options: DialogOptions) {
    const root = e("section", ["lb-popup lb-dialog", options.wide ? "lb-search" : "", options.className || ""].filter(Boolean).join(" "));
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", options.label);
    const header = e("header", "lb-popup-header");
    const heading = options.title instanceof HTMLElement ? options.title : e("h2", "", options.title || options.label);
    const closeButton = button(options.closeLabel || "Close", options.onClose, "", { icon: "close", iconOnly: true });
    header.append(heading, closeButton);
    root.append(header);
    return { root, closeButton };
}

/** Dialogs share a root stacking context, independent of Jellyfin page transforms. */
export function mountDialog(root: HTMLElement) {
    document.body.append(root);
}
