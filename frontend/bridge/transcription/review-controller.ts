import { type GenerationJob } from "../../contracts/generation.ts";
import type { RichLyrics } from "../../contracts/lyrics.ts";
import type { FeedbackOptions } from "../../shared/feedback.ts";
import { isRecord, requireValue } from "../../shared/invariants.ts";
import { parseGenerationJob } from "../jobs/generation-state.ts";
import { parseServiceOptions, type ServiceOptionInfo } from "../services/service-options.ts";
import { BoundaryHistory, parseBoundaryVersion, parseReview, type BreakSettings, type ReviewDocument, type TimedToken } from "./state.ts";

export type ReviewChange = "render" | "choices" | "state" | "plan";
type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
interface ReviewSnapshot {
    review: ReviewDocument | null;
    ends: string[];
    phrases: TimedToken[][];
    canUndo: boolean;
    canRedo: boolean;
    hasHistory: boolean;
    dirty: boolean;
    saving: boolean;
    settings: BreakSettings;
    selectedEntryId: string;
    selectedVersionId: string;
    selectedResultId: string;
    reviewOptions: ServiceOptionInfo[];
    selectedReviewOption: string;
    plan: { identity: string; requestCount: number } | null;
    planStatus: "idle" | "loading" | "ready" | "unavailable";
}
interface Dependencies {
    itemId: string;
    api(path: string, method?: string, body?: unknown): Promise<unknown>;
    live(): boolean;
    changed(reason: ReviewChange): void;
    notice(options: FeedbackOptions): void;
    failed(cause: unknown): void;
    preview(lyrics: RichLyrics): void;
    admitted(job: GenerationJob): void;
    used(): Promise<void>;
}
function immutable<T>(value: T): Immutable<T> {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) immutable(child);
        Object.freeze(value);
    }
    return value as Immutable<T>;
}
const defaults = (): BreakSettings => ({ characters: null, seconds: 3, keepShortReplies: true });

