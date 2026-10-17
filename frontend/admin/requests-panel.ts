import { createInspectionNavigation } from "./record-inspector.ts";
import { adminButton as button } from "./controls.ts";
import { settingsRowHeader, rowAction } from "./settings-row.ts";
import { element as el, surface, actionRow } from "./ui.ts";
import { createDataReview } from "./data-review.ts";
import type { DataHost, DataPage, Target } from "./data-contracts.ts";
import { hostFailure, type JobSummary } from "./contracts.ts";

export function createRequestsPanel(root: HTMLElement, host: DataHost, active: () => boolean) {
    root.dataset.configTransient = "true";
    const container = root.closest<HTMLElement>("[data-tab]")!;
    const workspace = container.querySelector<HTMLElement>(".lb-request-workspace")!;
    const reviewRoot = el("div");
    reviewRoot.hidden = true;
    container.append(reviewRoot);
    const inspection = createInspectionNavigation(container, workspace, host, false, (record) => {
        inspection.dispose();
        void reviewHistory([], [record.target]);
    });
    let review: ReturnType<typeof createDataReview> | undefined,
        revision = 0;
    const offsets = { active: 0, finished: 0 };
    const status = el("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(status);
    async function reviewHistory(ids: string[], targets?: Target[]) {
        const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null,
            scroll = window.scrollY;
        workspace.hidden = true;
        reviewRoot.hidden = false;
        reviewRoot.replaceChildren();
        review = createDataReview(reviewRoot, host, (refresh) => {
            review?.dispose();
            review = undefined;
            reviewRoot.hidden = true;
            workspace.hidden = false;
            const restore = () => {
                if (focus?.isConnected) focus.focus({ preventScroll: true });
                window.scrollTo({ top: scroll });
            };
            if (refresh) void load().then(restore);
            else restore();
        });
        await review.open({ action: "delete", targets: targets || ids.map((id) => ({ kind: "job", id })) });
    }
    async function load() {
        if (!active() || review) return;
        const current = ++revision;
        host.feedback(status, "Loading requests…");
        try {
            const results = await Promise.all(
                (["active", "finished"] as const).map(async (group) => {
                    const page = await host.call<DataPage<JobSummary>>("admin/requests?group=" + group + "&offset=" + offsets[group] + "&limit=50");
                    return { group, page };
                }),
            );
            if (!active() || current !== revision) return;
            root.replaceChildren(status);
            for (const { group, page } of results) {
                root.append(renderGroup(group, page));
            }
            host.feedback(status, "");
        } catch (caught) {
            if (active() && current === revision) {
                host.feedback(status, hostFailure(caught).message || "Requests could not load. Refresh to retry.", true);
                status.append(button("Retry requests", load, "quiet"));
            }
        }
    }
    function renderGroup(group: "active" | "finished", page: DataPage<JobSummary>) {
        const panel = surface(
            group === "active" ? "Active requests" : "Finished history",
            group === "active"
                ? "Request actions apply immediately and do not use Save settings."
                : "Finished requests are retained for 30 days. Removing history preserves saved results and does not restore quota.",
        );
        panel.heading.append(button("Refresh " + (group === "active" ? "active requests" : "history"), load, "quiet"));
        for (const job of page.items) {
            const row = el("div", undefined, "lb-settings-row");
            row.dataset.jobId = job.id;
            const heading = settingsRowHeader(
                job.title || job.request.kind + (job.request.language ? " · " + job.request.language : ""),
                [job.artist, job.taskKind, job.stage, String(job.progress) + "%"].filter(Boolean).join(" · "),
                job.state,
            );
            const feedback = el("div");
            feedback.setAttribute("role", "status");
            feedback.setAttribute("aria-live", "polite");
            row.append(heading.root);
            heading.body.append(feedback);
            if (job.error) heading.body.append(el("p", job.error, "fieldDescription"));
            if (job.outputDeleted) heading.body.append(el("p", "The stored output was deleted; retry is unavailable.", "fieldDescription"));
            const actions = job.outputDeleted
                ? []
                : job.state === "pending"
                  ? ["approve", "reject", "cancel"]
                  : ["queued", "running"].includes(job.state)
                    ? ["cancel"]
                    : ["failed", "settings_changed"].includes(job.state)
                      ? ["retry"]
                      : [];
            let planIdentity: string | undefined;
            for (const action of actions) {
                async function run() {
                    row.querySelectorAll<HTMLButtonElement>("button").forEach((control) => (control.disabled = true));
                    host.feedback(feedback, "Updating request…");
                    try {
                        await host.call(
                            "jobs/" +
                                encodeURIComponent(job.id) +
                                "/" +
                                action +
                                (planIdentity ? "?planIdentity=" + encodeURIComponent(planIdentity) : ""),
                            "POST",
                        );
                        await load();
                    } catch (caught) {
                        host.feedback(feedback, hostFailure(caught).message || "Request action failed. Refresh before retrying.", true);
                        feedback.append(button("Refresh requests", load, "quiet"));
                    }
                }
                const control = rowAction(
                    action[0]!.toUpperCase() + action.slice(1),
                    () => {
                        if (action !== "reject" && action !== "cancel") return run();
                        const question = el("div", undefined, "lb-inline-confirmation");
                        question.append(
                            el("p", (action === "reject" ? "Reject" : "Cancel") + " this request?"),
                            actionRow(
                                button("Confirm " + action, run),
                                button(
                                    "Keep request",
                                    () => {
                                        question.remove();
                                        control.focus();
                                    },
                                    "quiet",
                                ),
                            ),
                        );
                        feedback.replaceChildren(question);
                        question.querySelector<HTMLButtonElement>("button")?.focus();
                    },
                    "quiet",
                );
                if (["cancel", "reject"].includes(action)) control.classList.add("lb-material-destructive");
                heading.actions.append(control);
                if (action === "retry" && job.taskKind === "boundary-review") {
                    control.disabled = true;
                    void host
                        .call<{ identity: string; requestCount: number }>("jobs/" + encodeURIComponent(job.id) + "/review-plan", "POST")
                        .then((plan) => {
                            if (!control.isConnected) return;
                            planIdentity = plan.identity;
                            control.textContent = "Retry · " + plan.requestCount + " AI requests";
                            control.disabled = false;
                        })
                        .catch(() => {
                            if (control.isConnected)
                                heading.body.append(el("p", "Retry planning failed. Refresh requests to retry.", "fieldDescription"));
                        });
                }
            }
            if (group === "finished") heading.actions.append(rowAction("Remove from history", () => reviewHistory([job.id]), "destructive"));
            if (job.audio?.allowChunking) heading.body.append(el("p", job.audio.chunkCount + " chunks · one request", "fieldDescription"));
            const details = el("details");
            details.append(el("summary", "Request details"));
            const values = job as unknown as Record<string, unknown>;
            for (const key of ["created", "terminalAt"])
                if (values[key])
                    details.append(el("p", (key === "created" ? "Created: " : "Finished: ") + new Date(String(values[key])).toLocaleString()));
            const profile = values.profile as Record<string, unknown> | undefined;
            if (profile) details.append(el("p", [profile.service, profile.model].filter(Boolean).join(" · ")));
            if (job.request.language) details.append(el("p", "Language: " + job.request.language));
            if (job.error) details.append(el("p", "Outcome: " + job.error));
            const technical = el("details");
            technical.append(el("summary", "Technical details"), el("code", job.id));
            details.append(technical);
            heading.actions.append(rowAction("Inspect stored request", () => inspection.inspect({ kind: "job", id: job.id })));
            heading.body.append(details);
            panel.root.append(row);
        }
        const navigation = el("div", undefined, "lb-admin-pagination");
        navigation.append(
            el(
                "span",
                page.total && page.offset < page.total
                    ? page.offset + 1 + "–" + Math.min(page.offset + 50, page.total) + " of " + page.total
                    : "No requests on this page",
                "fieldDescription",
            ),
        );
        if (page.total > 50 || page.offset)
            navigation.append(
                actionRow(
                    button(
                        "Newer " + group + " requests",
                        page.offset
                            ? () => {
                                  offsets[group] = Math.max(0, page.offset - 50);
                                  void load();
                              }
                            : null,
                        "quiet",
                    ),
                    button(
                        "Older " + group + " requests",
                        page.offset + 50 < page.total
                            ? () => {
                                  offsets[group] = page.offset + 50;
                                  void load();
                              }
                            : null,
                        "quiet",
                    ),
                ),
            );
        navigation.classList.add("lb-list-footer");
        panel.root.append(navigation);
        if (group === "finished" && page.total)
            navigation.append(
                rowAction(
                    "Clear finished history",
                    async () => {
                        try {
                            const ids: string[] = [];
                            for (let offset = 0; ; offset += 500) {
                                const snapshot = await host.call<DataPage<JobSummary>>(
                                    "admin/requests?group=finished&offset=" + offset + "&limit=500",
                                );
                                ids.push(...snapshot.items.map((job) => job.id));
                                if (ids.length > 10000) throw new Error("Narrow cleanup to at most 10,000 requests.");
                                if (offset + snapshot.items.length >= snapshot.total || !snapshot.items.length) break;
                            }
                            if (active()) await reviewHistory([...new Set(ids)]);
                        } catch (caught) {
                            host.feedback(status, hostFailure(caught).message || "History could not load.", true);
                        }
                    },
                    "destructive",
                ),
            );
        return panel.root;
    }
    return {
        refresh: load,
        hide() {
            inspection.dispose();
            revision++;
            if (review && !review.running) {
                review.dispose();
                review = undefined;
                reviewRoot.hidden = true;
                workspace.hidden = false;
            }
        },
    };
}
