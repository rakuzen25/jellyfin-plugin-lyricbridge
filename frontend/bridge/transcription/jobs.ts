import { type GenerationJob } from "../../contracts/generation.ts";
import type { FeedbackAction } from "../../shared/feedback.ts";
import { isRecord } from "../../shared/invariants.ts";
import { activeGeneration, GenerationMonitor, parseGenerationJob } from "../jobs/generation-state.ts";
import type { TrackScope } from "../session/contracts.ts";
import { BridgeRequestError } from "../transport/api.ts";
import type { PlaybackNotifications } from "../ui/playback-notifications.ts";
interface Dependencies {
    scope(): TrackScope | null;
    api(path: string, method?: string, body?: unknown, signal?: AbortSignal | null): Promise<unknown>;
    notifications(): Pick<PlaybackNotifications, "set" | "remove"> | null;
    open(transcriptId: string, reviewResultId?: string): void;
    reviewCompleted(transcriptId: string): void | Promise<void>;
}
const description = (error: unknown) => (error instanceof Error ? error.message : "The transcription action could not complete.");
/** Track-owned monitors outlive panel sessions and release with their captured track. */
export function createTranscriptionJobs(d: Dependencies) {
    const watched = new Map<string, GenerationMonitor>();
    const releaseWatch = new Map<string, () => void>();
    function watch(job: GenerationJob, target: TrackScope, explicit = false) {
        if (d.scope() !== target || target.controller.signal.aborted) return;
        if (!explicit && (watched.has(job.id) || target.dismissedJobs?.has(job.id))) return;
        if (explicit) target.dismissedJobs?.delete(job.id);
        releaseWatch.get(job.id)?.();
        const operation = "job:" + job.id;
        let latest = job;
        let retryPlan: { identity: string; requestCount: number } | null = null;
        let planningRetry = false;
        async function planRetry(explicit = false) {
            if (!current()) return;
            if (planningRetry || retryPlan || latest.taskKind !== "boundary-review" || !["failed", "settings_changed"].includes(latest.state)) return;
            planningRetry = true;
            try {
                const plan = await d.api("jobs/" + job.id + "/review-plan", "POST", undefined, target.controller.signal);
                if (!current()) return;
                if (!isRecord(plan) || typeof plan.identity !== "string" || !Number.isSafeInteger(plan.requestCount) || Number(plan.requestCount) < 1)
                    throw new Error("Could not plan AI review. Refresh requests after checking the service settings.");
                retryPlan = { identity: plan.identity, requestCount: Number(plan.requestCount) };
                present();
            } catch (error) {
                if (!current()) return;
                if (error instanceof BridgeRequestError && error.status === 404) {
                    d.notifications()?.remove(operation);
                    releaseWatch.get(job.id)?.();
                    return;
                }
                if (explicit) throw error;
            } finally {
                planningRetry = false;
            }
        }
        const present = (failure?: { message: string; retry: () => unknown }) => {
            if (!current() || target.dismissedJobs?.has(job.id)) return;
            const actions: FeedbackAction[] = [];
            if (failure) actions.push({ label: "Retry status check", run: failure.retry });
            else if (activeGeneration(latest)) actions.push({ label: "Cancel request", run: () => act("cancel") });
            else if (!latest.outputDeleted && ["failed", "settings_changed"].includes(latest.state)) {
                actions.push({
                    label:
                        latest.taskKind === "boundary-review"
                            ? "Retry AI review" +
                              (retryPlan ? " · " + retryPlan.requestCount + (retryPlan.requestCount === 1 ? " AI request" : " AI requests") : "")
                            : "Retry transcription",
                    run: () => act("retry"),
                });
                if (latest.failure?.code === "audio_too_large")
                    actions.push({
                        label: "Transcribe in chunks (" + Math.max(2, (latest.chunkCount || 1) * (latest.allowChunking ? 2 : 1)) + ")",
                        run: () => fallback(true, false),
                    });
                if (["timestamp_request_unsupported", "mixed_chunk_timing"].includes(latest.failure?.code || ""))
                    actions.push({ label: "Use segment timing only", run: () => fallback(false, true) });
            }
            if (latest.state === "complete" && latest.resultId && !latest.outputDeleted)
                actions.push({
                    label: "Review result",
                    run: () => d.open(latest.resultId!, latest.taskKind === "boundary-review" ? latest.id : undefined),
                });
            actions.push({
                label: "Dismiss",
                run: () => {
                    target.dismissedJobs ??= new Set();
                    target.dismissedJobs.add(job.id);
                    d.notifications()?.remove(operation);
                },
            });
            d.notifications()?.set(operation, {
                message:
                    failure?.message ||
                    (latest.outputDeleted
                        ? "Transcription output deleted"
                        : latest.failure?.message ||
                          latest.error ||
                          (latest.taskKind === "boundary-review" ? "Line-break review" : "Audio transcription") + " · " + latest.state),
                secondary: failure
                    ? "Last known state: " + latest.state
                    : (latest.stage || (activeGeneration(latest) ? latest.progress + "%" : "")) +
                      (latest.reviewRequestCount
                          ? " · " + latest.reviewRequestCount + (latest.reviewRequestCount === 1 ? " AI request" : " AI requests")
                          : ""),
                severity:
                    failure || latest.failure || latest.error
                        ? "error"
                        : activeGeneration(latest)
                          ? "progress"
                          : latest.state === "complete"
                            ? "success"
                            : "info",
                actions,
                details: latest.failure
                    ? [latest.failure.code, ...(latest.failure.diagnosticId ? ["Reference " + latest.failure.diagnosticId] : [])]
                    : [],
            });
        };
        const monitor = new GenerationMonitor({
            signal: target.controller.signal,
            read: async (signal) => parseGenerationJob(await d.api("jobs/" + job.id, "GET", undefined, signal)),
            changed: (next) => {
                latest = next;
                present();
                void planRetry();
                if (next.taskKind === "boundary-review" && next.state === "complete" && next.resultId) void d.reviewCompleted(next.resultId);
            },
            removed: () => {
                d.notifications()?.remove(operation);
                releaseWatch.get(job.id)?.();
            },
            failed: (_error, retry) => present({ message: "Could not check transcription progress", retry }),
        });
        const current = () => d.scope() === target && !target.controller.signal.aborted && watched.get(job.id) === monitor;
        async function act(operation: "retry" | "cancel") {
            if (!current()) return;
            try {
                if (operation === "retry" && latest.taskKind === "boundary-review" && !retryPlan) {
                    await planRetry(true);
                    return;
                }
                await d.api(
                    "jobs/" +
                        job.id +
                        "/" +
                        operation +
                        (operation === "retry" && retryPlan ? "?planIdentity=" + encodeURIComponent(retryPlan.identity) : ""),
                    "POST",
                    undefined,
                    target.controller.signal,
                );
                retryPlan = null;
                if (!current()) return;
                if (operation === "retry") target.dismissedJobs?.delete(job.id);
                await monitor.poll();
            } catch (error) {
                if (!current()) return;
                retryPlan = null;
                if (error instanceof BridgeRequestError && error.status === 404) {
                    d.notifications()?.remove("job:" + job.id);
                    releaseWatch.get(job.id)?.();
                    return;
                }
                if (d.scope() === target && !target.dismissedJobs?.has(job.id))
                    d.notifications()?.set("job:" + job.id, {
                        message: description(error),
                        severity: "error",
                        actions: [
                            {
                                label:
                                    operation === "cancel"
                                        ? "Retry cancellation"
                                        : latest.taskKind === "boundary-review"
                                          ? "Refresh AI review plan"
                                          : "Retry transcription",
                                run: () => act(operation),
                            },
                        ],
                    });
            }
        }
        async function fallback(chunk: boolean, segment: boolean) {
            if (!current()) return;
            try {
                latest = parseGenerationJob(
                    await d.api(
                        "items/" + target.itemId + "/transcription-jobs/" + job.id + "/retry",
                        "POST",
                        {
                            allowChunking: chunk,
                            segmentOnly: segment,
                        },
                        target.controller.signal,
                    ),
                );
                if (!current()) return;
                target.dismissedJobs?.delete(job.id);
                present();
                await monitor.poll();
            } catch (error) {
                if (!current()) return;
                if (d.scope() === target && !target.dismissedJobs?.has(job.id))
                    d.notifications()?.set("job:" + job.id, {
                        message: description(error),
                        severity: "error",
                        actions: [{ label: "Retry", run: () => fallback(chunk, segment) }],
                    });
            }
        }
        watched.set(job.id, monitor);
        const release = () => {
            monitor.dispose();
            watched.delete(job.id);
            releaseWatch.delete(job.id);
            target.controller.signal.removeEventListener("abort", release);
        };
        releaseWatch.set(job.id, release);
        target.controller.signal.addEventListener("abort", release, { once: true });
        present();
        void planRetry();
        void monitor.poll();
    }
    async function restore(target: TrackScope) {
        for (const monitor of watched.values()) void monitor.poll();
        try {
            const jobs = await d.api("jobs?active=true&itemId=" + target.itemId, "GET", undefined, target.controller.signal);
            if (d.scope() !== target || !Array.isArray(jobs)) return;
            for (const value of jobs) {
                const job = parseGenerationJob(value);
                if (job.taskKind && job.taskKind !== "language" && !job.outputDeleted && activeGeneration(job)) watch(job, target);
            }
        } catch {
            /* Existing generation restoration owns connection feedback; opening the panel can retry. */
        }
    }
    return { watch, restore };
}
