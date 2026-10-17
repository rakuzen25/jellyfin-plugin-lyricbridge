import { renderInspector } from "./record-inspector.ts";
import { settingsRowHeader, rowAction } from "./settings-row.ts";
import { adminButton as button } from "./controls.ts";
import { hostFailure } from "./contracts.ts";
import { createDataReview } from "./data-review.ts";
import {
    element as el,
    surface,
    actionRow,
    fieldControl,
    formatBytes as bytes,
    valueRows,
    readableLabel,
    describedAction,
    revealSelectedTab,
} from "./ui.ts";
import {
    targetKey,
    recordType,
    type DataHost,
    type Target,
    type StoredRecord,
    type Entity,
    type DataPage,
    type Selection,
} from "./data-contracts.ts";

const categories = [
    "originals",
    "versions",
    "transcripts",
    "line-breaks",
    "selections",
    "timing",
    "classifications",
    "preferences",
    "choices",
    "history",
    "temporary",
    "audio",
    "bookkeeping",
];
const categoryNames: Record<string, string> = {
    originals: "Original lyrics",
    versions: "Language versions",
    transcripts: "Transcripts",
    "line-breaks": "Saved line breaks",
    selections: "Selections",
    timing: "Timing corrections",
    classifications: "Classifications",
    preferences: "Preferences",
    choices: "Language choices",
    history: "Request history",
    temporary: "Temporary data",
    audio: "Staged audio",
    bookkeeping: "Internal records",
};
const categoryName = (name: string) => categoryNames[name] || readableLabel(name);
interface Overview {
    activeStoragePath: string;
    configuredStoragePath: string;
    restartRequired: boolean;
    databaseBytes: number;
    walBytes: number;
    audioBytes: number;
    categories: { name: string; count: number; payloadBytes: number }[];
    bookkeeping: Record<string, unknown>;
    retention: string;
}
interface Screen {
    root: HTMLElement;
    render(): Promise<void>;
    scroll: number;
    focus: HTMLElement | null;
    dispose?: () => void;
    review?: boolean;
    context?: string;
    selection?: boolean;
    label?: string;
    view?: string;
}

