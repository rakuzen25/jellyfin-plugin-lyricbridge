import { adminButton as button } from "./ui/controls.ts";

export interface StartupStatus {
    state: "initializing" | "ready" | "blocked";
    phase: string;
    message?: string;
    diagnosticId?: string;
    path?: string;
}
interface UpgradeRecord {
    id: string;
    domain: string;
    fromVersion: number;
    toVersion: number;
    sourcePluginVersion: string;
    targetPluginVersion: string;
    state: string;
    completed?: string;
    acknowledged: boolean;
    backupState: string;
    backupPath: string;
    sourcePath: string;
    backupBytes: number;
    expires: string;
}
type Request = <T>(path: string, method?: string, data?: unknown) => Promise<T>;
export function createUpgradesPanel(target: HTMLElement, request: Request) {
    let revision = 0;
    function text(tag: "p" | "h3" | "summary", value: string) {
        const element = document.createElement(tag);
        element.textContent = value;
        return element;
    }
    async function refresh(): Promise<StartupStatus> {
        const current = ++revision;
        const startup = await request<StartupStatus>("admin/startup");
        const records = await request<UpgradeRecord[]>("admin/upgrades").catch(() => null);
        if (current !== revision) return startup;
        target.replaceChildren();
        target.hidden = startup.state === "ready" && records?.length === 0;
        if (startup.state !== "ready") {
            target.append(
                text("h3", startup.state === "blocked" ? "LyricBridge startup is blocked" : "LyricBridge is starting"),
                text("p", "Phase: " + startup.phase + ". " + (startup.message || "Wait for initialization, then reload this page.")),
            );
            if (startup.path) target.append(text("p", "Affected path: " + startup.path));
            if (startup.diagnosticId) target.append(text("p", "Diagnostic: " + startup.diagnosticId));
            target.append(
                text(
                    "p",
                    "Preserve the affected files. Correct the reported problem or use fresh state or a compatible plugin release, then restart Jellyfin.",
                ),
            );
        }
        if (records === null) target.append(text("p", "Upgrade history could not load. Check the server logs and reload this page."));
        if (records?.some((record) => record.state === "complete" && !record.acknowledged))
            target.append(text("h3", "LyricBridge upgraded saved data. Review the results and automatic backups."));
        if (records?.length) {
            const history = document.createElement("details");
            history.open = records.some((record) => record.state === "complete" && !record.acknowledged);
            history.append(text("summary", "Upgrade history and backups"));
            for (const record of records) {
                const row = document.createElement("section");
                row.append(
                    text("h3", record.domain + ": schema " + record.fromVersion + " \u2192 " + record.toVersion + " (" + record.state + ")"),
                    text(
                        "p",
                        "Plugin " +
                            (record.sourcePluginVersion || "unknown") +
                            " \u2192 " +
                            record.targetPluginVersion +
                            ". " +
                            (record.completed ? "Completed " + new Date(record.completed).toLocaleString() : "Incomplete") +
                            ".",
                    ),
                    text(
                        "p",
                        "Backup: " +
                            record.backupState +
                            ". " +
                            record.backupBytes.toLocaleString() +
                            " bytes. Expires " +
                            new Date(record.expires).toLocaleString() +
                            ".",
                    ),
                );
                row.append(text("p", "Original location: " + record.sourcePath));
                if (["available", "incomplete"].includes(record.backupState)) row.append(text("p", record.backupPath));
                if (record.backupState === "incomplete") row.append(text("p", "This backup did not finish. Use an independent backup for recovery."));
                const feedback = text("p", "");
                const act = async (operation: () => Promise<void>, refreshAfter = true) => {
                    const actionRevision = revision;
                    try {
                        await operation();
                        if (refreshAfter && actionRevision === revision) await refresh();
                    } catch {
                        feedback.textContent = "The action failed. Reload the upgrade history and try again.";
                    }
                };
                if (record.state === "complete" && !record.acknowledged)
                    row.append(
                        button("Acknowledge upgrade", () =>
                            act(async () => {
                                await request("admin/upgrades/" + record.id + "/acknowledge", "POST");
                            }),
                        ),
                    );
                if (["available", "incomplete"].includes(record.backupState))
                    row.append(
                        button("Review backup deletion", () =>
                            act(async () => {
                                const previewRevision = revision;
                                const preview = await request<{ token: string; path: string; bytes: number }>(
                                    "admin/upgrades/" + record.id + "/backup-deletion-preview",
                                    "POST",
                                );
                                if (previewRevision !== revision) return;
                                const dialog = document.createElement("dialog");
                                dialog.append(
                                    text("h3", "Delete automatic backup?"),
                                    text(
                                        "p",
                                        preview.path +
                                            " (" +
                                            preview.bytes.toLocaleString() +
                                            " bytes). This permanently removes the backup. Current data is retained.",
                                    ),
                                );
                                dialog.append(
                                    button("Delete backup", async () => {
                                        try {
                                            await request("admin/upgrades/" + record.id + "/backup", "DELETE", { token: preview.token });
                                            dialog.close();
                                            dialog.remove();
                                            await refresh();
                                        } catch {
                                            feedback.textContent = "Backup deletion failed. Preview it again before retrying.";
                                            dialog.close();
                                            dialog.remove();
                                        }
                                    }),
                                    button("Cancel", () => {
                                        dialog.close();
                                        dialog.remove();
                                    }),
                                );
                                dialog.addEventListener("cancel", () => dialog.remove(), { once: true });
                                target.append(dialog);
                                dialog.showModal();
                            }, false),
                        ),
                    );
                row.append(feedback);
                history.append(row);
            }
            const guide = document.createElement("a");
            guide.href =
                "https://github.com/rakuzen25/jellyfin-plugin-lyricbridge/blob/main/docs/how-to/install.md#downgrade-and-restore-an-upgrade-backup";
            guide.textContent = "Downgrade and restore a backup";
            guide.target = "_blank";
            guide.rel = "noopener noreferrer";
            history.append(guide);
            target.append(history);
        }
        return startup;
    }
    function dispose() {
        revision++;
        target.querySelectorAll("dialog").forEach((dialog) => {
            dialog.close();
            dialog.remove();
        });
    }
    return { refresh, dispose };
}
