import type { Configuration } from "./contracts.ts";
import { rebaseSettings, same } from "./settings-draft.ts";

export interface SettingsSnapshot {
    configuration: Configuration;
    revision: string;
}
export type SettingsRequest = <T>(path: string, method?: string, data?: unknown) => Promise<T>;

/** Owns server baselines and draft transactions independently of the settings DOM. */
export class SettingsController {
    private draft: Configuration | undefined;
    private baseline: Configuration | undefined;
    private revision = "";
    private edits = 0;
    private request = 0;
    private disposed = false;
    private pendingSave = false;
    private latest: SettingsSnapshot | undefined;
    private readonly call: SettingsRequest;
    constructor(call: SettingsRequest) {
        this.call = call;
    }

    snapshot() {
        return Object.freeze({
            configuration: this.draft && structuredClone(this.draft),
            baseline: this.baseline && structuredClone(this.baseline),
            revision: this.revision,
            dirty: this.draft !== undefined && !same(this.draft, this.baseline),
            saving: this.pendingSave,
        });
    }
    replaceDraft(configuration: Configuration) {
        if (this.disposed) return;
        this.draft = structuredClone(configuration);
        this.edits++;
    }
    accept(snapshot: SettingsSnapshot) {
        if (this.disposed) return;
        this.request++;
        this.draft = structuredClone(snapshot.configuration);
        this.baseline = structuredClone(snapshot.configuration);
        this.revision = snapshot.revision;
        this.latest = undefined;
        this.edits++;
    }
    async load() {
        if (this.disposed) return false;
        const request = ++this.request,
            edits = this.edits;
        const snapshot = await this.call<SettingsSnapshot>("admin/settings");
        if (this.disposed || request !== this.request || edits !== this.edits) return false;
        this.accept(snapshot);
        return true;
    }
    async compare() {
        if (this.disposed) return undefined;
        const request = ++this.request;
        const latest = await this.call<SettingsSnapshot>("admin/settings");
        if (this.disposed || request !== this.request) return undefined;
        this.latest = structuredClone(latest);
        return this.comparison();
    }
    comparison(choices = new Map<string, "local" | "latest">()) {
        if (this.disposed || !this.baseline || !this.draft || !this.latest) return undefined;
        return {
            ...rebaseSettings(this.baseline, this.draft, this.latest.configuration, choices),
            latest: structuredClone(this.latest.configuration),
        };
    }
    rebase(choices: Map<string, "local" | "latest">) {
        const result = this.comparison(choices);
        if (!result || result.conflicts.length || !this.latest) return false;
        this.draft = structuredClone(result.configuration);
        this.baseline = structuredClone(this.latest.configuration);
        this.revision = this.latest.revision;
        this.latest = undefined;
        this.edits++;
        return true;
    }
    async save() {
        if (this.disposed || this.pendingSave || !this.draft) return false;
        const request = ++this.request;
        this.pendingSave = true;
        const edits = this.edits,
            snapshot = structuredClone(this.draft),
            payload = structuredClone(snapshot);
        const credentials = [
            ...payload.Sources.map((value) => ({
                kind: "source",
                id: value.Name,
                action: value.CredentialAction || "keep",
                value: value.Credential,
            })),
            ...payload.ServiceSetup.Connections.map((value) => ({
                kind: "connection",
                id: value.Id,
                action: value.CredentialAction || "keep",
                value: value.ApiKey,
            })),
        ].filter((value) => value.action !== "keep");
        for (const value of payload.Sources) value.Credential = "";
        for (const value of payload.ServiceSetup.Connections) value.ApiKey = "";
        try {
            const saved = await this.call<SettingsSnapshot>("admin/settings", "PUT", {
                configuration: payload,
                revision: this.revision,
                credentials,
            });
            if (this.disposed || request !== this.request) return false;
            this.revision = saved.revision;
            this.draft =
                edits === this.edits
                    ? structuredClone(saved.configuration)
                    : rebaseSettings(snapshot, this.draft!, saved.configuration).configuration;
            this.baseline = structuredClone(saved.configuration);
            return edits === this.edits;
        } finally {
            this.pendingSave = false;
        }
    }
    dispose() {
        this.disposed = true;
        this.request++;
    }
}
