import { createInspectionNavigation } from "./record-inspector.ts";
import { adminButton as button } from "./controls.ts";
import { element as el, surface, actionRow, fieldControl, formatBytes } from "./ui.ts";
import { settingsRowHeader } from "./settings-row.ts";
import { hostFailure } from "./contracts.ts";
import { targetKey, recordType, type DataHost, type DataResult, type Selection, type Preview } from "./data-contracts.ts";

/** One snapshot-bound review/results flow shared by Data and request history. */
export function createDataReview(root: HTMLElement, host: DataHost, back: (refresh: boolean) => void, deleted: (keys: string[]) => void = () => {}) {
    root.dataset.configTransient = "true";
    const preventSubmit = (event: KeyboardEvent) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
    };
    root.addEventListener("keydown", preventSubmit);
    let active = true,
        running = false,
        timer: ReturnType<typeof setTimeout> | undefined;
    const status = el("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const body = el("div");
    root.append(status, body);
    const inspection = createInspectionNavigation(root, body, host);
    const api = <T>(path: string, data: unknown) => host.call<T>("admin/data/" + path, "POST", data);
    const message = (text: string, error = false) => host.feedback(status, text, error);
    const close = (refresh: boolean) => {
        active = false;
        inspection.dispose();
        clearTimeout(timer);
        root.removeEventListener("keydown", preventSubmit);
        back(refresh);
    };
    async function open(selection: Selection) {
        if (running || !active) return;
        clearTimeout(timer);
        if (selection.action === "factory-reset" && host.busy()) {
            message("Wait for settings to finish loading or saving before factory reset.", true);
            return;
        }
        if (selection.action === "factory-reset" && host.unsaved()) {
            body.replaceChildren(
                el("h3", "Discard unsaved settings before factory reset?"),
                el("p", "Factory reset replaces settings and credentials. All unfinished settings and editor drafts must be discarded first."),
                actionRow(
                    button("Discard edits and preview factory reset", async () => {
                        try {
                            await host.discard();
                            if (active) await open(selection);
                        } catch {
                            message("Settings could not reload. Your drafts have not been confirmed for reset.", true);
                        }
                    }),
                    button("Keep editing settings", () => close(false), "quiet"),
                ),
            );
            body.querySelector<HTMLButtonElement>("button")?.focus();
            return;
        }
        message("Preparing deletion preview…");
        try {
            const proposed = await api<Preview>("preview", selection);
            if (!active) return;
            message("");
            body.replaceChildren();
            const review = surface("Review deletion", "Only the targets in this snapshot are confirmed. Newly matching data will not be included.");
            body.append(review.root);
            for (const effect of proposed.effects) review.root.append(el("p", effect, "fieldDescription"));
            const blocked = proposed.items.filter((item) => !item.canDelete).length;
            review.root.append(
                el(
                    "p",
                    proposed.items.length +
                        " records in this snapshot · " +
                        blocked +
                        " blocked. Expires " +
                        new Date(proposed.expires).toLocaleTimeString() +
                        ".",
                ),
            );
            const targets = el("details");
            targets.open = true;
            targets.append(el("summary", "Affected records and blockers"));
            for (const item of proposed.items) {
                const row = el("div", undefined, "lb-settings-row");
                const header = settingsRowHeader(
                    item.title,
                    recordType(item.target.kind) + " · " + formatBytes(item.payloadBytes),
                    item.canDelete ? undefined : "Blocked",
                );
                row.append(header.root);
                if (item.blocker) header.body.append(el("p", item.blocker, "fieldDescription"));
                const references = el("details");
                references.append(el("summary", "Shared references and dependencies"), el("code", targetKey(item.target)));
                for (const identity of [...(item.songs || []), ...(item.accounts || [])])
                    references.append(el("p", identity.name + (identity.missing ? " · Missing from Jellyfin" : ""), "fieldDescription"));
                if (!item.songs?.length && item.itemIds.length) references.append(el("p", "Songs: " + item.itemIds.join(", "), "fieldDescription"));
                if (!item.accounts?.length && item.userIds.length)
                    references.append(el("p", "Accounts: " + item.userIds.join(", "), "fieldDescription"));
                for (const dependency of item.dependencies)
                    references.append(el("p", "Required by " + recordType(dependency.kind) + " · " + dependency.id, "fieldDescription"));
                for (const dependency of item.dependencies) {
                    const inspect = button(
                        "Inspect " + recordType(dependency.kind),
                        async () => {
                            await inspection.inspect(dependency);
                        },
                        "quiet",
                    );
                    references.append(inspect);
                }
                references.open = !item.canDelete;
                header.body.append(references);
                targets.append(row);
            }
            review.root.append(targets);
            let input: HTMLInputElement | undefined;
            const expired = () => Date.now() >= Date.parse(proposed.expires);
            const confirm = button("Confirm deletion", async () => {
                if (expired()) {
                    message("This preview expired. Renew it and review the new snapshot.", true);
                    confirm.disabled = true;
                    return;
                }
                if (selection.action === "factory-reset" && host.unsaved()) {
                    await open(selection);
                    return;
                }
                running = true;
                clearTimeout(timer);
                confirm.disabled = true;
                cancel.disabled = true;
                renew.disabled = true;
                if (input) input.disabled = true;
                host.maintenance(true);
                message("Deleting stored data…");
                try {
                    const result = await api<DataResult>("execute", { token: proposed.token, confirmed: true, confirmation: input?.value || "" });
                    deleted(result.outcomes.filter((item) => item.status === "deleted").map((item) => targetKey(item.target)));
                    if (selection.action === "factory-reset") await host.reload();
                    if (!active) return;
                    body.replaceChildren();
                    const summary = surface(result.complete ? "Data action finished" : "Data action needs attention");
                    for (const state of ["deleted", "skipped", "failed"])
                        summary.root.append(el("p", state + ": " + result.outcomes.filter((item) => item.status === state).length));
                    if (result.phase) summary.root.append(el("p", "Phase: " + result.phase, "fieldDescription"));
                    const outcomes = el("details");
                    outcomes.open = !result.complete;
                    outcomes.append(el("summary", "Per-record outcomes"));
                    for (const item of result.outcomes)
                        outcomes.append(
                            el("p", item.status + ": " + targetKey(item.target) + (item.message ? " — " + item.message : ""), "fieldDescription"),
                        );
                    summary.root.append(
                        outcomes,
                        button("Return and refresh", () => close(true)),
                    );
                    if (!result.complete) summary.root.append(button("Preview retry", () => void open(selection), "quiet"));
                    body.append(summary.root);
                    message(
                        result.complete ? "Data action finished." : "Some items or phases need attention. Retry always requires a fresh preview.",
                        !result.complete,
                    );
                    body.querySelector<HTMLButtonElement>("button")?.focus();
                } catch (caught) {
                    if (!active) return;
                    message(hostFailure(caught).message || "Deletion failed.", true);
                    body.replaceChildren(
                        el("h3", "A new preview is required"),
                        el("p", "Confirmation is no longer usable. Review a fresh snapshot before retrying."),
                        actionRow(
                            button("Renew preview", () => void open(selection)),
                            button("Return and refresh", () => close(true), "quiet"),
                        ),
                    );
                } finally {
                    running = false;
                    host.maintenance(false);
                }
            });
            confirm.classList.add("lb-material-destructive");
            const cancel = button("Cancel deletion", () => close(false), "quiet");
            const renew = button("Renew preview", () => void open(selection), "quiet");
            if (proposed.confirmation) {
                const field = fieldControl("Type " + proposed.confirmation + " to confirm");
                input = field.input as HTMLInputElement;
                input.autocomplete = "off";
                input.oninput = () => {
                    confirm.disabled = expired() || input!.value !== proposed.confirmation;
                };
                review.root.append(field.root);
            }
            confirm.disabled = expired() || !!proposed.confirmation;
            review.root.append(actionRow(confirm, cancel, renew));
            timer = setTimeout(
                () => {
                    if (!active) return;
                    confirm.disabled = true;
                    message("This preview expired. Renew it and review the new snapshot.", true);
                },
                Math.max(0, Math.min(Date.parse(proposed.expires) - Date.now(), 2147483647)),
            );
            (input || cancel).focus();
        } catch (caught) {
            if (active) {
                message(hostFailure(caught).message || "Preview could not load.", true);
                body.replaceChildren(
                    actionRow(
                        button("Retry preview", () => void open(selection)),
                        button("Back", () => close(false), "quiet"),
                    ),
                );
            }
        }
    }
    return {
        open,
        dispose() {
            active = false;
            inspection.dispose();
            clearTimeout(timer);
            root.removeEventListener("keydown", preventSubmit);
        },
        get running() {
            return running;
        },
    };
}
