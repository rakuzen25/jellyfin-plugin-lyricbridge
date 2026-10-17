import { adminButton as button } from "./controls.ts";
import { element as el, actionRow, formatBytes, readableLabel } from "./ui.ts";
import { recordType, type StoredRecord, type Target, type DataHost } from "./data-contracts.ts";
import { hostFailure } from "./contracts.ts";

interface InspectionContext {
    readOnly?: boolean;
    originId?: string;
    inspect(target: Target): void;
    remove?(record: StoredRecord): void;
    cancel?(record: StoredRecord): Promise<void>;
}
const timestamp = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
};
/** Full details deliberately have no management-list row or nested cards. */
export function renderInspector(root: HTMLElement, item: StoredRecord, context: InspectionContext) {
    const type = item.displayType || recordType(item.target.kind);
    const header = el("header", undefined, "lb-inspection-header");
    const heading = el("h3", type);
    heading.tabIndex = -1;
    header.append(heading);
    const identities = [...(item.songs || []), ...(item.accounts || [])].sort(
        (a, b) => Number(b.id === context.originId) - Number(a.id === context.originId),
    );
    const names = identities.map((owner) => owner.name + (owner.missing ? " · Missing from Jellyfin" : ""));
    if (names.length) header.append(el("p", names[0] + (names.length > 1 ? " · " + names.length + " associated songs/accounts" : "")));
    if (item.title && item.title !== item.target.kind && item.title !== type && !identities.some((owner) => owner.name === item.title))
        header.append(el("p", item.title));
    const metadata = [item.source, item.storedAt ? new Date(item.storedAt).toLocaleString() : "", formatBytes(item.payloadBytes)].filter(Boolean);
    header.append(el("p", metadata.join(" · "), "fieldDescription"));
    const inspection = item.inspection;
    const restriction = inspection?.restriction || item.blocker;
    if (restriction) header.append(el("p", restriction, "lb-inspection-restriction fieldDescription"));
    const relationships =
        inspection?.relationships || item.dependencies.map((target) => ({ role: "blocker", target, label: recordType(target.kind), missing: false }));
    function relationship(link: (typeof relationships)[number]) {
        return link.missing
            ? el("p", link.label + " · Referenced record is missing", "fieldDescription")
            : button(link.label, () => context.inspect(link.target), "quiet");
    }
    if (restriction) {
        const links = actionRow();
        for (const link of relationships.filter((value) => value.role === "owner" || value.role === "blocker")) links.append(relationship(link));
        if (links.childElementCount) header.append(links);
    }
    if (!context.readOnly) {
        const actions = actionRow();
        if (item.canDelete && context.remove) {
            const remove = button("Delete", () => context.remove!(item));
            remove.classList.add("lb-material-destructive");
            actions.append(remove);
        }
        if (inspection?.canCancel && context.cancel) {
            const confirm = el("div");
            actions.append(
                button("Cancel request", () => {
                    confirm.replaceChildren(
                        el("p", "Cancel this request?"),
                        actionRow(
                            button("Confirm cancellation", async () => {
                                try {
                                    await context.cancel!(item);
                                } catch (error) {
                                    confirm.append(el("p", hostFailure(error).message || "Cancellation failed. Try again."));
                                }
                            }),
                            button("Keep request", () => confirm.replaceChildren(), "quiet"),
                        ),
                    );
                }),
            );
            actions.append(confirm);
        }
        if (actions.childElementCount) header.append(actions);
    }
    root.append(header);
    function fields(title: string, values: { label: string; value: string; format?: string }[]) {
        if (!values.length) return;
        const section = el("section", undefined, "lb-inspection-section"),
            list = el("dl", undefined, "lb-value-list");
        section.append(el("h4", title), list);
        for (const field of values) {
            const value =
                field.format === "date"
                    ? new Date(field.value).toLocaleString()
                    : field.format === "label"
                      ? readableLabel(field.value)
                      : field.format === "percent"
                        ? field.value + "%"
                        : field.format === "seconds"
                          ? field.value + " seconds"
                          : field.format === "bytes"
                            ? formatBytes(Number(field.value))
                            : field.value;
            list.append(el("dt", field.label), el("dd", value));
        }
        root.append(section);
    }
    const lines = inspection?.lines || (item.readableText ? item.readableText.split("\n").map((text) => ({ text, startSeconds: undefined })) : []);
    if (lines.length) {
        const section = el("section", undefined, "lb-inspection-section");
        section.append(el("h4", "Content"));
        for (const line of lines) {
            const row = el("div", undefined, "lb-inspection-line");
            row.append(el("span", line.startSeconds == null ? "" : timestamp(line.startSeconds), "fieldDescription"), el("span", line.text || " "));
            section.append(row);
        }
        root.append(section);
    }
    fields("Stored values", inspection?.fields || []);
    fields("Provenance", inspection?.metadata || []);
    if (relationships.length || identities.length) {
        const section = el("section", undefined, "lb-inspection-section");
        section.append(el("h4", "Relationships and dependencies"));
        if (names.length) section.append(el("p", "Associated songs and accounts"), ...names.map((name) => el("p", name, "fieldDescription")));
        for (const role of [...new Set(relationships.map((link) => link.role))]) {
            section.append(el("h5", readableLabel(role)));
            for (const link of relationships.filter((value) => value.role === role)) section.append(relationship(link));
        }
        root.append(section);
    }
    const technical = el("details", undefined, "lb-inspection-technical");
    technical.append(
        el("summary", "Technical details"),
        el("p", "Storage kind: " + item.target.kind),
        el("p", "Stored ID: " + item.target.id),
        el("pre", JSON.stringify({ target: item.target, itemIds: item.itemIds, userIds: item.userIds, relationships, data: item.data }, null, 2)),
    );
    root.append(technical);
    heading.focus({ preventScroll: true });
}

