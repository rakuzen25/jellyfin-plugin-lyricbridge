import { icon, type IconName } from "../../shared/icons.ts";
export { icon } from "../../shared/icons.ts";
/** Native DOM controls shared by bridge settings and search panels. */
export const e = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
    const node = document.createElement(tag);
    node.className = cls || "";
    if (text !== undefined) node.textContent = text;
    return node;
};
interface ButtonOptions {
    icon?: IconName;
    iconOnly?: boolean;
    appearance?: "primary" | "danger" | "text";
}
export const button = (text: string, action: (event: MouseEvent) => void, cls = "", options: ButtonOptions = {}) => {
    const node = e("button", "lb-button " + cls);
    node.type = "button";
    node.onclick = action;
    if (options.appearance) node.classList.add(options.appearance === "text" ? "lb-text-button" : "lb-" + options.appearance);
    if (options.icon) node.append(icon(options.icon));
    if (options.iconOnly) {
        node.classList.add("lb-icon-button");
        node.setAttribute("aria-label", text);
        node.dataset.tooltip = text;
        node.title = text;
    } else if (text) node.append(e("span", "lb-action-label", text));
    return node;
};
export function section(title: string) {
    const root = e("section", "lb-setting-group");
    root.append(e("h3", "lb-section-title", title));
    return root;
}
export function disclosure(title: string, cls = "", framed = true) {
    const root = e("details", "lb-disclosure " + (framed ? "lb-frame " : "lb-flat ") + cls);
    const heading = e("summary", "lb-disclosure-heading");
    heading.append(icon("chevron"), e("span", "lb-disclosure-title", title));
    const content = e("div", "lb-disclosure-content");
    root.append(heading, content);
    return { root, content };
}
export function field<T extends HTMLElement>(parent: HTMLElement, label: string, input: T, help?: string) {
    const wrap = e("label", "lb-field");
    input.setAttribute("aria-label", label);
    wrap.append(e("span", "lb-field-label", label), input);
    if (help) wrap.append(e("small", "lb-help", help));
    parent.append(wrap);
    return input;
}
export function select(
    parent: HTMLElement,
    label: string,
    value: string,
    choices: readonly (readonly [string, string])[],
    change: (value: string) => void,
) {
    const input = e("select");
    for (const [key, text] of choices) {
        const option = e("option", "", text);
        option.value = key;
        input.append(option);
    }
    if (!choices.some((c) => c[0] === value)) {
        const option = e("option", "", value);
        option.value = value;
        input.append(option);
    }
    input.value = value;
    input.onchange = () => change(input.value);
    field(parent, label, input);
    return input;
}
export function toggle(parent: HTMLElement, label: string, value: boolean, change: (value: boolean) => void, help?: string) {
    const input = e("input");
    input.type = "checkbox";
    input.checked = value;
    input.onchange = () => change(input.checked);
    return field(parent, label, input, help);
}

/** Keep inline generation setup and its action button in sync after panel reuse. */
export function setGenerationPanelOpen(panel: HTMLElement, open: boolean): void {
    panel.hidden = !open;
    panel.parentElement?.querySelector<HTMLButtonElement>(`[aria-controls="${panel.id}"]`)?.setAttribute("aria-expanded", String(open));
}
