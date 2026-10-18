import { type GenerationJob } from "../../contracts/generation.ts";
import { isRecord } from "../../shared/invariants.ts";
import { parseGenerationJob } from "../jobs/generation-state.ts";
import type { ServiceOptionInfo } from "../services/service-options.ts";
import { AudioUploadBody } from "../transport/api.ts";
import { button, e, field, select } from "../ui/controls.ts";
interface SubmissionDependencies {
    itemId: string;
    options: readonly ServiceOptionInfo[];
    api(path: string, method?: string, body?: unknown): Promise<unknown>;
    live(): boolean;
    busy(value: boolean): void;
    notice(message: string, progress: boolean): void;
    failed(cause: unknown): void;
    admitted(job: GenerationJob): void;
    changed(): void;
}
/** Upload and admission belong to the panel; a successfully admitted job changes owners. */
export class TranscriptionSubmission {
    private submitting = false;
    private optionId = "";
    private language = "auto";
    private readonly d: SubmissionDependencies;
    constructor(d: SubmissionDependencies) {
        this.d = d;
    }
    get snapshot() {
        return Object.freeze({ submitting: this.submitting, optionId: this.optionId, language: this.language });
    }
    selectOption(id: string): void {
        if (!this.submitting) {
            this.optionId = id;
            this.d.changed();
        }
    }
    setLanguage(language: string): void {
        if (!this.submitting) this.language = language;
    }
    async submit(file?: File, existingUploadId?: string): Promise<void> {
        if (this.submitting || !this.d.live()) return;
        const selected = this.d.options.find((o) => o.id === this.optionId);
        if (!selected) {
            this.d.failed(new Error("Choose a transcription service."));
            return;
        }
        const language = this.language.trim() || "auto";
        this.submitting = true;
        this.d.busy(true);
        this.d.changed();
        try {
            this.d.notice(file ? "Uploading audio…" : "Requesting transcription…", true);
            let uploadId = existingUploadId;
            if (file) {
                if (file.size > selected.maxInputMb * 1_000_000)
                    throw new Error("The audio exceeds the configured " + selected.maxInputMb + " MB input limit.");
                const uploaded = await this.d.api(
                    "items/" + this.d.itemId + "/transcription-upload?optionId=" + encodeURIComponent(selected.id),
                    "POST",
                    new AudioUploadBody(file, (loaded, total) => {
                        if (this.d.live()) this.d.notice("Uploading audio · " + Math.round((100 * loaded) / total) + "%", true);
                    }),
                );
                if (!this.d.live()) return;
                if (!isRecord(uploaded) || typeof uploaded.id !== "string") throw new Error("Invalid upload result.");
                uploadId = uploaded.id;
            }
            const job = parseGenerationJob(
                await this.d.api("items/" + this.d.itemId + "/transcribe", "POST", {
                    source: uploadId ? "upload" : "track",
                    uploadId,
                    language,
                    optionId: selected.id,
                }),
            );
            if (!this.d.live()) return;
            this.d.admitted(job);
            this.optionId = "";
            this.d.notice("Transcription requested. Closing this panel leaves the admitted job running.", false);
        } catch (cause) {
            if (this.d.live()) this.d.failed(cause);
        } finally {
            this.submitting = false;
            if (this.d.live()) {
                this.d.busy(false);
                this.d.changed();
            }
        }
    }
}
interface ViewDependencies extends Omit<SubmissionDependencies, "changed" | "busy"> {
    main: HTMLElement;
}
/** Native controls are an adapter for the submission controller, never its state storage. */
export function createTranscriptionSubmission(d: ViewDependencies) {
    const form = e("section", "lb-transcription-request");
    form.append(
        e(
            "p",
            "lb-help",
            "Generate timed lyrics or speech remotely, then review the line breaks. Uploaded audio must be the same recording starting at time zero.",
        ),
    );
    const controller = new TranscriptionSubmission({
        ...d,
        busy: (value) =>
            d.main
                .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")
                .forEach((n) => (n.disabled = value)),
        changed: () => {
            const s = controller.snapshot;
            choice.value = s.optionId;
            choiceButtons.forEach((b) => (b.disabled = !s.optionId || s.submitting));
        },
    });
    const choice = select(
        form,
        "Transcription service",
        "",
        [["", "Choose a service…"], ...d.options.map((o) => [o.id, o.name] as [string, string])],
        (id) => controller.selectOption(id),
    );
    const language = e("input");
    language.value = "auto";
    language.oninput = () => controller.setLanguage(language.value);
    field(form, "Audio language", language, "auto, or a language code such as ja, en, es, ar or zh.");
    const actions = e("div", "lb-song-actions");
    const primary = button("Transcribe current track", () => void controller.submit(), "", { icon: "generate", appearance: "primary" });
    actions.append(
        button(
            "Upload audio",
            () => {
                const input = e("input");
                input.type = "file";
                input.accept = "audio/*,.m4a,.flac,.ogg,.wav,.mp3,.webm";
                input.onchange = () => {
                    const file = input.files?.[0];
                    if (file) void controller.submit(file);
                };
                input.click();
            },
            "",
            { icon: "import" },
        ),
        primary,
    );
    const choiceButtons = [...actions.querySelectorAll<HTMLButtonElement>("button")];
    choiceButtons.forEach((b) => (b.disabled = true));
    return { form, actions, submit: (id: string) => controller.submit(undefined, id) };
}
