import type { BridgeDocument } from "../../contracts/bridge.ts";
import { FeedbackScope } from "../../shared/feedback.ts";
import type { PlaybackPreviewRequest } from "../preview/playback-preview.ts";
import type { TrackScope } from "../session/contracts.ts";
import { BridgeRequestError } from "../transport/api.ts";
import { button } from "../ui/controls.ts";
import { createDialog } from "../ui/dialog.ts";
import { feedbackHost, glassFeedback } from "../ui/feedback.ts";
import type { PlaybackNotifications } from "../ui/playback-notifications.ts";
import { createTranscriptionEditor } from "./editor.ts";
import { createTranscriptionJobs } from "./jobs.ts";
import { createTranscriptionOverview } from "./overview.ts";
import { TranscriptionReviewController } from "./review-controller.ts";
interface Dependencies {
    scope(): TrackScope | null;
    panel(): HTMLElement | null;
    mount(panel: HTMLElement): void;
    beginWorkflow(): boolean;
    closeSearch(restore?: boolean): void;
    endPlaybackPreview(): void;
    startPlaybackPreview(request: PlaybackPreviewRequest): void;
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
/** Composition root: panel sessions and track-owned job monitors have independent lifetimes. */
export function createTranscriptionPanel(d: Dependencies) {
    let active: { canClose(): boolean; dispose(): void; refreshSaved(id: string): Promise<void> } | null = null;
    const jobs = createTranscriptionJobs({ ...d, open, reviewCompleted: (id) => active?.refreshSaved(id) });
    function open(transcriptId?: string, reviewResultId?: string) {
        if (active && !active.canClose()) return;
        if (!d.beginWorkflow()) return;
        const target = d.scope();
        if (!target) return;
        const cancellation = new AbortController(),
            abort = () => cancellation.abort();
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
        const message = feedbackHost(),
            confirmation = feedbackHost("confirmation");
        message.hidden = true;
        confirmation.hidden = true;
        feedbackArea.classList.add("lb-transcription-status");
        feedbackArea.append(message, confirmation);
        footer.hidden = true;
        const live = () => d.scope() === target && d.panel() === panel && !cancellation.signal.aborted;
        const api = (path: string, method = "GET", body?: unknown) => d.api(path, method, body, cancellation.signal);
        const error = (cause: unknown) => {
            if (!live()) return;
            feedback.update(message, {
                message: description(cause),
                severity: "error",
                actions:
                    cause instanceof BridgeRequestError && cause.details.code === "line_breaks_deleted" && review.snapshot.review
                        ? [{ label: "Refresh saved line breaks", run: () => review.refreshEntries() }]
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
        const navigate = (text: string, run: () => unknown) => {
            const s = review.snapshot;
            if (s.saving) return;
            if (!s.dirty) {
                void run();
                return;
            }
            feedback.update(confirmation, {
                message: text,
                secondary: s.review?.canManage ? undefined : "Only the transcript owner or an administrator can save line breaks.",
                severity: "warning",
                actions: [
                    {
                        label: "Save and continue",
                        disabled: !s.review?.canManage,
                        run: async () => {
                            if (await review.save()) {
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
        const review = new TranscriptionReviewController({
            itemId: target.itemId,
            api,
            live,
            changed: (reason) => {
                const s = review.snapshot;
                setBusy(s.saving);
                confirmation
                    .querySelectorAll<HTMLButtonElement>("button")
                    .forEach((b) => (b.disabled = s.saving || (b.textContent === "Save and continue" && !s.review?.canManage)));
                editor.update(reason);
            },
            notice: (options) => {
                if (live()) feedback.update(message, options);
            },
            failed: error,
            preview: (lyrics) =>
                d.startPlaybackPreview({
                    document: { ...d.documentState(), lyrics, canGenerate: false, canSelect: false },
                    description: "Reviewing transcription line breaks",
                    returnLabel: "Return to line breaks",
                    panel,
                    trigger: footer.querySelector<HTMLElement>("[data-playback-preview]"),
                }),
            admitted: (job) => jobs.watch(job, target, true),
            used: async () => {
                d.saved();
                await d.finishWorkflow();
            },
        });
        const browse = () => {
            review.leave();
            void overview.show();
        };
        const load = (id: string) => {
            overview.invalidate();
            void review.load(id, reviewResultId);
        };
        const deleteTranscript = (
            parent: HTMLElement,
            id: string,
            capability: { readonly allowed: boolean; readonly reason: string | null },
            count: number,
        ) => {
            const remove = button(
                "Delete transcription",
                () =>
                    ask(
                        "Delete this transcript and its " +
                            count +
                            " saved line-break entries? Associated reviews and active requests will be removed or cancelled. Saved originals are never deleted. This cannot be undone.",
                        () => overview.removeTranscript(id),
                        "Delete",
                    ),
                "",
                { icon: "trash" },
            );
            remove.disabled = review.snapshot.saving || !capability.allowed;
            parent.append(remove);
            if (capability.reason) {
                const reason = document.createElement("p");
                reason.className = "lb-help";
                reason.textContent = capability.reason;
                parent.append(reason);
            }
        };
        const overview = createTranscriptionOverview({
            itemId: target.itemId,
            main,
            footer,
            feedback,
            api,
            live,
            open: load,
            deleted: (id) => {
                if (!review.snapshot.review || review.snapshot.review.transcript.id === id) browse();
            },
            notice: (text, progress) => {
                if (live()) feedback.update(message, { message: text, severity: progress ? "progress" : "info" });
            },
            failed: error,
            admitted: (job, explicit) => jobs.watch(job, target, explicit),
            deleteTranscript,
        });
        const editor = createTranscriptionEditor({
            controller: review,
            panel,
            main,
            footer,
            feedback,
            setBusy,
            live,
            navigate,
            ask,
            browse,
            deleteTranscript,
            play: d.play,
        });
        function close() {
            if (!review.snapshot.saving)
                navigate("Save unfinished line-break edits before closing?", () => {
                    review.leave();
                    d.closeSearch();
                });
        }
        active = {
            canClose: () => {
                if (review.snapshot.saving) return false;
                if (review.snapshot.dirty) {
                    close();
                    return false;
                }
                return true;
            },
            dispose: () => {
                cancellation.abort();
                target.controller.signal.removeEventListener("abort", abort);
                review.dispose();
                overview.invalidate();
                editor.dispose();
                feedback.dispose();
                d.endPlaybackPreview();
            },
            refreshSaved: (id) => review.refreshSaved(id),
        };
        d.mount(panel);
        d.updatePanelBounds();
        if (transcriptId) load(transcriptId);
        else void overview.show();
    }
    return {
        open,
        restore: jobs.restore,
        canClose: () => active?.canClose() ?? true,
        dispose: () => {
            active?.dispose();
            active = null;
        },
    };
}
