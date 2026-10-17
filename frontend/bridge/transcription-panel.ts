import { parseServiceOptions, type ServiceOptionInfo } from "./service-options.ts";
import { FeedbackScope, type FeedbackAction } from "../shared/feedback.ts";
import { isRecord, requireValue } from "../shared/invariants.ts";
import type { RichLyrics } from "../shared/lyrics.ts";
import { AudioUploadBody, BridgeRequestError } from "./api.ts";
import { createDialog } from "./dialog.ts";
import type { BridgeDocument, TrackScope } from "./contracts.ts";
import { button, disclosure, e, field, select, toggle } from "./controls.ts";
import { feedbackHost, glassFeedback } from "./feedback.ts";
import { activeGeneration, GenerationMonitor, parseGenerationJob, type GenerationJob } from "./generation-state.ts";
import type { PlaybackNotifications } from "./playback-notifications.ts";
import { BoundaryHistory, graphemeEnds, parseBoundaryVersion, parseReview, type BreakSettings, type ReviewDocument } from "./transcription-state.ts";
interface Dependencies {
    scope(): TrackScope | null;
    panel(): HTMLElement | null;
    mount(panel: HTMLElement): void;
    beginWorkflow(): boolean;
    closeSearch(restore?: boolean): void;
    endPlaybackPreview(): void;
    startPlaybackPreview(doc: BridgeDocument, label: string, actions: HTMLElement[]): void;
    documentState(): BridgeDocument;
    api(path: string, method?: string, body?: unknown, signal?: AbortSignal | null): Promise<unknown>;
    notifications(): PlaybackNotifications | null;
    refreshSong(): Promise<void>;
    saved(): void;
    finishWorkflow(): Promise<void>;
    updatePanelBounds(): void;
    play(start: number, end: number): () => void;
}
const description = (error: unknown) => (error instanceof Error ? error.message : "The transcription action could not complete.");
const stamp = (ticks: number) => {
    const seconds = Math.max(0, ticks / 10_000_000);
    return Math.floor(seconds / 60) + ":" + (seconds % 60).toFixed(2).padStart(5, "0");
};
/** Panel work and track-owned background monitors have independent lifetimes. */
export function createTranscriptionPanel(d: Dependencies) {
    let active: { canClose(): boolean; dispose(): void; refreshSaved?(id: string): Promise<void> } | null = null;
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
            if (planningRetry || retryPlan || latest.taskKind !== "boundary-review" || !["failed", "settings_changed"].includes(latest.state)) return;
            planningRetry = true;
            try {
                const plan = await d.api("jobs/" + job.id + "/review-plan", "POST", undefined, target.controller.signal);
                if (d.scope() !== target) return;
                if (!isRecord(plan) || typeof plan.identity !== "string" || !Number.isSafeInteger(plan.requestCount) || Number(plan.requestCount) < 1)
                    throw new Error("Could not plan AI review. Refresh requests after checking the service settings.");
                retryPlan = { identity: plan.identity, requestCount: Number(plan.requestCount) };
                present();
            } catch (error) {
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
            if (d.scope() !== target || target.dismissedJobs?.has(job.id)) return;
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
                    run: () => open(latest.resultId!, latest.taskKind === "boundary-review" ? latest.id : undefined),
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
                if (next.taskKind === "boundary-review" && next.state === "complete" && next.resultId) void active?.refreshSaved?.(next.resultId);
            },
            removed: () => {
                d.notifications()?.remove(operation);
                releaseWatch.get(job.id)?.();
            },
            failed: (_error, retry) => present({ message: "Could not check transcription progress", retry }),
        });
        async function act(operation: "retry" | "cancel") {
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
                );
                retryPlan = null;
                if (d.scope() !== target) return;
                if (operation === "retry") target.dismissedJobs?.delete(job.id);
                await monitor.poll();
            } catch (error) {
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
            try {
                latest = parseGenerationJob(
                    await d.api("items/" + target.itemId + "/transcription-jobs/" + job.id + "/retry", "POST", {
                        allowChunking: chunk,
                        segmentOnly: segment,
                    }),
                );
                if (d.scope() !== target) return;
                target.dismissedJobs?.delete(job.id);
                present();
                await monitor.poll();
            } catch (error) {
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
    function open(transcriptId?: string, reviewResultId?: string) {
        if (active && !active.canClose()) return;
        if (!d.beginWorkflow()) return;
        const owner = d.scope();
        if (!owner) return;
        const target: TrackScope = owner;
        const controller = new AbortController();
        const abort = () => controller.abort();
        target.controller.signal.addEventListener("abort", abort, { once: true });
        const feedback = new FeedbackScope(glassFeedback);
        const {
            root: panel,
            body: main,
            feedback: feedbackArea,
            footer,
            setBusy,
        } = createDialog({
            label: "Transcribe audio",
            wide: true,
            className: "lb-transcription-panel",
            onClose: () => close(),
        });
        const message = feedbackHost();
        const confirmation = feedbackHost("confirmation");
        message.hidden = true;
        confirmation.hidden = true;
        feedbackArea.classList.add("lb-transcription-status");
        feedbackArea.append(message, confirmation);
        footer.hidden = true;
        let saving = false,
            dirty = false,
            requestRevision = 0,
            review: ReviewDocument | null = null,
            history: BoundaryHistory | null = null;
        let reviewOptions: ServiceOptionInfo[] = [];
        let selectedReviewOption = "";
        let settings: BreakSettings = { characters: null, seconds: 3, keepShortReplies: true };
        let selectedVersionId = "";
        let selectedEntryId = "";
        let origin = "manual";
        let automaticKey = "";
        let baseline: { ends: string[]; settings: BreakSettings; origin: string; saved: boolean } | null = null;
        const contentKey = () => JSON.stringify({ ends: history?.ends, settings });
        let baselineKey = "";
        const captureBaseline = (saved: boolean) => {
            baseline = { ends: requireValue(history).ends, settings: { ...settings }, origin, saved };
            baselineKey = contentKey();
            dirty = !saved;
        };
        const updateDirty = () => {
            dirty = !!history && (!baseline?.saved || contentKey() !== baselineKey);
        };
        const navigate = (text: string, run: () => unknown) => {
            if (saving) return;
            if (!dirty) {
                void run();
                return;
            }
            feedback.update(confirmation, {
                message: text,
                secondary: review?.canManage ? undefined : "Only the transcript owner or an administrator can save line breaks.",
                severity: "warning",
                actions: [
                    {
                        label: "Save and continue",
                        disabled: !review?.canManage,
                        run: async () => {
                            if (await saveDraft()) {
                                feedback.clear(confirmation);
                                void run();
                            }
                        },
                    },
                    {
                        label: "Discard",
                        destructive: true,
                        run: () => {
                            feedback.clear(confirmation);
                            void run();
                        },
                    },
                    { label: "Keep editing", run: () => feedback.clear(confirmation) },
                ],
            });
        };
        let selectedResultId = "";
        let savedRefreshRevision = 0;
        let phraseLimit = 100;
        let clip: (() => void) | null = null;
        const live = () => d.scope() === target && d.panel() === panel && !controller.signal.aborted;
        const path = () => "items/" + target.itemId + "/transcriptions/" + requireValue(review).transcript.id;
        const error = (cause: unknown) => {
            if (!live()) return;
            feedback.update(message, {
                message: description(cause),
                severity: "error",
                actions:
                    cause instanceof BridgeRequestError && cause.details.code === "line_breaks_deleted" && review
                        ? [
                              {
                                  label: "Refresh saved line breaks",
                                  run: async () => {
                                      const id = requireValue(review).transcript.id;
                                      const revision = ++savedRefreshRevision;
                                      try {
                                          const fresh = parseReview(await api(path()));
                                          if (!live() || review?.transcript.id !== id || revision !== savedRefreshRevision) return;
                                          review = fresh;
                                          if (!fresh.savedEntries.some((entry) => entry.id === selectedEntryId)) {
                                              selectedEntryId = "";
                                              selectedVersionId = "";
                                              selectedResultId = "";
                                              if (baseline) baseline.saved = false;
                                          }
                                          editor();
                                          feedback.update(message, {
                                              message:
                                                  "Saved list refreshed. Your draft and undo history are retained; review before saving or using these lyrics.",
                                              severity: "info",
                                          });
                                      } catch (failure) {
                                          error(failure);
                                      }
                                  },
                              },
                          ]
                        : [],
            });
        };
        const ask = (text: string, run: () => unknown, acceptLabel = "Discard") =>
            feedback.update(confirmation, {
                message: text,
                severity: "warning",
                actions: [
                    {
                        label: acceptLabel,
                        destructive: true,
                        run: () => {
                            feedback.clear(confirmation);
                            void run();
                        },
                    },
                    { label: acceptLabel === "Discard" ? "Keep editing" : "Cancel", run: () => feedback.clear(confirmation) },
                ],
            });
        const close = () => {
            if (!saving) {
                navigate("Save unfinished line-break edits before closing?", () => {
                    dirty = false;
                    d.closeSearch();
                });
            }
        };
        const dispose = () => {
            controller.abort();
            target.controller.signal.removeEventListener("abort", abort);
            feedback.dispose();
            clip?.();
            d.endPlaybackPreview();
        };
        active = {
            canClose: () => {
                if (saving) return false;
                if (dirty) {
                    close();
                    return false;
                }
                return true;
            },
            dispose,
            refreshSaved: async (id) => {
                if (!live() || saving || review?.transcript.id !== id) return;
                const revision = ++savedRefreshRevision;
                try {
                    const latest = parseReview(await api("items/" + target.itemId + "/transcriptions/" + id));
                    if (!live() || saving || revision !== savedRefreshRevision || review?.transcript.id !== id) return;
                    review.versions = latest.versions;
                    review.savedEntries = latest.savedEntries;
                    review.deletion = latest.deletion;
                    review.reviewResults = latest.reviewResults;
                    // Update only saved choices: keep text, current edits, undo, focus, and previews intact.
                    if (!history) {
                        void load(id);
                        return;
                    }
                    refreshSavedChoices?.();
                } catch {
                    /* Reopening the preserved transcript retries this view-owned read. */
                }
            },
        };
        let refreshSavedChoices: (() => void) | undefined;
        d.mount(panel);
        d.updatePanelBounds();
        const api = (name: string, method = "GET", body?: unknown) => d.api(name, method, body, controller.signal);
        const body = () => ({
            transcriptId: requireValue(review).transcript.id,
            endTokenIds: requireValue(history).ends,
            settings,
            origin: origin === "local" && automaticKey === contentKey() ? "local" : "manual",
            ...(selectedEntryId ? { entryId: selectedEntryId } : {}),
            expectedSelection: requireValue(review).selection,
            ...(selectedReviewOption ? { optionId: selectedReviewOption } : {}),
        });
        async function load(id: string) {
            const revision = ++requestRevision;
            feedback.update(message, { message: "Loading preserved transcript…", severity: "progress" });
            try {
                const serviceConfig = await api("transcription");
                if (!live() || revision !== requestRevision) return;
                if (!isRecord(serviceConfig)) throw new Error("Invalid service options.");
                reviewOptions = parseServiceOptions(serviceConfig.reviewOptions).filter((o) => o.status === "Ready");
                const result = parseReview(await api("items/" + target.itemId + "/transcriptions/" + id));
                if (!live() || revision !== requestRevision) return;
                review = result;
                const entry = result.savedEntries.find((e) => e.id === "review:" + reviewResultId) ?? result.savedEntries.at(-1);
                const version = result.versions.find((v) => v.id === entry?.versionId);
                selectedEntryId = entry?.id ?? "";
                selectedVersionId = version?.id ?? "";
                selectedResultId = entry?.id.startsWith("review:") ? entry.id.slice(7) : "";
                settings = { ...(entry?.settings ?? { characters: null, seconds: 3, keepShortReplies: true }) };
                origin = entry?.origin === "local" ? "local" : "manual";
                phraseLimit = 100;
                history = version ? new BoundaryHistory(result.transcript.tokens, version.endTokenIds) : null;
                baseline = null;
                baselineKey = "";
                dirty = false;
                if (history) {
                    automaticKey = origin === "local" ? contentKey() : "";
                    captureBaseline(true);
                }
                feedback.clear(message);
                editor();
            } catch (cause) {
                if (revision === requestRevision) error(cause);
            }
        }
        async function preview() {
            try {
                const revision = requestRevision;
                const submitted = JSON.stringify(body());
                const lyrics = await api(path() + "/preview", "POST", body());
                if (!live() || revision !== requestRevision || submitted !== JSON.stringify(body())) return;
                if (!isRecord(lyrics) || !Array.isArray(lyrics.lines)) throw new Error("Invalid playback preview.");
                d.startPlaybackPreview(
                    { ...d.documentState(), lyrics: lyrics as unknown as RichLyrics, canGenerate: false, canSelect: false },
                    "Reviewing transcription line breaks",
                    [button("Return to line breaks", () => d.endPlaybackPreview(), "", { icon: "back" })],
                );
            } catch (cause) {
                error(cause);
            }
        }
        async function saveDraft(): Promise<boolean> {
            if (saving || !history || !review?.canManage) return false;
            saving = true;
            requestRevision++;
            setBusy(true);
            editor();
            try {
                const saved = await api(path() + "/save", "POST", body());
                if (!live()) return false;
                if (!isRecord(saved) || typeof saved.id !== "string") throw new Error("Invalid saved line breaks.");
                const fresh = parseReview(await api(path()));
                if (!live()) return false;
                savedRefreshRevision++;
                review = fresh;
                selectedEntryId = saved.id;
                selectedVersionId = typeof saved.versionId === "string" ? saved.versionId : "";
                selectedResultId = saved.id.startsWith("review:") ? saved.id.slice(7) : "";
                captureBaseline(true);
                feedback.update(message, { message: "Line breaks saved.", severity: "success" });
                return true;
            } catch (cause) {
                error(cause);
                return false;
            } finally {
                if (live()) {
                    saving = false;
                    setBusy(false);
                    confirmation.querySelectorAll<HTMLButtonElement>("button").forEach((n) => (n.disabled = false));
                    editor();
                }
            }
        }
        function transcriptDelete(parent: HTMLElement, id: string, capability: { allowed: boolean; reason: string | null }, count: number) {
            const remove = button(
                "Delete transcription",
                () =>
                    ask(
                        "Delete this transcript and its " +
                            count +
                            " saved line-break entries? Associated reviews and active requests will be removed or cancelled. Saved originals are never deleted. This cannot be undone.",
                        async () => {
                            try {
                                await api("items/" + target.itemId + "/transcriptions/" + id, "DELETE");
                                if (live()) {
                                    dirty = false;
                                    review = null;
                                    history = null;
                                    void list();
                                }
                            } catch (cause) {
                                error(cause);
                            }
                        },
                        "Delete transcription",
                    ),
                "",
                { icon: "trash", appearance: "danger" },
            );
            remove.disabled = saving || !capability.allowed;
            parent.append(remove);
            if (capability.reason) parent.append(e("p", "lb-help", capability.reason));
        }
        function editor() {
            if (!live() || !review) return;
            updateDirty();
            const previousScroll = main.scrollTop;
            const focused = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement : null;
            const focusLabel = focused?.getAttribute("aria-label") || focused?.textContent;
            feedback.releaseWithin(main);
            main.classList.remove("lb-transcription-overview");
            main.classList.add("lb-transcription-editor");
            main.replaceChildren();
            const source = review.transcript;
            if (!history) {
                main.append(
                    e("p", "lb-help", "No saved line breaks. The preserved transcript is unchanged."),
                    e("p", "lb-transcription-text", source.text),
                );
                const generate = button(
                    "Generate automatic line breaks",
                    async () => {
                        const revision = ++requestRevision;
                        try {
                            const version = parseBoundaryVersion(await api(path() + "/break", "POST", settings));
                            if (!live() || revision !== requestRevision) return;
                            history = new BoundaryHistory(source.tokens, version.endTokenIds);
                            origin = "local";
                            automaticKey = contentKey();
                            captureBaseline(false);
                            editor();
                        } catch (cause) {
                            error(cause);
                        }
                    },
                    "",
                    { icon: "generate", appearance: "primary" },
                );
                transcriptDelete(main, source.id, review.deletion, review.savedEntries.length);
                footer.replaceChildren(
                    button(
                        "Back to recordings",
                        () => {
                            review = null;
                            void list();
                        },
                        "",
                        { icon: "back" },
                    ),
                );
                footer.append(generate);
                footer.hidden = false;
                return;
            }
            main.append(
                e(
                    "p",
                    "lb-version-metadata",
                    source.language +
                        " · " +
                        (source.timing === "word" ? "Word timing" : "Segment timing only") +
                        " · " +
                        history.phrases.length +
                        " phrases",
                ),
            );
            const warnings = feedbackHost();
            warnings.hidden = source.warnings.length === 0;
            main.append(warnings);
            if (source.warnings.length)
                feedback.update(warnings, {
                    message: source.warnings.length + " transcription notices",
                    severity: "warning",
                    details: source.warnings.map((w) => w.message),
                });
            const selectedVersion = review.versions.find((v) => v.id === selectedVersionId);
            const seamIds = review.reviewResults.find((result) => result.id === selectedResultId)?.seamTokenIds ?? selectedVersion?.seamTokenIds;
            if (seamIds?.length) {
                const seamNotice = feedbackHost();
                main.append(seamNotice);
                feedback.update(seamNotice, {
                    message: "Review " + seamIds.length + " batch seams without strong pauses or punctuation.",
                    severity: "warning",
                    details: seamIds.map((id) => "After " + (source.tokens.find((t) => t.id === id)?.text ?? id)),
                });
            }
            const savedChoices = () =>
                requireValue(review).savedEntries.flatMap((entry) => {
                    const version = requireValue(review).versions.find((v) => v.id === entry.versionId);
                    return version
                        ? [
                              {
                                  id: entry.id,
                                  version: { ...version, settings: entry.settings },
                                  entry,
                                  label:
                                      (entry.origin === "local" ? "Automatic" : entry.origin === "AI" ? "AI review" : "Manual") +
                                      (entry.optionName ? " · " + entry.optionName : "") +
                                      (entry.model ? " · " + entry.model : "") +
                                      (entry.created ? " · " + new Date(entry.created).toLocaleString() : ""),
                              },
                          ]
                        : [];
                });
            const choices = select(
                main,
                "Saved line breaks",
                selectedEntryId,
                [["", "Unsaved draft"], ...savedChoices().map((choice) => [choice.id, choice.label] as const)],
                (value) => {
                    const choice = savedChoices().find((item) => item.id === value);
                    if (!choice) return;
                    const version = choice.version;
                    const change = () => {
                        history = new BoundaryHistory(source.tokens, version.endTokenIds);
                        settings = { ...version.settings };
                        selectedVersionId = version.id;
                        selectedEntryId = choice.id;
                        origin = choice.entry.origin === "local" ? "local" : "manual";
                        selectedResultId = value.startsWith("review:") ? value.slice(7) : "";
                        requestRevision++;
                        automaticKey = origin === "local" ? contentKey() : "";
                        captureBaseline(true);
                        editor();
                    };
                    if (dirty) {
                        choices.value = selectedEntryId;
                        navigate("Save unfinished edits before switching versions?", change);
                    } else change();
                },
            );
            refreshSavedChoices = () => {
                if (!choices.isConnected) return;
                const value = selectedEntryId;
                choices.replaceChildren(
                    ...[{ id: "", label: "Unsaved draft" }, ...savedChoices()].map((choice) => {
                        const option = e("option");
                        option.value = choice.id;
                        option.textContent = choice.label;
                        return option;
                    }),
                );
                choices.value = value;
            };
            choices.disabled = saving;
            const { root: manage, content: entries } = disclosure("Manage saved line breaks", "lb-transcription-management");
            for (const choice of savedChoices()) {
                const row = e("div", "lb-transcription-saved-entry");
                row.append(e("p", "lb-version-metadata", choice.label));
                const remove = button(
                    "Delete",
                    () =>
                        ask(
                            "Delete “" +
                                choice.label +
                                "”? Only this saved entry is removed. Your current draft and other saved entries are retained.",
                            async () => {
                                try {
                                    savedRefreshRevision++;
                                    await api(path() + "/entries/" + encodeURIComponent(choice.id), "DELETE");
                                    if (!live()) return;
                                    const fresh = parseReview(await api(path()));
                                    if (!live()) return;
                                    savedRefreshRevision++;
                                    review = fresh;
                                    if (selectedEntryId === choice.id) {
                                        selectedEntryId = "";
                                        selectedVersionId = "";
                                        selectedResultId = "";
                                        if (baseline) baseline.saved = false;
                                    }
                                    editor();
                                } catch (cause) {
                                    error(cause);
                                }
                            },
                            "Delete",
                        ),
                    "",
                    { icon: "trash" },
                );
                remove.disabled = saving || !choice.entry.deletion.allowed;
                row.append(remove);
                if (choice.entry.deletion.reason) row.append(e("p", "lb-help", choice.entry.deletion.reason));
                entries.append(row);
            }
            if (!review.savedEntries.length) entries.append(e("p", "lb-help", "No saved line breaks."));
            transcriptDelete(entries, source.id, review.deletion, review.savedEntries.length);
            main.append(manage);
            const { root: options, content } = disclosure("Automatic line breaks", "lb-transcription-automatic");
            content.append(e("p", "lb-help", "Runs locally without an AI service. Adjust the targets, then apply automatic line breaks."));
            const chars = e("input");
            chars.type = "number";
            chars.min = "4";
            chars.max = "200";
            chars.placeholder = source.language === "ja" ? "14 (automatic)" : "42 (automatic)";
            chars.value = settings.characters == null ? "" : String(settings.characters);
            chars.onchange = () => {
                settings.characters = chars.value === "" ? null : Number(chars.value);
                requestRevision++;
                updateDirty();
                if (saveButton) saveButton.disabled = saving || !dirty || !review?.canManage;
            };
            field(content, "Character target", chars, "Soft target; natural phrases may be longer.");
            const seconds = e("input");
            seconds.type = "number";
            seconds.min = ".5";
            seconds.max = "30";
            seconds.step = ".5";
            seconds.value = String(settings.seconds);
            seconds.onchange = () => {
                settings.seconds = Number(seconds.value);
                requestRevision++;
                updateDirty();
                if (saveButton) saveButton.disabled = saving || !dirty || !review?.canManage;
            };
            field(content, "Duration target (seconds)", seconds);
            toggle(content, "Keep short replies separate", settings.keepShortReplies, (value) => {
                settings.keepShortReplies = value;
                requestRevision++;
                updateDirty();
                if (saveButton) saveButton.disabled = saving || !dirty || !review?.canManage;
            });
            content.append(
                button(
                    "Apply automatic line breaks",
                    async () => {
                        const revision = ++requestRevision;
                        try {
                            const version = parseBoundaryVersion(await api(path() + "/break", "POST", settings));
                            if (!live() || requestRevision !== revision) return;
                            requireValue(history).replace(version.endTokenIds);
                            origin = "local";
                            automaticKey = contentKey();
                            updateDirty();
                            editor();
                        } catch (cause) {
                            if (requestRevision === revision) error(cause);
                        }
                    },
                    "",
                    { icon: "generate" },
                ),
            );
            const { root: aiOptions, content: aiContent } = disclosure("AI review", "lb-transcription-ai-review");
            aiContent.append(
                e(
                    "p",
                    "lb-help",
                    "Requests a remote proposal using the targets under Automatic line breaks. Your current edits stay in place until you open a result.",
                ),
            );
            const ai = button(
                "Request AI review",
                async () => {
                    try {
                        if (!selectedReviewOption) throw new Error("Choose an AI review service.");
                        if (!planned || plannedInput !== JSON.stringify(body())) {
                            await refreshReviewPlan();
                            return;
                        }
                        const job = parseGenerationJob(await api(path() + "/review", "POST", { ...body(), planIdentity: planned.identity }));
                        selectedReviewOption = "";
                        reviewChoice.value = "";
                        if (ai) ai.disabled = true;
                        if (live()) {
                            watch(job, target, true);
                            feedback.update(message, {
                                message: "AI review requested. Your current edits stay in place; open Review result when ready.",
                                severity: "info",
                            });
                        }
                    } catch (cause) {
                        error(cause);
                    }
                },
                "",
                { icon: "speech" },
            );
            const reviewChoice = select(
                aiContent,
                "AI review service",
                selectedReviewOption,
                [["", "Choose a service…"], ...reviewOptions.map((o) => [o.id, o.name] as [string, string])],
                (value) => {
                    selectedReviewOption = value;
                    void refreshReviewPlan();
                },
            );
            let planned: { identity: string; requestCount: number } | null = null;
            let plannedInput = "";
            let planningRevision = 0;
            const count = e("p", "lb-version-metadata");
            async function refreshReviewPlan() {
                const revision = ++planningRevision;
                planned = null;
                ai.disabled = true;
                if (!selectedReviewOption) {
                    count.textContent = "";
                    return;
                }
                const input = body();
                const baseline = JSON.stringify(input);
                count.textContent = "Estimating AI requests…";
                try {
                    const result = await api(path() + "/review-plan", "POST", input);
                    if (!live() || !count.isConnected || revision !== planningRevision || JSON.stringify(body()) !== baseline) return;
                    if (
                        !isRecord(result) ||
                        typeof result.identity !== "string" ||
                        !Number.isSafeInteger(result.requestCount) ||
                        Number(result.requestCount) < 1
                    )
                        throw new Error("Invalid AI review plan.");
                    planned = { identity: result.identity, requestCount: Number(result.requestCount) };
                    plannedInput = baseline;
                    count.textContent =
                        planned.requestCount + (planned.requestCount === 1 ? " AI request" : " AI requests") + " · approximate input estimate";
                    ai.disabled = false;
                } catch (cause) {
                    if (live() && count.isConnected && revision === planningRevision) {
                        count.textContent = "Request count unavailable";
                        error(cause);
                    }
                }
            }
            ai.disabled = true;
            aiContent.append(count, ai);
            // Native change events from preferences invalidate the previewed plan as well.
            content.addEventListener("change", () => void refreshReviewPlan());
            queueMicrotask(() => {
                if (live() && count.isConnected) void refreshReviewPlan();
            });
            const tools = e("div", "lb-transcription-tools");
            tools.append(options, aiOptions);
            main.append(tools);
            const actions = e("div", "lb-song-actions");
            const undo = button(
                "Undo",
                () => {
                    requireValue(history).undo();
                    requestRevision++;
                    dirty = true;
                    editor();
                },
                "",
                { icon: "back" },
            );
            undo.disabled = !history.canUndo;
            const redo = button(
                "Redo",
                () => {
                    requireValue(history).redo();
                    requestRevision++;
                    dirty = true;
                    editor();
                },
                "",
                { icon: "retry" },
            );
            redo.disabled = !history.canRedo;
            actions.append(
                undo,
                redo,
                button(
                    "Reset edits",
                    () => {
                        requireValue(history).replace(requireValue(baseline).ends);
                        settings = { ...requireValue(baseline).settings };
                        origin = requireValue(baseline).origin;
                        if (origin === "local") automaticKey = contentKey();
                        requestRevision++;
                        dirty = true;
                        editor();
                    },
                    "",
                    { icon: "reset" },
                ),
                button("Playback preview", () => void preview(), "", { icon: "preview" }),
            );
            main.append(actions);
            const phrases = e("div", "lb-transcription-phrases");
            main.append(phrases);
            const allowed = graphemeEnds(source.text);
            const guidance = new Map(review.boundaries.map((b) => [b.afterId, b.message]));
            let rendered = 0;
            const groups = history.phrases;
            const renderMore = () => {
                more.remove();
                const next = Math.min(Math.max(rendered + 100, phraseLimit), groups.length);
                for (let index = rendered; index < next; index++) {
                    const group = groups[index]!;
                    const last = group.at(-1)!;
                    const row = e("section", "lb-frame lb-transcription-phrase");
                    row.append(e("p", "lb-transcription-text", group.map((t) => t.separator + t.text).join("")));
                    const start = Math.min(...group.map((t) => t.start)),
                        end = Math.max(...group.map((t) => t.end));
                    row.append(
                        e("p", "lb-version-metadata", stamp(start) + " – " + stamp(end) + " · " + ((end - start) / 10_000_000).toFixed(2) + " s"),
                    );
                    const controls = e("div", "lb-song-actions");
                    controls.append(
                        button(
                            "Play phrase " + (index + 1),
                            () => {
                                clip?.();
                                clip = d.play(Math.max(0, start - 10_000_000), end + 10_000_000);
                            },
                            "",
                            { icon: "music" },
                        ),
                    );
                    if (index < groups.length - 1)
                        controls.append(
                            button(
                                "Merge with next",
                                () => {
                                    requireValue(history).merge(last.id);
                                    origin = "manual";
                                    updateDirty();
                                    requestRevision++;
                                    editor();
                                },
                                "",
                                { icon: "minus" },
                            ),
                            button(
                                "Play boundary " + (index + 1),
                                () => {
                                    clip?.();
                                    clip = d.play(Math.max(0, end - 15_000_000), end + 15_000_000);
                                },
                                "",
                                { icon: "timing" },
                            ),
                        );
                    row.append(controls);
                    if (group.length > 1) {
                        const { root: split, content: splits } = disclosure("Split phrase " + (index + 1), "", false);
                        for (const token of group.slice(0, -1))
                            if (allowed.has(token.endPosition)) {
                                const entry = e("div", "lb-transcription-split");
                                entry.append(
                                    button(
                                        "Split after “" + token.text.trim() + "”",
                                        () => {
                                            requireValue(history).split(token.id);
                                            origin = "manual";
                                            updateDirty();
                                            requestRevision++;
                                            editor();
                                        },
                                        "",
                                        { icon: "plus" },
                                    ),
                                );
                                const note = guidance.get(token.id);
                                if (note) entry.append(e("small", "lb-help", note));
                                splits.append(entry);
                            }
                        row.append(split);
                    }
                    phrases.append(row);
                }
                rendered = next;
                phraseLimit = Math.max(phraseLimit, rendered);
                if (rendered < groups.length) phrases.append(more);
            };
            const more = button("Show next 100 phrases", renderMore);
            renderMore();
            footer.replaceChildren();
            footer.hidden = false;
            footer.append(
                button(
                    "Back to recordings",
                    () => {
                        const change = () => {
                            dirty = false;
                            review = null;
                            history = null;
                            void list();
                        };
                        navigate("Save unfinished edits before returning to recordings?", change);
                    },
                    "",
                    { icon: "back" },
                ),
            );
            const saveButton = button("Save line breaks", () => void saveDraft(), "", {
                icon: "check",
                ...(review.canUse ? {} : { appearance: "primary" as const }),
            });
            saveButton.disabled = saving || !dirty || !review.canManage;
            footer.append(saveButton);
            const use = button(
                "Use reviewed lyrics",
                async () => {
                    if (saving) return;
                    saving = true;
                    setBusy(true);
                    footer.querySelectorAll<HTMLButtonElement>("button").forEach((n) => (n.disabled = true));
                    main.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select").forEach(
                        (n) => (n.disabled = true),
                    );
                    feedback.update(message, { message: "Saving and selecting reviewed lyrics…", severity: "progress" });
                    try {
                        await api(path() + "/use", "POST", body());
                        if (!live()) return;
                        saving = false;
                        dirty = false;
                        d.saved();
                        await d.finishWorkflow();
                    } catch (cause) {
                        if (live()) {
                            saving = false;
                            setBusy(false);
                            editor();
                            feedback.update(message, {
                                message: description(cause),
                                severity: "error",
                                actions: [
                                    {
                                        label: "Refresh selection baseline",
                                        run: async () => {
                                            try {
                                                const fresh = parseReview(await api(path()));
                                                if (live()) {
                                                    requireValue(review).selection = fresh.selection;
                                                    feedback.update(message, {
                                                        message: "Selection baseline refreshed. Review before using these lyrics.",
                                                        severity: "info",
                                                    });
                                                }
                                            } catch (error) {
                                                feedback.update(message, { message: description(error), severity: "error" });
                                            }
                                        },
                                    },
                                ],
                            });
                        }
                    } finally {
                        if (live()) {
                            saving = false;
                            setBusy(false);
                        }
                    }
                },
                "",
                { icon: "check", appearance: "primary" },
            );
            use.disabled = saving;
            if (review.canUse) footer.append(use);
            if (saving)
                panel
                    .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")
                    .forEach((n) => (n.disabled = true));
            if (!review.canUse) footer.append(e("p", "lb-help", "An administrator must use these lyrics for the shared track."));
            main.scrollTop = previousScroll;
            if (focused && !focused.isConnected) {
                const replacement = [...panel.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button,select")].find(
                    (node) => !node.disabled && (node.getAttribute("aria-label") || node.textContent) === focusLabel,
                );
                (replacement || main.querySelector<HTMLButtonElement>(".lb-transcription-phrase button"))?.focus({ preventScroll: true });
            }
        }
        async function list() {
            const revision = ++requestRevision;
            try {
                const capabilities = await api("transcription");
                const results = await api("items/" + target.itemId + "/transcriptions");
                if (!live() || revision !== requestRevision) return;
                if (!isRecord(capabilities) || !Array.isArray(results)) throw new Error("Invalid transcription capabilities.");
                feedback.releaseWithin(main);
                main.replaceChildren();
                footer.replaceChildren();
                footer.hidden = true;
                main.classList.remove("lb-transcription-editor");
                main.classList.add("lb-transcription-overview");
                const options = parseServiceOptions(capabilities.options);
                const transcriptionOptions = options.filter((o) => o.status === "Ready");
                const canTranscribe = capabilities.canTranscribe === true && transcriptionOptions.length > 0;
                const requestForm = e("section", "lb-transcription-request");
                if (canTranscribe) {
                    requestForm.append(
                        e(
                            "p",
                            "lb-help",
                            "Generate timed lyrics or speech remotely, then review the line breaks. Uploaded audio must be the same recording starting at time zero.",
                        ),
                    );
                    main.append(requestForm);
                } else {
                    const reason =
                        typeof capabilities.unavailableReason === "string"
                            ? capabilities.unavailableReason
                            : options.length > 0 && options.every((o) => o.status === "Disabled")
                              ? "transcription_disabled"
                              : transcriptionOptions.length === 0
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
                    main.append(availability);
                    feedback.update(availability, {
                        message: "New transcription is unavailable",
                        secondary: explanation + " " + guidance + " Saved transcription results remain available below.",
                        severity: "warning",
                    });
                }
                const choice = select(
                    requestForm,
                    "Transcription service",
                    "",
                    [["", "Choose a service…"], ...transcriptionOptions.map((o) => [o.id, o.name] as [string, string])],
                    () => {},
                );
                const language = e("input");
                language.value = "auto";
                field(requestForm, "Audio language", language, "auto, or a language code such as ja, en, es, ar or zh.");
                let submitting = false;
                const request = async (file?: File, existingUploadId?: string) => {
                    if (submitting) return;
                    const selected = transcriptionOptions.find((o) => o.id === choice.value);
                    if (!selected) {
                        error(new Error("Choose a transcription service."));
                        return;
                    }
                    submitting = true;
                    updateChoice();
                    const languageValue = language.value.trim() || "auto";
                    main.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select").forEach((node) => {
                        node.disabled = true;
                    });
                    try {
                        feedback.update(message, { message: file ? "Uploading audio…" : "Requesting transcription…", severity: "progress" });
                        let uploadId: string | undefined = existingUploadId;
                        if (file) {
                            if (file.size > selected.maxInputMb * 1_000_000)
                                throw new Error("The audio exceeds the configured " + selected.maxInputMb + " MB input limit.");
                            const uploaded = await api(
                                "items/" + target.itemId + "/transcription-upload?optionId=" + encodeURIComponent(selected.id),
                                "POST",
                                new AudioUploadBody(file, (loaded, total) => {
                                    if (live())
                                        feedback.update(message, {
                                            message: "Uploading audio · " + Math.round((100 * loaded) / total) + "%",
                                            severity: "progress",
                                        });
                                }),
                            );
                            if (!live()) return;
                            if (!isRecord(uploaded) || typeof uploaded.id !== "string") throw new Error("Invalid upload result.");
                            uploadId = uploaded.id;
                        }
                        const job = parseGenerationJob(
                            await api("items/" + target.itemId + "/transcribe", "POST", {
                                source: uploadId ? "upload" : "track",
                                uploadId,
                                language: languageValue,
                                optionId: selected.id,
                            }),
                        );
                        if (!live()) return;
                        watch(job, target, true);
                        choice.value = "";
                        feedback.update(message, {
                            message: "Transcription requested. Closing this panel leaves the admitted job running.",
                            severity: "info",
                        });
                    } catch (cause) {
                        error(cause);
                    } finally {
                        submitting = false;
                        if (live())
                            main.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select").forEach((node) => {
                                node.disabled = false;
                            });
                        if (live()) updateChoice();
                    }
                };
                const actions = e("div", "lb-song-actions");
                if (canTranscribe)
                    actions.append(
                        button("Transcribe current track", () => void request(), "", { icon: "generate", appearance: "primary" }),
                        button(
                            "Upload audio",
                            () => {
                                const input = e("input");
                                input.type = "file";
                                input.accept = "audio/*,.m4a,.flac,.ogg,.wav,.mp3,.webm";
                                input.onchange = () => {
                                    const file = input.files?.[0];
                                    if (file) void request(file);
                                };
                                input.click();
                            },
                            "",
                            { icon: "import" },
                        ),
                    );
                const choiceButtons = [...actions.querySelectorAll("button")];
                const updateChoice = () => choiceButtons.forEach((b) => (b.disabled = !choice.value || submitting));
                choice.onchange = updateChoice;
                updateChoice();
                if (canTranscribe) {
                    const primary = actions.querySelector(".lb-primary");
                    if (primary) actions.append(primary);
                    footer.append(...actions.children);
                    footer.hidden = false;
                }
                const retained = e("section", "lb-transcription-results");
                const heading = e("div", "lb-transcription-results-heading");
                heading.append(
                    e("h3", "lb-section-title", "Saved transcription results"),
                    button("Refresh recordings", () => void list(), "", { icon: "retry" }),
                );
                retained.append(heading);
                main.append(retained);
                for (const value of results) {
                    if (!isRecord(value) || typeof value.id !== "string" || typeof value.language !== "string" || typeof value.timing !== "string")
                        throw new Error("Invalid transcription result.");
                    const id = value.id;
                    const row = e("section", "lb-frame lb-transcription-phrase");
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
                    actions.append(button("Review line breaks", () => void load(id), "", { icon: "edit" }));
                    const capability =
                        isRecord(value.deletion) && typeof value.deletion.allowed === "boolean"
                            ? { allowed: value.deletion.allowed, reason: typeof value.deletion.reason === "string" ? value.deletion.reason : null }
                            : { allowed: false, reason: "Deletion permissions are unavailable. Refresh recordings." };
                    transcriptDelete(actions, id, capability, typeof value.savedEntryCount === "number" ? value.savedEntryCount : 0);
                    row.append(actions);
                    retained.append(row);
                }
                if (!results.length) retained.append(e("p", "lb-help", "No transcription results yet. Successful results stay here until deleted."));
                const staged = await api("items/" + target.itemId + "/transcription-uploads");
                if (!live()) return;
                if (Array.isArray(staged))
                    for (const upload of staged) {
                        if (!isRecord(upload) || typeof upload.id !== "string" || typeof upload.bytes !== "number") continue;
                        const uploadId = upload.id;
                        const row = e("div", "lb-song-actions");
                        row.append(
                            e("span", "lb-help", "Staged audio · " + (upload.bytes / 1_000_000).toFixed(1) + " MB"),
                            ...(canTranscribe ? [button("Use staged audio", () => void request(undefined, uploadId), "", { icon: "generate" })] : []),
                            button(
                                "Discard staged audio",
                                async () => {
                                    try {
                                        await api("items/" + target.itemId + "/transcription-uploads/" + uploadId, "DELETE");
                                        if (live()) await list();
                                    } catch (cause) {
                                        error(cause);
                                    }
                                },
                                "",
                                { icon: "trash" },
                            ),
                        );
                        main.append(row);
                    }
                const jobs = await api("jobs?active=true&itemId=" + target.itemId);
                if (live() && Array.isArray(jobs))
                    for (const value of jobs) {
                        const job = parseGenerationJob(value);
                        if (job.taskKind && job.taskKind !== "language" && !job.outputDeleted && activeGeneration(job)) watch(job, target);
                    }
            } catch (cause) {
                if (revision === requestRevision) error(cause);
            }
        }
        if (transcriptId) void load(transcriptId);
        else void list();
    }
    return {
        open,
        restore,
        canClose: () => active?.canClose() ?? true,
        dispose: () => {
            active?.dispose();
            active = null;
        },
    };
}