/** One panel-owned review session. DOM and track-owned job monitors are external effects. */
export class TranscriptionReviewController {
    private review: ReviewDocument | null = null;
    private history: BoundaryHistory | null = null;
    private settings = defaults();
    private reviewOptions: ServiceOptionInfo[] = [];
    private selectedReviewOption = "";
    private selectedEntryId = "";
    private selectedVersionId = "";
    private selectedResultId = "";
    private origin = "manual";
    private automaticKey = "";
    private baseline: { ends: string[]; settings: BreakSettings; origin: string; saved: boolean } | null = null;
    private baselineKey = "";
    private dirty = false;
    private saving = false;
    private revision = 0;
    private savedRevision = 0;
    private planningRevision = 0;
    private plan: ReviewSnapshot["plan"] = null;
    private planStatus: ReviewSnapshot["planStatus"] = "idle";
    private plannedInput = "";
    private disposed = false;
    private cached: Immutable<ReviewSnapshot> | null = null;
    private readonly d: Dependencies;
    constructor(d: Dependencies) {
        this.d = d;
    }
    private live(): boolean {
        return !this.disposed && this.d.live();
    }
    private editable(): boolean {
        return this.live() && !this.saving;
    }
    get snapshot(): Immutable<ReviewSnapshot> {
        return (this.cached ??= immutable(
            structuredClone({
                review: this.review,
                ends: this.history?.ends ?? [],
                phrases: this.history?.phrases ?? [],
                hasHistory: !!this.history,
                canUndo: this.history?.canUndo ?? false,
                canRedo: this.history?.canRedo ?? false,
                dirty: this.dirty,
                saving: this.saving,
                settings: this.settings,
                selectedEntryId: this.selectedEntryId,
                selectedVersionId: this.selectedVersionId,
                selectedResultId: this.selectedResultId,
                reviewOptions: this.reviewOptions,
                selectedReviewOption: this.selectedReviewOption,
                plan: this.plan,
                planStatus: this.planStatus,
            }),
        ));
    }
    private publish(reason: ReviewChange): void {
        this.cached = null;
        if (this.live()) this.d.changed(reason);
    }
    private key(): string {
        return JSON.stringify({ ends: this.history?.ends, settings: this.settings });
    }
    private path(): string {
        return "items/" + this.d.itemId + "/transcriptions/" + requireValue(this.review).transcript.id;
    }
    private body() {
        return {
            transcriptId: requireValue(this.review).transcript.id,
            endTokenIds: requireValue(this.history).ends,
            settings: { ...this.settings },
            origin: this.origin === "local" && this.automaticKey === this.key() ? "local" : "manual",
            ...(this.selectedEntryId ? { entryId: this.selectedEntryId } : {}),
            expectedSelection: requireValue(this.review).selection,
            ...(this.selectedReviewOption ? { optionId: this.selectedReviewOption } : {}),
        };
    }
    private captureBaseline(saved: boolean): void {
        this.baseline = { ends: requireValue(this.history).ends, settings: { ...this.settings }, origin: this.origin, saved };
        this.baselineKey = this.key();
        this.dirty = !saved;
    }
    private updateDirty(): void {
        this.dirty = !!this.history && (!this.baseline?.saved || this.key() !== this.baselineKey);
    }
    private invalidatePlan(): void {
        this.planningRevision++;
        this.plan = null;
        this.plannedInput = "";
        this.planStatus = "idle";
    }
    private edited(reason: ReviewChange = "render"): void {
        this.revision++;
        this.invalidatePlan();
        this.updateDirty();
        this.publish(reason);
        if (this.selectedReviewOption) void this.refreshPlan();
    }
    dispose(): void {
        this.disposed = true;
        this.revision++;
        this.savedRevision++;
        this.invalidatePlan();
    }
    leave(): void {
        if (!this.editable()) return;
        this.revision++;
        this.savedRevision++;
        this.invalidatePlan();
        this.review = null;
        this.history = null;
        this.dirty = false;
        this.publish("state");
    }
    async load(id: string, resultId?: string): Promise<void> {
        if (!this.editable()) return;
        const revision = ++this.revision;
        this.savedRevision++;
        this.invalidatePlan();
        this.d.notice({ message: "Loading preserved transcript…", severity: "progress" });
        try {
            const config = await this.d.api("transcription");
            if (!this.live() || revision !== this.revision) return;
            if (!isRecord(config)) throw new Error("Invalid service options.");
            const options = parseServiceOptions(config.reviewOptions).filter((o) => o.status === "Ready");
            const review = parseReview(await this.d.api("items/" + this.d.itemId + "/transcriptions/" + id));
            if (!this.live() || revision !== this.revision) return;
            this.review = review;
            this.reviewOptions = options;
            const entry = review.savedEntries.find((e) => e.id === "review:" + resultId) ?? review.savedEntries.at(-1);
            const version = review.versions.find((v) => v.id === entry?.versionId);
            this.selectedEntryId = entry?.id ?? "";
            this.selectedVersionId = version?.id ?? "";
            this.selectedResultId = entry?.id.startsWith("review:") ? entry.id.slice(7) : "";
            this.settings = { ...(entry?.settings ?? defaults()) };
            this.origin = entry?.origin === "local" ? "local" : "manual";
            this.history = version ? new BoundaryHistory(review.transcript.tokens, version.endTokenIds) : null;
            this.baseline = null;
            this.baselineKey = "";
            this.dirty = false;
            if (this.history) {
                this.automaticKey = this.origin === "local" ? this.key() : "";
                this.captureBaseline(true);
            }
            this.d.notice({ message: "" });
            this.publish("render");
            if (this.selectedReviewOption && this.history) void this.refreshPlan();
        } catch (cause) {
            if (this.live() && revision === this.revision) this.d.failed(cause);
        }
    }
    selectEntry(id: string): void {
        if (!this.editable() || !this.review) return;
        const entry = this.review.savedEntries.find((e) => e.id === id);
        const version = this.review.versions.find((v) => v.id === entry?.versionId);
        if (!entry || !version) return;
        this.history = new BoundaryHistory(this.review.transcript.tokens, version.endTokenIds);
        this.settings = { ...entry.settings };
        this.selectedEntryId = id;
        this.selectedVersionId = version.id;
        this.selectedResultId = id.startsWith("review:") ? id.slice(7) : "";
        this.origin = entry.origin === "local" ? "local" : "manual";
        this.automaticKey = this.origin === "local" ? this.key() : "";
        this.captureBaseline(true);
        this.edited();
    }
    split(id: string): void {
        if (this.editable() && this.history) {
            this.history.split(id);
            this.origin = "manual";
            this.edited();
        }
    }
    merge(id: string): void {
        if (this.editable() && this.history) {
            this.history.merge(id);
            this.origin = "manual";
            this.edited();
        }
    }
    undo(): void {
        if (this.editable() && this.history) {
            this.history.undo();
            this.edited();
        }
    }
    redo(): void {
        if (this.editable() && this.history) {
            this.history.redo();
            this.edited();
        }
    }
    reset(): void {
        if (!this.editable() || !this.history || !this.baseline) return;
        this.history.replace(this.baseline.ends);
        this.settings = { ...this.baseline.settings };
        this.origin = this.baseline.origin;
        if (this.origin === "local") this.automaticKey = this.key();
        this.edited();
    }
    updateSettings(settings: Partial<BreakSettings>): void {
        if (!this.editable()) return;
        this.settings = { ...this.settings, ...settings };
        this.edited("state");
    }
    async automatic(): Promise<void> {
        if (!this.editable() || !this.review) return;
        const revision = ++this.revision;
        const path = this.path();
        try {
            const version = parseBoundaryVersion(await this.d.api(path + "/break", "POST", { ...this.settings }));
            if (!this.live() || revision !== this.revision) return;
            const initial = !this.history;
            if (this.history) this.history.replace(version.endTokenIds);
            else this.history = new BoundaryHistory(this.review.transcript.tokens, version.endTokenIds);
            this.origin = "local";
            this.automaticKey = this.key();
            if (initial) this.captureBaseline(false);
            this.edited();
        } catch (cause) {
            if (this.live() && revision === this.revision) this.d.failed(cause);
        }
    }
    selectReviewOption(id: string): void {
        if (!this.editable()) return;
        this.selectedReviewOption = id;
        void this.refreshPlan();
    }
    async refreshPlan(): Promise<void> {
        const revision = ++this.planningRevision;
        this.plan = null;
        this.plannedInput = "";
        if (!this.selectedReviewOption || !this.history || !this.live()) {
            this.planStatus = "idle";
            this.publish("plan");
            return;
        }
        const input = this.body(),
            key = JSON.stringify(input),
            path = this.path();
        this.planStatus = "loading";
        this.publish("plan");
        const current = () => this.live() && revision === this.planningRevision && !!this.history && key === JSON.stringify(this.body());
        try {
            const result = await this.d.api(path + "/review-plan", "POST", input);
            if (!current()) return;
            if (
                !isRecord(result) ||
                typeof result.identity !== "string" ||
                !Number.isSafeInteger(result.requestCount) ||
                Number(result.requestCount) < 1
            )
                throw new Error("Invalid AI review plan.");
            this.plan = { identity: result.identity, requestCount: Number(result.requestCount) };
            this.plannedInput = key;
            this.planStatus = "ready";
            this.publish("plan");
        } catch (cause) {
            if (current()) {
                this.planStatus = "unavailable";
                this.publish("plan");
                this.d.failed(cause);
            }
        }
    }
    async requestReview(): Promise<void> {
        if (!this.editable() || !this.history) return;
        const revision = this.revision,
            option = this.selectedReviewOption,
            planningRevision = this.planningRevision;
        try {
            if (!this.selectedReviewOption) throw new Error("Choose an AI review service.");
            if (!this.plan || this.plannedInput !== JSON.stringify(this.body())) {
                await this.refreshPlan();
                return;
            }
            const job = parseGenerationJob(await this.d.api(this.path() + "/review", "POST", { ...this.body(), planIdentity: this.plan.identity }));
            if (!this.live()) return;
            this.d.admitted(job);
            if (revision !== this.revision || option !== this.selectedReviewOption || planningRevision !== this.planningRevision) return;
            this.selectedReviewOption = "";
            this.invalidatePlan();
            this.publish("plan");
            this.d.notice({ message: "AI review requested. Your current edits stay in place; open Review result when ready.", severity: "info" });
        } catch (cause) {
            if (this.live() && revision === this.revision && planningRevision === this.planningRevision) this.d.failed(cause);
        }
    }
    async preview(): Promise<void> {
        if (!this.editable() || !this.history) return;
        const revision = this.revision,
            input = this.body(),
            key = JSON.stringify(input);
        try {
            const lyrics = await this.d.api(this.path() + "/preview", "POST", input);
            if (!this.live() || revision !== this.revision || !this.history || key !== JSON.stringify(this.body())) return;
            if (!isRecord(lyrics) || !Array.isArray(lyrics.lines)) throw new Error("Invalid playback preview.");
            this.d.preview(lyrics as unknown as RichLyrics);
        } catch (cause) {
            if (this.live() && revision === this.revision) this.d.failed(cause);
        }
    }
    async save(): Promise<boolean> {
        if (!this.editable() || !this.history || !this.review?.canManage) return false;
        this.saving = true;
        this.revision++;
        this.invalidatePlan();
        this.publish("render");
        try {
            const saved = await this.d.api(this.path() + "/save", "POST", this.body());
            if (!this.live()) return false;
            if (!isRecord(saved) || typeof saved.id !== "string") throw new Error("Invalid saved line breaks.");
            const fresh = parseReview(await this.d.api(this.path()));
            if (!this.live()) return false;
            this.savedRevision++;
            this.review = fresh;
            this.selectedEntryId = saved.id;
            this.selectedVersionId = typeof saved.versionId === "string" ? saved.versionId : "";
            this.selectedResultId = saved.id.startsWith("review:") ? saved.id.slice(7) : "";
            this.captureBaseline(true);
            this.d.notice({ message: "Line breaks saved.", severity: "success" });
            return true;
        } catch (cause) {
            if (this.live()) this.d.failed(cause);
            return false;
        } finally {
            this.saving = false;
            this.publish("render");
            if (this.live() && this.selectedReviewOption) void this.refreshPlan();
        }
    }
    async use(): Promise<void> {
        if (!this.editable() || !this.history || !this.review?.canUse) return;
        this.saving = true;
        this.revision++;
        this.invalidatePlan();
        this.publish("render");
        this.d.notice({ message: "Saving and selecting reviewed lyrics…", severity: "progress" });
        try {
            await this.d.api(this.path() + "/use", "POST", this.body());
            if (!this.live()) return;
            this.saving = false;
            this.dirty = false;
            this.cached = null;
            await this.d.used();
        } catch (cause) {
            if (this.live())
                this.d.notice({
                    message: cause instanceof Error ? cause.message : "The transcription action could not complete.",
                    severity: "error",
                    actions: [{ label: "Refresh selection baseline", run: () => this.refreshSelection() }],
                });
        } finally {
            this.saving = false;
            this.publish("render");
        }
    }
    async refreshSelection(): Promise<void> {
        if (!this.editable() || !this.review) return;
        const id = this.review.transcript.id,
            revision = this.revision;
        try {
            const fresh = parseReview(await this.d.api(this.path()));
            if (!this.live() || revision !== this.revision || this.review?.transcript.id !== id) return;
            this.review.selection = fresh.selection;
            this.publish("state");
            this.d.notice({ message: "Selection baseline refreshed. Review before using these lyrics.", severity: "info" });
        } catch (cause) {
            if (this.live() && revision === this.revision) this.d.failed(cause);
        }
    }
    private adoptEntries(fresh: ReviewDocument): void {
        this.review = fresh;
        if (!fresh.savedEntries.some((e) => e.id === this.selectedEntryId)) {
            this.selectedEntryId = "";
            this.selectedVersionId = "";
            this.selectedResultId = "";
            if (this.baseline) this.baseline.saved = false;
        }
        this.updateDirty();
    }
    async refreshEntries(): Promise<void> {
        if (!this.editable() || !this.review) return;
        const id = this.review.transcript.id,
            revision = ++this.savedRevision;
        try {
            const fresh = parseReview(await this.d.api(this.path()));
            if (!this.live() || this.saving || revision !== this.savedRevision || this.review?.transcript.id !== id) return;
            this.adoptEntries(fresh);
            this.publish("render");
            this.d.notice({
                message: "Saved list refreshed. Your draft and undo history are retained; review before saving or using these lyrics.",
                severity: "info",
            });
        } catch (cause) {
            if (this.live() && revision === this.savedRevision) this.d.failed(cause);
        }
    }
    async refreshSaved(id: string): Promise<void> {
        if (!this.live() || this.saving || this.review?.transcript.id !== id) return;
        const revision = ++this.savedRevision;
        try {
            const fresh = parseReview(await this.d.api(this.path()));
            if (!this.live() || this.saving || revision !== this.savedRevision || this.review?.transcript.id !== id) return;
            this.review.versions = fresh.versions;
            this.review.savedEntries = fresh.savedEntries;
            this.review.deletion = fresh.deletion;
            this.review.reviewResults = fresh.reviewResults;
            if (!this.history) {
                await this.load(id);
                return;
            }
            this.publish("choices");
        } catch {
            /* Reopening retries this panel-owned read. */
        }
    }
    async deleteEntry(id: string): Promise<void> {
        if (!this.editable() || !this.review) return;
        const transcript = this.review.transcript.id,
            revision = ++this.savedRevision,
            path = this.path();
        try {
            await this.d.api(path + "/entries/" + encodeURIComponent(id), "DELETE");
            if (!this.live() || revision !== this.savedRevision || this.review?.transcript.id !== transcript) return;
            const fresh = parseReview(await this.d.api(path));
            if (!this.live() || this.saving || revision !== this.savedRevision || this.review?.transcript.id !== transcript) return;
            this.adoptEntries(fresh);
            this.publish("render");
        } catch (cause) {
            if (this.live() && revision === this.savedRevision) this.d.failed(cause);
        }
    }
}
export type TranscriptionReviewSnapshot = Immutable<ReviewSnapshot>;
