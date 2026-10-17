/** Shared list-row layout for source, service, connection, and request settings. */
export function settingsRowHeader(name: string, description = "", status?: string, root: HTMLElement = document.createElement("div")) {
    root.classList.add("lb-settings-row-heading");
    const main = document.createElement("span");
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
    main.append(title, detail);
    root.append(main, actions);
    return { root, main, title, label, description: detail, actions };
}

/** Keep related row controls together when the action area wraps. */
export function settingsActionGroup(label: string) {
    const group = document.createElement("span");
    group.className = "lb-settings-action-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    return group;
}
