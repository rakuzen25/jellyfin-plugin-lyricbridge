import { requireValue } from "../shared/invariants.ts";
import type { LyricLine } from "../shared/lyrics.ts";
import type { FeedbackAction, FeedbackSeverity } from "../shared/feedback.ts";
import type { PlaybackNotifications } from "./playback-notifications.ts";
import type { BridgeDocument, ServiceCapability, TrackScope } from "./contracts.ts";
import { button, e, setGenerationPanelOpen } from "./controls.ts";
import { GenerationMonitor, activeGeneration, parseGenerationJob, type GenerationJob } from "./generation-state.ts";
import type { AuxiliaryKind, Preferences } from "./models.ts";
import { displayFailure } from "./responses.ts";

interface Dependencies {
    scope: () => TrackScope | null;
    current: () => BridgeDocument | null;
    services: () => ServiceCapability[];
    notifications: () => PlaybackNotifications | null;
    popup: () => HTMLElement | null;
    tools: () => HTMLElement | null;
    trackScope: () => TrackScope;
    documentState: () => BridgeDocument;
    api: (path: string, method?: string, body?: unknown, signal?: AbortSignal | null) => Promise<unknown>;
    auxiliary: (
        line: LyricLine,
        kind: AuxiliaryKind,
        preferences: Preferences,
        document?: BridgeDocument | null,
    ) => { text: string; provenance: string; key: string } | null;
    refreshSong: (force?: boolean) => Promise<void>;
    safeMessage: (error: unknown) => string;
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: () => void, severity?: FeedbackSeverity) => void;
    status: (message: string, error?: boolean, ttl?: number, operation?: string) => void;
    showError: (error: unknown, parent?: HTMLElement | null, retry?: () => unknown, context?: { operation?: string; retryLabel?: string }) => void;
    openPopup: (tab: string) => void;
    drawJobDetails: (parent: HTMLElement, kind: AuxiliaryKind) => void;
}

