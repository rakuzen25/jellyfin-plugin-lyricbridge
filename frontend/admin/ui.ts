import { settingsRowHeader, rowAction } from "./settings-row.ts";

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
export function actionRow(...controls: HTMLElement[]) {
    const root = element("div", undefined, "lb-actions");
    root.append(...controls);
    return root;
}
export function surface(title: string, description?: string) {
    const root = element("section", undefined, "lb-settings-surface");
    root.setAttribute("aria-label", title);
    const heading = element("div", undefined, "lb-section-heading");
    heading.append(element("h3", title, "sectionTitle"));
    root.append(heading);
    if (description) root.append(element("p", description, "fieldDescription"));
    return { root, heading };
}
export function describedAction(title: string, description: string, label: string, run: (() => unknown) | null, destructive = false) {
    const root = element("div", undefined, "lb-settings-row");
    const heading = settingsRowHeader(title, description);
    const control = rowAction(label, run, destructive ? "destructive" : "quiet");
    heading.actions.append(control);
    root.append(heading.root);
    return root;
}
export function fieldControl(label: string, select = false) {
    const root = element("div", undefined, select ? "selectContainer" : "inputContainer");
    const input = select ? element("select") : element("input");
    input.setAttribute("is", select ? "emby-select" : "emby-input");
    input.setAttribute("label", label);
    input.setAttribute("aria-label", label);
    root.append(input);
    return { root, input };
}
export function readableLabel(key: string) {
    return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]/g, " ")
        .replace(/^./, (text) => text.toUpperCase());
}
export function valueRows(data: Record<string, unknown>, parent: HTMLElement) {
    const list = element("dl", undefined, "lb-value-list");
    for (const [key, value] of Object.entries(data)) {
        if (value == null || typeof value === "object" || key.endsWith("Version") || ["rawResponse", "rawResponses"].includes(key)) continue;
        const row = element("div");
        row.append(element("dt", readableLabel(key)), element("dd", typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)));
        if (typeof value === "boolean" && key.endsWith("Present")) {
            const badge = element("span", value ? "Configured" : "Not configured", "lb-config-badge");
            row.querySelector("dd")!.replaceChildren(badge);
        }
        list.append(row);
    }
    parent.append(list);
}
export function formatBytes(value: number) {
    return value < 1024 ? value + " B" : value < 1048576 ? (value / 1024).toFixed(1) + " KiB" : (value / 1048576).toFixed(1) + " MiB";
}

/** Scroll only the tab strip, without moving the page while resizing. */
export function revealSelectedTab(strip: HTMLElement) {
    const selected = strip.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected) return;
    const area = strip.getBoundingClientRect(),
        tab = selected.getBoundingClientRect();
    if (tab.left < area.left) strip.scrollLeft += tab.left - area.left;
    else if (tab.right > area.right) strip.scrollLeft += tab.right - area.right;
}
