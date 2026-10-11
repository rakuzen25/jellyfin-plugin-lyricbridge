/** Preference writes outlive playback and remain bound to their captured account. */
export class PreferenceSaveError extends Error {
    readonly details = { code: "preference_save_failed", retryable: true };
    readonly noticeKey: string;
    constructor(message: string, path: string) {
        super(message);
        this.noticeKey = "preferences:" + path;
    }
}
export interface PreferenceSave {
    readonly identity: string;
    readonly path: string;
    readonly request: Request;
    revision: number;
    running: boolean;
    body: Record<string, unknown>;
    timer?: ReturnType<typeof setTimeout>;
    error?: Error;
}

interface PreferenceQueueOptions {
    request: () => Request | null;
    fetch: typeof fetch;
    saved: (path: string) => void | Promise<void>;
    failed: (error: Error, retry: () => Promise<void>) => void;
    debounceMs?: number;
}

export function preferenceIdentity(request: Request | null): string {
    if (!request) return "";
    const url = new URL(request.url);
    return JSON.stringify([
        url.origin,
        url.pathname.replace(/\/Audio\/[^/]+\/Lyrics$/i, ""),
        request.headers.get("Authorization"),
        request.headers.get("X-Emby-Authorization"),
        request.headers.get("X-Emby-Token"),
        url.searchParams.get("api_key"),
    ]);
}

export class PreferenceQueue {
    readonly entries = new Map<string, PreferenceSave>();
    private readonly options: PreferenceQueueOptions;
    constructor(options: PreferenceQueueOptions) {
        this.options = options;
    }

    pending(path: string): PreferenceSave | undefined {
        return this.entries.get(preferenceIdentity(this.options.request()) + "|" + path);
    }

    discardOtherAccounts(): void {
        const identity = preferenceIdentity(this.options.request());
        for (const [key, entry] of this.entries) {
            if (entry.identity === identity) continue;
            clearTimeout(entry.timer);
            this.entries.delete(key);
        }
    }

    enqueue(path: string, body: Record<string, unknown>): PreferenceSave {
        const request = this.options.request();
        if (!request) throw new Error("Sign in before saving preferences.");
        const identity = preferenceIdentity(request),
            key = identity + "|" + path;
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { identity, path, request: request.clone(), revision: 0, running: false, body: {} };
            this.entries.set(key, entry);
        }
        entry.body = structuredClone(body);
        entry.revision++;
        entry.error = undefined;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            void this.flush(entry);
        }, this.options.debounceMs ?? 250);
        return entry;
    }

    async flush(entry: PreferenceSave | undefined): Promise<void> {
        if (!entry || entry.running) return;
        const key = entry.identity + "|" + entry.path;
        if (this.entries.get(key) !== entry) return;
        if (entry.identity !== preferenceIdentity(this.options.request())) {
            clearTimeout(entry.timer);
            this.entries.delete(key);
            return;
        }
        clearTimeout(entry.timer);
        entry.running = true;
        entry.error = undefined;
        const revision = entry.revision,
            body = entry.body;
        try {
            const root = new URL(entry.request.url.replace(/\/Audio\/[^/]+\/Lyrics(?:\?.*)?$/i, "/LyricBridge/"));
            const headers = new Headers(entry.request.headers);
            headers.set("Content-Type", "application/json");
            const response = await this.options.fetch(new URL(entry.path, root), {
                method: "PUT",
                headers,
                credentials: "same-origin",
                body: JSON.stringify(body),
            });
            if (!response.ok) throw new PreferenceSaveError(`Preferences could not be saved (${response.status}). Retry saving.`, entry.path);
            if (revision === entry.revision && this.entries.get(key) === entry) this.entries.delete(key);
        } catch (error) {
            entry.error =
                error instanceof PreferenceSaveError ? error : new PreferenceSaveError("Preferences could not be saved. Retry saving.", entry.path);
            if (this.entries.get(key) === entry && entry.identity === preferenceIdentity(this.options.request())) {
                this.options.failed(entry.error, () => this.flush(entry));
            }
        } finally {
            entry.running = false;
            if (revision !== entry.revision && this.entries.get(key) === entry) void this.flush(entry);
        }
        // UI refresh failures must not turn a successful write into a pending retry.
        if (!entry.error && !this.entries.has(key) && entry.identity === preferenceIdentity(this.options.request())) {
            try {
                await this.options.saved(entry.path);
            } catch {
                /* Playback refresh owns its error display. */
            }
        }
    }
}