/** Track-owned generation submission, notifications and restoration. */
export function createGenerationController(dependencies: Dependencies) {
    const {
        scope,
        current,
        services,
        notifications,
        popup,
        tools,
        trackScope,
        documentState,
        api,
        auxiliary,
        refreshSong,
        safeMessage,
        notice,
        status,
        showError,
        openPopup,
        drawJobDetails,
    } = dependencies;
    async function generate(kind: AuxiliaryKind, service: string, parent: HTMLElement, forceNew = false) {
        const target = trackScope(),
            text = e("p", "lb-job-status", "Submitting…");
        text.setAttribute("role", "status");
        parent.append(text);
        try {
            const selected = services().find(
                (s) => (s.optionId || s.service) === service && (kind === "translation" ? s.translation : s.pronunciation),
            );
            if (!selected) throw new Error("Choose an available service option.");
            if (kind === "pronunciation" && !selected.pronunciation) throw new Error("This service cannot generate pronunciation.");
            if (forceNew && (!documentState().auxiliaryChoices?.[kind] || requireValue(documentState().auxiliaryChoices)[kind] === "auto")) {
                const previous = requireValue(documentState().lyrics)
                    .lines.map((line) => auxiliary(line, kind, documentState().preferences))
                    .find((value) => value?.key);
                if (previous) {
                    await api("items/" + target.itemId + "/language-version", "POST", {
                        hash: requireValue(documentState().lyrics).hash,
                        kind,
                        key: previous.key,
                    });
                    if (scope() !== target) return;
                    documentState().auxiliaryChoices = {
                        ...{ translation: "auto", pronunciation: "auto", ...current()?.auxiliaryChoices },
                        [kind]: previous.key,
                    };
                }
            }
            const options: Record<string, string | number> = {};
            for (const input of parent.querySelectorAll<HTMLInputElement>("[data-generation-key]"))
                if (!requireValue(input.closest<HTMLElement>(".lb-field")).hidden && input.value !== "" && input.value !== "inherit")
                    options[requireValue(input.dataset.generationKey)] = input.type === "number" ? Number(input.value) : input.value;
            const thinking = parent.querySelector<HTMLSelectElement>('[data-generation-key="reasoningEffort"]');
            if (selected.service === "AI" && thinking?.value === "") options.reasoningEffort = "";
            const job = parseGenerationJob(
                await api("items/" + target.itemId + "/generate", "POST", {
                    ...options,
                    kind,
                    language: documentState().preferences.translationLanguage,
                    service: selected.service,
                    ...(selected.optionId ? { optionId: selected.optionId } : {}),
                    forceNew,
                }),
            );
            if (scope() !== target) return;
            if (job.state === "cached") {
                await refreshSong();
                status("Cached result ready", false, 4000);
                return;
            }
            if (target.jobs?.has(job.id)) {
                notice(text, "Request already in progress");
                return;
            }
            watchGeneration(job, target, parent, text, kind);
        } catch (error) {
            notice(text, "");
            showError(error, parent);
        }
    }

    function watchGeneration(job: GenerationJob, target: TrackScope, parent: HTMLElement, text: HTMLElement, kind: AuxiliaryKind) {
        if (scope() !== target || target.jobs?.has(job.id)) return;
        const operation = "job:" + job.id;
        let latest = job;
        const name = kind === "pronunciation" ? "Pronunciation" : "Translation";
        const describe = (next: GenerationJob) =>
            name + " · " + (next.request.optionName || next.request.service) + " · " + next.state + " · " + next.progress + "%";
        const dismiss = () => {
            target.dismissedJobs ??= new Set();
            target.dismissedJobs.add(job.id);
            notifications()?.remove(operation);
        };
        const showDetails = () => {
            if (scope() !== target) return;
            openPopup("Versions");
            const section = popup()?.querySelector<HTMLElement>('[data-song-kind="' + kind + '"]');
            const generation = section?.querySelector<HTMLElement>(".lb-generation");
            if (!generation) return;
            setGenerationPanelOpen(generation, true);
            drawJobDetails(generation, kind);
            const detail = generation.querySelector<HTMLElement>('[data-job-detail="' + job.id + '"]');
            if (detail) {
                detail.tabIndex = -1;
                detail.focus({ preventScroll: true });
                detail.scrollIntoView({ block: "nearest" });
            }
        };
        const present = (
            next: GenerationJob,
            failure?: { message: string; retry: () => unknown; label: string; secondary?: string; details?: string[] },
        ) => {
            if (scope() !== target || target.dismissedJobs?.has(job.id)) return;
            const error = next.outputDeleted ? undefined : next.failure?.message || next.error;
            const actions: FeedbackAction[] = [];
            if (failure) actions.push({ label: failure.label, run: failure.retry });
            else if (error && !activeGeneration(next)) actions.push({ label: "Retry generation", run: retryJob });
            actions.push({ label: "Details", run: showDetails });
            if (activeGeneration(next)) actions.push({ label: "Cancel request", run: cancelJob });
            actions.push({ label: "Dismiss", run: dismiss });
            const message =
                failure?.message ||
                (next.outputDeleted
                    ? "Output deleted · Job history retained"
                    : next.state === "complete"
                      ? "Language rows ready"
                      : next.state === "cancelled" && !error
                        ? "Generation cancelled"
                        : error ||
                          (next.state === "pending"
                              ? "Awaiting " + kind + " approval"
                              : next.state === "queued"
                                ? name + " queued"
                                : "Generating " + kind + "…"));
            const root = notifications()?.set(
                operation,
                {
                    message,
                    secondary: failure?.secondary || describe(next),
                    severity:
                        failure || error
                            ? "error"
                            : activeGeneration(next)
                              ? "progress"
                              : ["complete", "cancelled"].includes(next.state)
                                ? "success"
                                : "info",
                    details:
                        failure?.details ||
                        (error
                            ? [
                                  next.failure?.code || "generation_failed",
                                  ...(next.failure?.diagnosticId ? ["Reference " + next.failure.diagnosticId] : []),
                              ]
                            : []),
                    actions,
                },
                "lb-job-banner",
            );
            if (root) {
                delete root.dataset.monitorError;
                root.dataset.jobId = job.id;
                root.querySelector(".lb-feedback-secondary")?.classList.add("lb-job-progress");
                root.querySelector(".lb-notice-actions")?.classList.add("lb-job-actions");
            }
        };
        const retryJob = async () => {
            try {
                await api("jobs/" + job.id + "/retry", "POST");
                if (scope() !== target) return;
                target.dismissedJobs?.delete(job.id);
                void monitor.poll();
            } catch (error) {
                if (scope() === target)
                    present(latest, {
                        message: safeMessage(displayFailure(error)),
                        retry: retryJob,
                        label: "Retry generation",
                        secondary: "Last known state: " + describe(latest),
                    });
            }
        };
        const cancelJob = async () => {
            try {
                await api("jobs/" + job.id + "/cancel", "POST");
                if (scope() === target) await monitor.poll();
            } catch (error) {
                if (scope() === target)
                    present(latest, {
                        message: safeMessage(displayFailure(error)),
                        retry: cancelJob,
                        label: "Retry cancellation",
                        secondary: "Last known state: " + describe(latest),
                    });
            }
        };
        const monitor = new GenerationMonitor({
            signal: target.controller.signal,
            read: async (signal) => parseGenerationJob(await api("jobs/" + job.id, "GET", undefined, signal)),
            changed: async (next) => {
                if (scope() !== target || !next) return;
                latest = next;
                requireValue(target.jobs).set(job.id, next);
                // A successful check replaces monitoring failures even if progress did not change.
                present(next);
                if (text.isConnected)
                    notice(text, describe(next), 0, undefined, activeGeneration(next) ? "progress" : next.error || next.failure ? "error" : "info");
                parentCancel.hidden = !activeGeneration(next);
                const detailHost = popup()?.querySelector<HTMLElement>('[data-song-kind="' + kind + '"]');
                if (detailHost?.getClientRects().length) drawJobDetails(detailHost.querySelector<HTMLElement>(".lb-generation") || detailHost, kind);
                if (next.state === "complete" && !next.outputDeleted) await refreshSong();
            },
            removed: () => {
                notifications()?.remove(operation);
                target.jobs?.delete(job.id);
                target.jobActions?.delete(job.id);
                parentCancel.remove();
            },
            failed: (error, retryCheck) => {
                if (scope() === target)
                    present(latest, {
                        message: "Could not check " + kind + " progress",
                        retry: retryCheck,
                        label: "Retry status check",
                        secondary: "Last known state: " + describe(latest),
                        details: [
                            safeMessage(displayFailure(error)),
                            ...(displayFailure(error).details?.diagnosticId ? ["Reference " + displayFailure(error).details?.diagnosticId] : []),
                        ],
                    });
                if (scope() === target) {
                    const root = notifications()?.get(operation);
                    if (root) root.dataset.monitorError = safeMessage(displayFailure(error));
                }
            },
        });
        const parentCancel = button("Cancel request", cancelJob, "", { icon: "close" });
        if (parent.isConnected) parent.append(parentCancel);
        target.jobs ??= new Map();
        target.jobActions ??= new Map();
        target.jobs.set(job.id, job);
        target.jobActions.set(job.id, { retry: retryJob, cancel: cancelJob });
        present(job);
        void monitor.poll();
    }
    async function restoreGeneration(target: TrackScope) {
        try {
            const result: unknown = await api("jobs?active=true&itemId=" + encodeURIComponent(target.itemId));
            if (scope() !== target) return;
            if (!Array.isArray(result)) throw new Error("Jellyfin returned invalid active generation jobs.");
            const jobs = result.map(parseGenerationJob);
            for (const job of jobs) {
                if (!activeGeneration(job) || (job.hash && job.hash !== current()?.lyrics?.hash)) continue;
                const kind = job.request.kind;
                if (kind !== "translation" && kind !== "pronunciation") continue;
                // The banner owns restored feedback; no detached configuration panel is retained.
                const host = e("div");
                watchGeneration(job, target, host, e("span"), kind);
            }
        } catch (error) {
            if (scope() === target)
                showError(error, tools(), () => restoreGeneration(target), { operation: "action:restore-jobs", retryLabel: "Retry status check" });
        }
    }

    return { generate, restoreGeneration };
}
