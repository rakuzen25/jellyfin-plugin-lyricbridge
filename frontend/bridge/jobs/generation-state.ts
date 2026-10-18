import { type RequestFailure } from "../../contracts/errors.ts";
import type { GenerationJob } from "../../contracts/generation.ts";
import { isRecord as record } from "../../shared/invariants.ts";
import { BridgeRequestError } from "../transport/api.ts";

export function parseGenerationJob(value: unknown): GenerationJob {
    if (
        !record(value) ||
        typeof value.id !== "string" ||
        typeof value.state !== "string" ||
        typeof value.progress !== "number" ||
        !Number.isFinite(value.progress) ||
        !record(value.request) ||
        typeof value.request.service !== "string" ||
        typeof value.request.kind !== "string" ||
        !(value.request.language === undefined || typeof value.request.language === "string") ||
        !(value.hash === undefined || typeof value.hash === "string") ||
        !(value.error == null || typeof value.error === "string") ||
        !(value.outputDeleted === undefined || typeof value.outputDeleted === "boolean") ||
        !(value.outputDeletedAt == null || typeof value.outputDeletedAt === "string")
    )
        throw new Error("Jellyfin returned an invalid generation status. Reload the job details.");
    let failure: RequestFailure | null = null;
    if (value.failure != null) {
        const data = value.failure;
        if (
            !record(data) ||
            typeof data.code !== "string" ||
            typeof data.message !== "string" ||
            !(data.retryable === undefined || typeof data.retryable === "boolean") ||
            !(data.diagnosticId == null || typeof data.diagnosticId === "string") ||
            !(data.retryAt == null || typeof data.retryAt === "string")
        )
            throw new Error("Jellyfin returned invalid generation error details. Reload the job details.");
        failure = {
            code: data.code,
            message: data.message,
            retryable: data.retryable,
            diagnosticId: data.diagnosticId ?? undefined,
            retryAt: data.retryAt ?? undefined,
        };
    }
    return {
        id: value.id,
        ...(record(value.reviewPlan) && typeof value.reviewPlan.requestCount === "number"
            ? { reviewRequestCount: value.reviewPlan.requestCount }
            : {}),
        ...(typeof value.taskKind === "string" ? { taskKind: value.taskKind } : {}),
        ...(typeof value.stage === "string" ? { stage: value.stage } : {}),
        ...(typeof value.resultId === "string" ? { resultId: value.resultId } : {}),
        ...(record(value.audio) && typeof value.audio.chunkCount === "number"
            ? { chunkCount: value.audio.chunkCount, allowChunking: value.audio.allowChunking === true }
            : {}),
        ...(value.hash === undefined ? {} : { hash: value.hash }),
        state: value.state,
        progress: value.progress,
        request: {
            service: value.request.service,
            kind: value.request.kind,
            language: value.request.language,
            ...(typeof value.request.optionName === "string" ? { optionName: value.request.optionName } : {}),
            ...(typeof value.request.optionId === "string" ? { optionId: value.request.optionId } : {}),
        },
        error: value.error,
        failure,
        ...(value.outputDeleted === undefined ? {} : { outputDeleted: value.outputDeleted }),
        ...(value.outputDeletedAt === undefined ? {} : { outputDeletedAt: value.outputDeletedAt }),
    };
}
export function activeGeneration(job: Pick<GenerationJob, "state">): boolean {
    return ["pending", "queued", "running"].includes(job.state);
}
interface MonitorOptions {
    signal: AbortSignal;
    read(signal: AbortSignal): Promise<GenerationJob>;
    changed(job: GenerationJob): void | Promise<void>;
    failed(error: unknown, retry: () => Promise<void>): void;
    removed?(): void;
    pollMs?: number;
}
/** One track-owned poller per job. Superseded requests cannot publish or reschedule. */
export class GenerationMonitor {
    private readonly options: MonitorOptions;
    private request: AbortController | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private readonly onAbort = () => this.dispose();
    constructor(options: MonitorOptions) {
        this.options = options;
        if (options.signal.aborted) this.disposed = true;
        else options.signal.addEventListener("abort", this.onAbort, { once: true });
    }
    readonly poll = async (): Promise<void> => {
        if (this.disposed) return;
        clearTimeout(this.timer);
        this.request?.abort();
        const request = new AbortController();
        this.request = request;
        const current = () => !this.disposed && this.request === request;
        try {
            const job = await this.options.read(request.signal);
            if (!current()) return;
            await this.options.changed(job);
            if (current() && activeGeneration(job))
                this.timer = setTimeout(() => {
                    void this.poll();
                }, this.options.pollMs ?? 1000);
        } catch (error) {
            if (current() && error instanceof BridgeRequestError && error.status === 404 && this.options.removed) {
                this.options.removed();
                this.dispose();
            } else if (current()) this.options.failed(error, this.poll);
        }
    };
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        clearTimeout(this.timer);
        this.request?.abort();
        this.request = null;
        this.options.signal.removeEventListener("abort", this.onAbort);
    }
}
