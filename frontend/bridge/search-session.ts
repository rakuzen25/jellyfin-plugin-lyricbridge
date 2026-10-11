/** Owns one manual search, including admission that finishes after cancellation. */
export interface SearchTransport<TQuery, TResult extends { state: string }> {
    // Admission must settle so late handles can be released even after cancellation.
    start(query: TQuery): Promise<{ id: string }>;
    read(id: string, signal: AbortSignal): Promise<TResult>;
    release(id: string): Promise<void>;
}
export type SearchState<TResult> =
    { kind: "idle" } | { kind: "admitting" } | { kind: "results"; value: TResult } | { kind: "failed"; error: unknown } | { kind: "disposed" };
interface Attempt {
    controller: AbortController;
    id?: string;
    timer?: ReturnType<typeof setTimeout>;
}
export class SearchSession<TQuery, TResult extends { state: string }> {
    private attempt: Attempt | null = null;
    private disposed = false;
    private readonly transport: SearchTransport<TQuery, TResult>;
    private readonly changed: (state: SearchState<TResult>) => void;
    private readonly pollMs: number;
    constructor(transport: SearchTransport<TQuery, TResult>, changed: (state: SearchState<TResult>) => void, pollMs = 500) {
        this.transport = transport;
        this.changed = changed;
        this.pollMs = pollMs;
    }
    private owns(attempt: Attempt): boolean {
        return !this.disposed && this.attempt === attempt;
    }
    private release(id: string): void {
        // Session expiry is the server-side fallback if cancellation cannot be delivered.
        void this.transport.release(id).catch(() => {});
    }
    cancel(): void {
        const attempt = this.attempt;
        this.attempt = null;
        if (!attempt) return;
        clearTimeout(attempt.timer);
        attempt.controller.abort();
        if (attempt.id) this.release(attempt.id);
    }
    async start(query: TQuery): Promise<void> {
        if (this.disposed) return;
        this.cancel();
        const attempt: Attempt = { controller: new AbortController() };
        this.attempt = attempt;
        this.changed({ kind: "admitting" });
        try {
            const admitted = await this.transport.start(query);
            if (!this.owns(attempt)) {
                this.release(admitted.id);
                return;
            }
            attempt.id = admitted.id;
            await this.poll(attempt, admitted.id);
        } catch (error) {
            if (this.owns(attempt)) this.changed({ kind: "failed", error });
        }
    }
    private async poll(attempt: Attempt, id: string): Promise<void> {
        if (!this.owns(attempt)) return;
        try {
            const value = await this.transport.read(id, attempt.controller.signal);
            if (!this.owns(attempt)) return;
            this.changed({ kind: "results", value });
            if (value.state === "searching" && this.owns(attempt))
                attempt.timer = setTimeout(() => {
                    void this.poll(attempt, id);
                }, this.pollMs);
        } catch (error) {
            if (this.owns(attempt)) this.changed({ kind: "failed", error });
        }
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancel();
        this.changed({ kind: "disposed" });
    }
}