/** Keep the originating DOM mounted, including snapshot confirmation and expiry timer. */
export function createInspectionNavigation(
    root: HTMLElement,
    origin: HTMLElement,
    host: DataHost,
    readOnly = true,
    remove?: (record: StoredRecord) => void,
) {
    const stack: { root: HTMLElement; focus: HTMLElement | null; scroll: number; label?: string }[] = [];
    let disposed = false;
    function back() {
        const leaving = stack.pop();
        if (!leaving) return;
        leaving.root.remove();
        const previous = stack.at(-1)?.root || origin;
        previous.hidden = false;
        leaving.focus?.focus({ preventScroll: true });
        window.scrollTo({ top: leaving.scroll });
    }
    async function inspect(target: Target) {
        disposed = false;
        const previous = stack.at(-1)?.root || origin;
        const layer = el("div", undefined, "lb-admin-screen lb-inspection");
        const entry: (typeof stack)[number] = {
            root: layer,
            focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
            scroll: window.scrollY,
        };
        previous.hidden = true;
        stack.push(entry);
        root.append(layer);
        layer.append(button("Back to " + (stack.length > 1 ? "previous record" : "previous view"), back, "quiet"));
        const content = el("div");
        layer.append(content);
        const load = async () => {
            content.replaceChildren(el("p", "Loading record…"));
            content.setAttribute("role", "status");
            try {
                const item = await host.call<StoredRecord>("admin/data/detail?" + new URLSearchParams({ kind: target.kind, id: target.id }));
                if (disposed || !layer.isConnected) return;
                content.replaceChildren();
                content.removeAttribute("role");
                entry.label = item.displayType || recordType(item.target.kind);
                const breadcrumb = el(
                    "nav",
                    [readOnly ? "Deletion review" : "Requests", ...stack.map((screen) => screen.label).filter(Boolean)].join(" / "),
                    "lb-breadcrumbs",
                );
                breadcrumb.setAttribute("aria-label", "Inspection location");
                content.append(breadcrumb);
                renderInspector(content, item, {
                    readOnly,
                    inspect: (next) => void inspect(next),
                    remove,
                    cancel: async (record) => {
                        await host.call("admin/data/requests/" + encodeURIComponent(record.target.id) + "/cancel", "POST");
                        await load();
                    },
                });
            } catch (error) {
                if (disposed || !layer.isConnected) return;
                content.replaceChildren(
                    el("p", hostFailure(error).message || "Record unavailable."),
                    button("Retry inspection", () => void load()),
                );
            }
        };
        await load();
    }
    return {
        inspect,
        dispose() {
            disposed = true;
            for (const entry of stack) entry.root.remove();
            stack.length = 0;
            origin.hidden = false;
        },
    };
}
