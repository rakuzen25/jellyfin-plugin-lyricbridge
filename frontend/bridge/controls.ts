/** Native DOM controls shared by bridge settings and search panels. */
export const e = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
    const node = document.createElement(tag);
    node.className = cls || "";
    if (text !== undefined) node.textContent = text;
    return node;
};
// Small original SVG glyphs: local, font-independent and decorative.
const glyphs = {
    close: "M6 6l12 12M18 6L6 18",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    search: "M15 15l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    preview: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    check: "M4 12l5 5L20 6",
    retry: "M20 7v5h-5M20 12a8 8 0 1 0-2 6",
    generate: "M12 3v6M9 6h6M5 12v6M2 15h6M18 13v8M14 17h8",
    info: "M12 10v7M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    warning: "M12 3L2 21h20L12 3M12 9v5M12 17h.01",
    edit: "M4 20l1-5L16 4l4 4L9 19l-5 1",
    sort: "M4 6h16M4 12h11M4 18h6",
    chevron: "M9 5l7 7-7 7",
    back: "M12 5l-7 7 7 7M5 12h15",
    external: "M14 3h7v7M21 3L11 13M10 3H3v18h18v-7",
    import: "M14 3H5v18h14V8l-5-5M14 3v5h5M12 10v7M9 14l3 3 3-3",
    library: "M4 4h4v16H4zM10 4h4v16h-4zM17 4l4 15-3 1-4-15z",
    timing: "M9 3h6M12 3v3M18 5l2 2M12 10v5l3 2M21 14a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    music: "M9 18V5l11-2v12M9 5l11-2M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3M20 15a3 3 0 1 1-3-3 3 3 0 0 1 3 3",
};
export const icon = (name: keyof typeof glyphs) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("lb-icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", glyphs[name]);
    svg.append(path);
    return svg;
};
interface ButtonOptions {
    icon?: keyof typeof glyphs;
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
