import { adminButton } from "./controls.ts";
/** Shared list-row layout for source, service, connection, and request settings. */
export function settingsRowHeader(name: string, description = "", status?: string, root: HTMLElement = document.createElement("div")) {
    root.classList.add("lb-settings-row-heading");
    const main = document.createElement("div");
    main.className = "lb-settings-row-main";
    const title = document.createElement("span");
    title.className = "lb-settings-row-title";
    const label = document.createElement("span");
    label.textContent = name;
    title.append(label);
    if (status !== undefined) {
        const badge = document.createElement("span");
        badge.className = "lb-config-badge";
        badge.textContent = status;
        title.append(badge);
    }
    const detail = document.createElement("span");
    detail.className = "fieldDescription lb-settings-row-description";
    detail.textContent = description;
    detail.hidden = !description;
    const actions = document.createElement("span");
    actions.className = "lb-settings-row-actions";
    const body = document.createElement("div");
    body.className = "lb-settings-row-body";
    main.append(title, detail, body);
    root.append(main, actions);
    return { root, main, title, label, description: detail, actions, body };
}

/** Keep related row controls together when the action area wraps. */
export function settingsActionGroup(label: string) {
    const group = document.createElement("span");
    group.className = "lb-settings-action-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    return group;
}

/** All management row actions use the same quiet control and destructive treatment. */
export function rowAction(label: string, run: ((event: MouseEvent) => unknown) | null, tone: "quiet" | "destructive" = "quiet") {
    const control = adminButton(label, run, "quiet");
    control.classList.add("lb-row-action");
    if (tone === "destructive") control.classList.add("lb-material-destructive");
    return control;
}
