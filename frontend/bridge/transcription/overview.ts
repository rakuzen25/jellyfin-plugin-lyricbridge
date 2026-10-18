import { type GenerationJob } from "../../contracts/generation.ts";
import type { FeedbackScope } from "../../shared/feedback.ts";
import { isRecord } from "../../shared/invariants.ts";
import { activeGeneration, parseGenerationJob } from "../jobs/generation-state.ts";
import { parseServiceOptions } from "../services/service-options.ts";
import { button, e } from "../ui/controls.ts";
import { feedbackHost } from "../ui/feedback.ts";
import { createTranscriptionSubmission } from "./submission.ts";
interface Dependencies {
    itemId: string;
    main: HTMLElement;
    footer: HTMLElement;
    feedback: FeedbackScope;
    api(path: string, method?: string, body?: unknown): Promise<unknown>;
    live(): boolean;
    notice(message: string, progress: boolean): void;
    failed(cause: unknown): void;
    admitted(job: GenerationJob, explicit?: boolean): void;
    open(id: string): void;
    deleted(id: string): void;
    deleteTranscript(parent: HTMLElement, id: string, capability: { readonly allowed: boolean; readonly reason: string | null }, count: number): void;
}
/** Result browsing owns its reads; switching to an editor invalidates every outstanding refresh. */
export function createTranscriptionOverview(d: Dependencies) {
    let revision = 0;
    async function show() {
        const currentRevision = ++revision;
        const current = () => d.live() && currentRevision === revision;
        try {
            const capabilities = await d.api("transcription");
            const results = await d.api("items/" + d.itemId + "/transcriptions");
            if (!current()) return;
            if (!isRecord(capabilities) || !Array.isArray(results)) throw new Error("Invalid transcription capabilities.");
            d.feedback.releaseWithin(d.main);
            d.main.replaceChildren();
            d.footer.replaceChildren();
            d.footer.hidden = true;
            d.main.classList.remove("lb-transcription-editor");
            d.main.classList.add("lb-transcription-overview");
            const options = parseServiceOptions(capabilities.options),
                ready = options.filter((o) => o.status === "Ready");
            const canTranscribe = capabilities.canTranscribe === true && ready.length > 0;
            let submission: ReturnType<typeof createTranscriptionSubmission> | undefined;
            if (canTranscribe) {
                submission = createTranscriptionSubmission({ ...d, options: ready, live: current, admitted: (job) => d.admitted(job, true) });
                d.main.append(submission.form);
                d.footer.append(...submission.actions.children);
                d.footer.hidden = false;
            } else {
                const reason =
                    typeof capabilities.unavailableReason === "string"
                        ? capabilities.unavailableReason
                        : options.length > 0 && options.every((o) => o.status === "Disabled")
                          ? "transcription_disabled"
                          : ready.length === 0
                            ? "service_not_configured"
                            : "requests_disabled";
                const explanation =
                    reason === "requests_disabled"
                        ? "User requests are disabled by your administrator."
                        : reason === "transcription_disabled"
                          ? "Transcription is turned off by your administrator."
                          : "No transcription service is configured.";
                const guidance =
                    capabilities.canUse === true
                        ? reason === "requests_disabled"
                            ? "Check Allow user generation requests in administrator settings → Requests."
                            : "Configure and enable a transcription option in administrator settings → Services."
                        : "An administrator can enable new transcription requests.";
                const availability = feedbackHost();
                d.main.append(availability);
                d.feedback.update(availability, {
                    message: "New transcription is unavailable",
                    secondary: explanation + " " + guidance + " Saved transcription results remain available below.",
                    severity: "warning",
                });
            }
            const retained = e("section", "lb-transcription-results"),
                heading = e("div", "lb-transcription-results-heading");
            heading.append(
                e("h3", "lb-section-title", "Saved transcription results"),
                button("Refresh recordings", () => void show(), "", { icon: "retry" }),
            );
            retained.append(heading);
            d.main.append(retained);
            for (const value of results) {
                if (!isRecord(value) || typeof value.id !== "string" || typeof value.language !== "string" || typeof value.timing !== "string")
                    throw new Error("Invalid transcription result.");
                const id = value.id,
                    row = e("section", "lb-frame lb-transcription-phrase");
                row.append(
                    e(
                        "p",
                        "lb-version-metadata",
                        (typeof value.optionName === "string" ? value.optionName + " · " : "") +
                            value.language +
                            " · " +
                            value.timing +
                            " timing · " +
                            value.tokenCount +
                            " tokens",
                    ),
                );
                const actions = e("div", "lb-song-actions");
                actions.append(button("Review line breaks", () => d.open(id), "", { icon: "edit" }));
                const capability =
                    isRecord(value.deletion) && typeof value.deletion.allowed === "boolean"
                        ? { allowed: value.deletion.allowed, reason: typeof value.deletion.reason === "string" ? value.deletion.reason : null }
                        : { allowed: false, reason: "Deletion permissions are unavailable. Refresh recordings." };
                d.deleteTranscript(actions, id, capability, typeof value.savedEntryCount === "number" ? value.savedEntryCount : 0);
                row.append(actions);
                retained.append(row);
            }
            if (!results.length) retained.append(e("p", "lb-help", "No transcription results yet. Successful results stay here until deleted."));
            const staged = await d.api("items/" + d.itemId + "/transcription-uploads");
            if (!current()) return;
            if (Array.isArray(staged))
                for (const upload of staged) {
                    if (!isRecord(upload) || typeof upload.id !== "string" || typeof upload.bytes !== "number") continue;
                    const id = upload.id,
                        row = e("div", "lb-song-actions");
                    row.append(
                        e("span", "lb-help", "Staged audio · " + (upload.bytes / 1_000_000).toFixed(1) + " MB"),
                        ...(submission ? [button("Use staged audio", () => void submission?.submit(id), "", { icon: "generate" })] : []),
                        button(
                            "Discard staged audio",
                            async () => {
                                try {
                                    await d.api("items/" + d.itemId + "/transcription-uploads/" + id, "DELETE");
                                    if (current()) await show();
                                } catch (cause) {
                                    if (current()) d.failed(cause);
                                }
                            },
                            "",
                            { icon: "trash" },
                        ),
                    );
                    d.main.append(row);
                }
            const jobs = await d.api("jobs?active=true&itemId=" + d.itemId);
            if (current() && Array.isArray(jobs))
                for (const value of jobs) {
                    const job = parseGenerationJob(value);
                    if (job.taskKind && job.taskKind !== "language" && !job.outputDeleted && activeGeneration(job)) d.admitted(job);
                }
        } catch (cause) {
            if (current()) d.failed(cause);
        }
    }
    async function removeTranscript(id: string): Promise<void> {
        try {
            await d.api("items/" + d.itemId + "/transcriptions/" + id, "DELETE");
            if (d.live()) d.deleted(id);
        } catch (cause) {
            if (d.live()) d.failed(cause);
        }
    }
    return {
        show,
        removeTranscript,
        invalidate: () => {
            revision++;
        },
    };
}