/** Read-only browsing and snapshot-bound management, independent of configuration drafts. */
export function createDataPanel(root: HTMLElement, host: DataHost) {
    root.dataset.configTransient = "true";
    const toolbar = el("div", undefined, "lb-data-toolbar"),
        nav = el("div", undefined, "lb-admin-tabs lb-secondary-tabs");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Stored data views");
    const status = el("div"),
        workspace = el("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const note = el("p", "Data actions apply immediately and do not use Save settings. Unfinished settings edits are preserved.", "fieldDescription");
    note.classList.add("lb-data-notice");
    root.append(toolbar, note, status, workspace);
    let visible = false,
        view = "Overview",
        version = 0,
        busy = false;
    let screens: Screen[] = [];
    const selected = new Map<string, StoredRecord>();
    let selectionBar: HTMLElement | undefined;
    const api = <T>(path: string) => host.call<T>("admin/data/" + path);
    const current = () => screens.at(-1)!;
    const feedback = (message: string, error = false) => host.feedback(status, message, error);
    const active = (revision: number) => visible && revision === version;
    async function refresh() {
        if (busy || !screens.length) return;
        note.hidden = view !== "Overview" || screens.length > 1;
        const revision = ++version,
            screen = current();
        screen.root.setAttribute("aria-busy", "true");
        feedback("Loading stored data…");
        try {
            await screen.render();
            if (active(revision)) feedback("");
        } catch (caught) {
            if (active(revision)) {
                feedback(hostFailure(caught).message || "Data could not load. Select Refresh data to retry.", true);
            }
        } finally {
            screen.root.removeAttribute("aria-busy");
        }
    }
    function back(reload = false) {
        if (busy || screens.length < 2) return;
        const leaving = screens.pop()!;
        leaving.dispose?.();
        leaving.root.remove();
        ++version;
        const previous = current();
        view = previous.view || view;
        controls();
        if (leaving.context !== previous.context) selected.clear();
        previous.root.hidden = false;
        note.hidden = view !== "Overview" || screens.length > 1;
        const restore = () => {
            syncSelection();
            let focus = previous.focus;
            if (focus && !focus.isConnected) {
                const label = focus.getAttribute("aria-label"),
                    text = focus.textContent;
                focus =
                    Array.from(previous.root.querySelectorAll<HTMLElement>("button,input,select")).find((node) =>
                        label ? node.getAttribute("aria-label") === label : node.textContent === text,
                    ) || previous.root.querySelector<HTMLElement>("button");
            }
            focus?.focus({ preventScroll: true });
            window.scrollTo({ top: previous.scroll });
        };
        if (reload) void refresh().then(restore);
        else restore();
    }
    function push(render: (target: HTMLElement) => Promise<void>, review = false) {
        const previous = screens.at(-1);
        if (previous) {
            previous.scroll = window.scrollY;
            previous.focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            previous.root.hidden = true;
        }
        const target = el("div", undefined, "lb-admin-screen");
        target.dataset.screen = review ? "review" : "browse";
        const screen: Screen = { root: target, render: () => render(target), scroll: 0, focus: null, review, context: previous?.context };
        screen.view = view;
        if (!previous) screen.label = view;
        screens.push(screen);
        workspace.append(target);
        void refresh();
        return screen;
    }
    function reset(render: (target: HTMLElement) => Promise<void>) {
        for (const screen of screens) screen.dispose?.();
        screens = [];
        workspace.replaceChildren();
        selected.clear();
        selectionBar = undefined;
        ++version;
        push(render);
    }
    function breadcrumbs(target: HTMLElement, title: string, label = "Back") {
        current().label = title;
        const trail = el("nav", undefined, "lb-breadcrumbs");
        trail.setAttribute("aria-label", "Stored data location");
        trail.append(
            button(label, () => back(), "quiet"),
            el("span", [...screens.map((screen) => screen.label).filter(Boolean)].join(" / ")),
        );
        target.append(trail);
    }
    function activate(name: string, focus = false) {
        if (busy) return;
        view = name;
        controls();
        reset(
            name === "Overview"
                ? overview
                : name === "Configuration"
                  ? configuration
                  : name === "Maintenance"
                    ? (target) => records(target, {})
                    : (target) => entities(target, name === "Accounts"),
        );
        const tab = Array.from(nav.querySelectorAll<HTMLButtonElement>("button")).find((tab) => tab.textContent === name);
        if (focus) tab?.focus();
        tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    function controls() {
        nav.replaceChildren(
            ...["Overview", "Songs", "Accounts", "Configuration", "Maintenance"].map((name) => {
                const control = button(name, () => activate(name), "quiet");
                control.setAttribute("role", "tab");
                control.setAttribute("aria-selected", String(view === name));
                control.tabIndex = name === view ? 0 : -1;
                control.disabled = busy;
                control.id = "lb-data-view-" + name.toLowerCase();
                control.setAttribute("aria-controls", "lb-data-workspace");
                return control;
            }),
        );
        workspace.id = "lb-data-workspace";
        workspace.setAttribute("role", "tabpanel");
        workspace.setAttribute("aria-labelledby", "lb-data-view-" + view.toLowerCase());
        const refreshControl = button(
            "Refresh data",
            () => {
                if (current()?.review) return;
                void refresh();
            },
            "quiet",
        );
        refreshControl.disabled = busy || !!current()?.review;
        toolbar.replaceChildren(nav, refreshControl);
    }
    nav.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const names = ["Overview", "Songs", "Accounts", "Configuration", "Maintenance"],
            index = names.indexOf(view);
        activate(names[event.key === "Home" ? 0 : event.key === "End" ? 4 : (index + (event.key === "ArrowRight" ? 1 : 4)) % 5]!, true);
    };
    root.onkeydown = (event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
    };
    function syncSelection() {
        selectionBar = current()?.root.querySelector<HTMLElement>(".lb-selection-bar") || selectionBar;
        for (const checkbox of root.querySelectorAll<HTMLInputElement>("input[data-target]"))
            checkbox.checked = selected.has(checkbox.dataset.target!);
        if (!selectionBar?.isConnected) return;
        const count = selectionBar.querySelector<HTMLElement>("[role=status]")!;
        count.textContent = selected.size + " selected";
        selectionBar.querySelectorAll<HTMLButtonElement>("button[data-selection-required]").forEach((control) => (control.disabled = !selected.size));
    }
    function selectionControls(target: HTMLElement, items: StoredRecord[]) {
        selectionBar = el("div", undefined, "lb-selection-bar");
        const count = el("span");
        count.setAttribute("role", "status");
        count.setAttribute("aria-live", "polite");
        const review = button("Review selected", () => selectedScreen(), "quiet");
        review.dataset.selectionRequired = "true";
        const clear = button(
            "Clear selection",
            () => {
                selected.clear();
                syncSelection();
            },
            "quiet",
        );
        clear.dataset.selectionRequired = "true";
        selectionBar.append(
            count,
            actionRow(
                button(
                    "Select removable on this page",
                    () => {
                        for (const item of items) if (item.canDelete) selected.set(targetKey(item.target), item);
                        syncSelection();
                    },
                    "quiet",
                ),
                review,
                clear,
            ),
        );
        target.append(selectionBar);
        syncSelection();
    }
    function selectedScreen() {
        const screen = push(async (target) => {
            target.replaceChildren();
            breadcrumbs(target, "Selection", "Back to records");
            const panel = surface("Selected records", "Includes explicitly selected records from other pages and filters in this browsing context.");
            target.append(panel.root);
            for (const item of selected.values()) {
                const row = recordRow(item, false);
                const remove = rowAction(
                    "Remove from selection",
                    () => {
                        selected.delete(targetKey(item.target));
                        void current().render();
                    },
                    "quiet",
                );
                remove.setAttribute("aria-label", "Remove " + item.title + " from selection");
                row.querySelector(".lb-settings-row-actions")!.append(remove);
                panel.root.append(row);
            }
            panel.root.append(
                button(
                    "Preview selected deletion",
                    selected.size ? () => review({ action: "delete", targets: [...selected.values()].map((item) => item.target) }) : null,
                ),
            );
        });
        screen.selection = true;
    }
    function review(selection: Selection) {
        const screen = push(async (target) => {
            target.replaceChildren();
            const flow = createDataReview(
                target,
                {
                    ...host,
                    maintenance(value) {
                        busy = value;
                        host.maintenance(value);
                        controls();
                    },
                },
                (reload) => {
                    const selectionScreen = screens.at(-2)?.selection;
                    back(reload && !selectionScreen);
                    if (reload && selectionScreen) back(true);
                    controls();
                },
                (keys) => {
                    for (const key of keys) selected.delete(key);
                },
            );
            current().dispose = flow.dispose;
            await flow.open(selection);
            controls();
        }, true);
        void screen;
    }
    function recordRow(item: StoredRecord, selectable = true) {
        const row = el("div", undefined, "lb-settings-row lb-data-record");
        row.dataset.record = targetKey(item.target);
        const header = settingsRowHeader(
            item.title === item.target.kind ? item.displayType || recordType(item.target.kind) : item.title,
            [
                recordType(item.target.kind),
                item.source,
                item.storedAt ? new Date(item.storedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "",
                bytes(item.payloadBytes),
            ]
                .filter(Boolean)
                .join(" · "),
        );
        if (selectable) {
            header.root.classList.add("lb-settings-row-selectable");
            const label = el("label", undefined, "checkboxContainer emby-checkbox-label lb-selection-checkbox"),
                checkbox = el("input");
            checkbox.type = "checkbox";
            checkbox.setAttribute("is", "emby-checkbox");
            checkbox.setAttribute("aria-label", "Select " + targetKey(item.target));
            checkbox.dataset.target = targetKey(item.target);
            checkbox.checked = selected.has(targetKey(item.target));
            checkbox.disabled = !item.canDelete;
            checkbox.onchange = () => {
                if (checkbox.checked) selected.set(targetKey(item.target), item);
                else selected.delete(targetKey(item.target));
                syncSelection();
            };
            const accessible = el("span", "Select record", "lb-visually-hidden");
            label.append(checkbox, accessible);
            header.root.prepend(label);
            const inspect = rowAction("Inspect", () => push((target) => detail(target, item.target)), "quiet");
            inspect.setAttribute("aria-label", "Inspect " + item.target.kind);
            const remove = rowAction("Delete", item.canDelete ? () => review({ action: "delete", targets: [item.target] }) : null, "destructive");
            remove.setAttribute("aria-label", "Delete " + item.target.kind);
            header.actions.append(inspect, remove);
        }
        row.append(header.root);
        if (item.blocker) header.body.append(el("p", item.blocker, "fieldDescription"));
        const identity = el("details");
        identity.append(el("summary", "Stored ID and references"), el("code", targetKey(item.target)));
        for (const id of item.itemIds) identity.append(button("Song " + id, () => openRelated(false, id), "quiet"));
        for (const id of item.userIds) identity.append(button("Account " + id, () => openRelated(true, id), "quiet"));
        for (const dependency of item.dependencies)
            identity.append(button("Required by " + recordType(dependency.kind), () => push((target) => detail(target, dependency)), "quiet"));
        header.body.append(identity);
        return row;
    }
    function openRelated(account: boolean, id: string) {
        view = account ? "Accounts" : "Songs";
        controls();
        selected.clear();
        push((target) => records(target, account ? { userId: id } : { itemId: id }));
    }
    async function detail(target: HTMLElement, identity: Target) {
        const revision = version,
            item = await api<StoredRecord>("detail?" + new URLSearchParams({ kind: identity.kind, id: identity.id }));
        if (!active(revision)) return;
        target.replaceChildren();
        breadcrumbs(target, item.displayType || recordType(item.target.kind), screens.length > 2 ? "Back to previous view" : "Back to data list");
        renderInspector(target, item, {
            originId: current().context?.split(":")[1],
            inspect: (next) => push((node) => detail(node, next)),
            remove: (record) => review({ action: "delete", targets: [record.target] }),
            cancel: async (record) => {
                await host.call("admin/data/requests/" + encodeURIComponent(record.target.id) + "/cancel", "POST");
                await refresh();
            },
        });
    }
    function pager(target: HTMLElement, total: number, offset: number, change: (offset: number) => void) {
        const root = el("div", undefined, "lb-admin-pagination");
        root.append(
            el(
                "span",
                total && offset < total ? offset + 1 + "–" + Math.min(offset + 50, total) + " of " + total : "No stored data on this page.",
                "fieldDescription",
            ),
        );
        if (total > 50 || offset)
            root.append(
                actionRow(
                    button("Previous data page", offset ? () => change(Math.max(0, offset - 50)) : null, "quiet"),
                    button("Next data page", offset + 50 < total ? () => change(offset + 50) : null, "quiet"),
                ),
            );
        target.append(root);
    }
    async function entities(target: HTMLElement, account: boolean) {
        // A closure owns filters/page so Back can reveal the exact originating screen.
        let offset = 0,
            applied = { search: "", category: "", missing: false };
        const draft = { ...applied };
        async function render() {
            const revision = version;
            const query = new URLSearchParams({ ...applied, missing: String(applied.missing), offset: String(offset), limit: "50" });
            if (!applied.category) query.delete("category");
            const page = await api<DataPage<Entity>>((account ? "accounts?" : "songs?") + query);
            if (!active(revision)) return;
            target.replaceChildren();
            const panel = surface(account ? "Accounts with stored data" : "Songs with stored data");
            target.append(panel.root);
            const filters = el("div", undefined, "lb-data-filters");
            const search = fieldControl("Search names or IDs"),
                category = fieldControl("Data category", true);
            search.input.value = draft.search;
            search.input.oninput = () => {
                draft.search = search.input.value;
            };
            for (const name of ["", ...categories]) {
                const option = el("option", name ? categoryName(name) : "All categories");
                option.value = name;
                category.input.append(option);
            }
            category.input.value = draft.category;
            category.input.onchange = () => {
                draft.category = category.input.value;
            };
            const fields = el("div", undefined, "lb-data-filter-fields");
            fields.append(search.root, category.root);
            const label = el("label", undefined, "checkboxContainer emby-checkbox-label"),
                missing = el("input");
            missing.type = "checkbox";
            missing.setAttribute("is", "emby-checkbox");
            missing.checked = draft.missing;
            missing.onchange = () => {
                draft.missing = missing.checked;
            };
            label.append(missing, el("span", "Missing from Jellyfin only"));
            const apply = () => {
                applied = { ...draft, search: draft.search.trim() };
                offset = 0;
                void refresh();
            };
            search.input.onkeydown = (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    apply();
                }
            };
            const actions = el("div", undefined, "lb-data-filter-actions");
            actions.append(label, button("Search", apply, "quiet"));
            filters.append(fields, actions);
            panel.root.append(filters);
            for (const item of page.items) {
                const row = el("div", undefined, "lb-settings-row");
                const header = settingsRowHeader(
                    item.identity.name,
                    [item.artist, item.records + " records", bytes(item.payloadBytes) + " associated content"].filter(Boolean).join(" · "),
                    item.identity.missing ? "Missing from Jellyfin" : undefined,
                );
                const open = rowAction(
                    "Open",
                    () => {
                        selected.clear();
                        push((node) =>
                            records(
                                node,
                                account
                                    ? { userId: item.identity.id, name: item.identity.name }
                                    : { itemId: item.identity.id, name: item.identity.name },
                            ),
                        );
                    },
                    "quiet",
                );
                open.setAttribute("aria-label", "Open " + item.identity.name);
                header.actions.append(open);
                const identity = el("details");
                identity.append(el("summary", "Stored ID"), el("code", item.identity.id));
                header.body.append(identity);
                row.append(header.root);
                panel.root.append(row);
            }
            pager(panel.root, page.total, offset, (next) => {
                offset = next;
                void refresh();
            });
        }
        current().render = render;
        await render();
    }
    async function records(target: HTMLElement, identity: { itemId?: string; userId?: string; name?: string }) {
        let offset = 0,
            category = "";
        current().context = identity.itemId ? "song:" + identity.itemId : identity.userId ? "account:" + identity.userId : "maintenance:";
        async function render() {
            const revision = version,
                query = new URLSearchParams({ offset: String(offset), limit: "50" });
            if (category) query.set("category", category);
            if (identity.itemId) query.set("itemId", identity.itemId);
            if (identity.userId) query.set("userId", identity.userId);
            const page = await api<DataPage<StoredRecord>>("records?" + query);
            if (!active(revision)) return;
            target.replaceChildren();
            if (screens.length > 1) breadcrumbs(target, identity.name || "Stored records", "Back to " + view.toLowerCase());
            if (!identity.itemId && !identity.userId) {
                const cleanup = surface("Cleanup", "Cleanup preserves active-job inputs and retry data.");
                cleanup.root.append(
                    describedAction(
                        "Expired data",
                        "Remove records eligible under existing retention rules.",
                        "Clean expired data now",
                        () => review({ action: "expired" }),
                        true,
                    ),
                    describedAction(
                        "Unused temporary data",
                        "Clear removable temporary results and plugin-owned staged audio.",
                        "Clear unused temporary data",
                        () => review({ action: "unused" }),
                        true,
                    ),
                );
                const resets = surface("Resets");
                for (const [title, description, label, action] of [
                    ["Lyric library", "Keeps settings, credentials and account/song preferences.", "Reset managed lyric library", "library-reset"],
                    [
                        "Preferences",
                        "Reset all stored account/song preferences and language choices.",
                        "Reset all stored preferences",
                        "preferences-reset",
                    ],
                    [
                        "Factory reset",
                        "Clear content, history, settings and credentials. Retain the active storage directory.",
                        "Factory reset plugin",
                        "factory-reset",
                    ],
                ])
                    resets.root.append(describedAction(title!, description!, label!, () => review({ action: action! }), true));
                target.append(cleanup.root, resets.root);
            }
            const entity = identity.itemId || identity.userId;
            if (entity) {
                const header = el("header", undefined, "lb-inspection-header");
                header.append(el("h3", identity.name || (identity.itemId ? "Song" : "Account")));
                target.append(header);
            }
            const panel = surface(entity ? "Stored records" : "Category data");
            target.append(panel.root);
            if (identity.itemId)
                target
                    .querySelector("header")!
                    .append(
                        describedAction(
                            "Stored song content",
                            "Originals, transcripts/reviews, and removable temporary results. Preferences, classifications and finished history have separate actions.",
                            "Delete all stored content for this song",
                            () => review({ action: "song-content", itemId: identity.itemId }),
                            true,
                        ),
                    );
            if (identity.userId)
                target
                    .querySelector("header")!
                    .append(
                        describedAction(
                            "Account preferences",
                            "Reset this account’s preferences and song overrides without affecting other accounts.",
                            "Reset this account’s stored preferences",
                            () => review({ action: "preferences-reset", userId: identity.userId }),
                            true,
                        ),
                    );
            const field = fieldControl(identity.itemId || identity.userId ? "Record category" : "Maintenance category", true);
            for (const name of ["", ...categories]) {
                const option = el("option", name ? categoryName(name) : "All categories");
                option.value = name;
                field.input.append(option);
            }
            field.input.value = category;
            field.input.onchange = () => {
                category = field.input.value;
                offset = 0;
                if (!identity.itemId && !identity.userId) {
                    selected.clear();
                    current().context = "maintenance:" + category;
                }
                void refresh();
            };
            panel.root.append(field.root);
            if (!identity.itemId && !identity.userId)
                panel.root.append(
                    describedAction(
                        "Clear category",
                        "Preview exact targets, dependencies and blocked records in the selected category.",
                        "Clear this category",
                        category ? () => review({ action: "category", category }) : null,
                        true,
                    ),
                );
            selectionControls(panel.root, page.items);
            for (const item of page.items) panel.root.append(recordRow(item));
            pager(panel.root, page.total, offset, (next) => {
                offset = next;
                void refresh();
            });
        }
        current().render = render;
        await render();
    }
    async function overview(target: HTMLElement) {
        const revision = version,
            data = await api<Overview>("overview");
        if (!active(revision)) return;
        target.replaceChildren();
        const storage = surface("Plugin storage");
        target.append(storage.root);
        valueRows(
            {
                activeDirectory: data.activeStoragePath,
                ...(data.restartRequired ? { pendingDirectory: data.configuredStoragePath, restartRequired: true } : {}),
                database: bytes(data.databaseBytes),
                writeAheadLog: bytes(data.walBytes),
                stagedAudio: bytes(data.audioBytes),
            },
            storage.root,
        );
        if (data.restartRequired)
            storage.root.append(el("p", "Data actions use the active directory. Restart is required to change it.", "fieldDescription"));
        const content = surface("Stored content");
        const table = el("table", undefined, "lb-data-summary"),
            head = el("thead"),
            heading = el("tr"),
            body = el("tbody");
        table.setAttribute("aria-label", "Stored content categories");
        for (const title of ["Category", "Records", "Content size"]) {
            const cell = el("th", title);
            cell.scope = "col";
            heading.append(cell);
        }
        head.append(heading);
        for (const group of [...data.categories].sort((a, b) => categories.indexOf(a.name) - categories.indexOf(b.name))) {
            const row = el("tr"),
                name = el("th");
            name.scope = "row";
            const browse = button(
                categoryName(group.name),
                () => {
                    view = "Maintenance";
                    controls();
                    reset(async (node) => {
                        // Open the category directly using the same maintenance renderer.
                        await records(node, {});
                        const select = node.querySelector<HTMLSelectElement>('select[aria-label="Maintenance category"]');
                        if (select) {
                            select.value = group.name;
                            select.dispatchEvent(new Event("change"));
                        }
                    });
                },
                "quiet",
            );
            browse.setAttribute("aria-label", "Browse " + categoryName(group.name).toLowerCase());
            name.append(browse);
            row.append(name, el("td", String(group.count)), el("td", bytes(group.payloadBytes)));
            body.append(row);
        }
        const caption = el("caption", "Sizes measure stored payloads, not disk usage. Shared records are counted once.", "fieldDescription");
        table.append(caption, head, body);
        content.root.append(table);
        target.append(content.root);
        const retention = el("details");
        retention.append(el("summary", "Automatic cleanup and retention"), el("p", data.retention, "fieldDescription"));
        const internal = el("details");
        internal.append(el("summary", "Internal storage bookkeeping"));
        valueRows(data.bookkeeping, internal);
        target.append(retention, internal);
    }
    async function configuration(target: HTMLElement) {
        const revision = version,
            data = await api<Record<string, unknown>>("configuration");
        if (!active(revision)) return;
        target.replaceChildren(
            el("h3", "Saved plugin configuration"),
            el(
                "p",
                "Saved values only. Credential values are excluded; presence indicators show whether credentials are configured.",
                "fieldDescription",
            ),
        );
        const groups: [string, number, string[]][] = [
            ["General", 0, ["enableWebRenderer", "storagePath", "minimumMatch", "scheduledRetrieval"]],
            ["Sources", 1, ["sources"]],
            ["Services", 2, ["serviceSetup", "autoGeneratePronunciation"]],
            ["Display defaults", 3, ["defaults"]],
            ["Requests", 4, ["allowUserRequests", "autoApproveUserRequests", "userRequestDailyQuota", "userRequestActiveCap"]],
        ];
        function describe(value: unknown, parent: HTMLElement, label: string) {
            if (Array.isArray(value)) for (const item of value) describe(item, parent, label);
            else if (value && typeof value === "object") {
                const object = value as Record<string, unknown>;
                if (object.name) parent.append(el("h4", String(object.name)));
                valueRows(Object.fromEntries(Object.entries(object).filter(([key]) => key !== "name")), parent);
                for (const [key, child] of Object.entries(object))
                    if (child && typeof child === "object") {
                        parent.append(el("h5", readableLabel(key)));
                        describe(child, parent, key);
                    }
            } else valueRows({ [label]: value }, parent);
        }
        const covered = new Set<string>();
        for (const [title, index, keys] of groups) {
            if (!keys.some((key) => data[key] != null)) continue;
            const panel = { root: el("section", undefined, "lb-inspection-section"), heading: el("h4", title) };
            panel.root.setAttribute("role", "region");
            panel.root.setAttribute("aria-label", title);
            const heading = el("div", undefined, "lb-section-heading");
            const edit = rowAction("Edit", () => host.settings(index));
            edit.setAttribute("aria-label", "Edit " + title.toLowerCase());
            heading.append(panel.heading, edit);
            panel.root.append(heading);
            for (const key of keys) {
                covered.add(key);
                if (data[key] != null) describe(data[key], panel.root, key);
            }
            target.append(panel.root);
        }
        const additional = el("details");
        additional.append(el("summary", "Additional saved configuration"));
        for (const [key, value] of Object.entries(data)) if (!covered.has(key)) describe(value, additional, key);
        const raw = el("details");
        raw.append(el("summary", "Sanitized raw configuration"), el("pre", JSON.stringify(data, null, 2)));
        if (additional.childElementCount > 1) target.append(additional);
        target.append(raw);
    }
    const resize = () => revealSelectedTab(nav);
    return {
        show() {
            visible = true;
            window.addEventListener("resize", resize);
            if (!screens.length) activate(view);
        },
        hide() {
            visible = false;
            window.removeEventListener("resize", resize);
            ++version;
            selected.clear();
            syncSelection();
            if (current()?.review && !busy) back();
        },
    };
}
