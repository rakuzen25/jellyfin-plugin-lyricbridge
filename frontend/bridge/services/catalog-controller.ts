import type {} from "../../platform/globals.ts";
import type { BridgeDocument, ServiceCapability, SourceCapability } from "../../contracts/bridge.ts";
import type { Preferences } from "../../contracts/preferences.ts";
import type {} from "../../platform/globals.ts";
import { type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { TrackScope } from "../session/contracts.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import type { BridgeApi } from "../transport/ports.ts";
import { parseDocument, parseServices, parseSources } from "../transport/responses.ts";

interface Dependencies {
    trackSession: TrackSessionPort;
    api: BridgeApi;
    defaults: Preferences;
    accept: (data: BridgeDocument, target: TrackScope, renderNow?: boolean, order?: number | undefined) => void;
    showError: (
        cause: unknown,
        parent?: HTMLElement | null | undefined,
        retryAction?: () => unknown,
        context?: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string },
    ) => void;
    tools: HTMLElement | null;
    refreshSong: (force?: boolean) => Promise<void>;
    status: (message: string, error?: boolean, ttl?: number, operation?: string) => void;
}

/** Owns catalog controller behavior and its installation lifetime. */
export function createCatalogController(deps: Dependencies) {
    let services: ServiceCapability[] = [];

    let sources: SourceCapability[] = [];

    async function retry() {
        try {
            const target = deps.trackSession.scope;
            const data = parseDocument(await deps.api("items/" + requireValue(target).itemId + "/retry", "POST"), deps.defaults);
            deps.accept(data, requireValue(target), true);
        } catch (error) {
            deps.showError(error, deps.tools, retry, { operation: "retrieval" });
        }
    }

    async function capabilities() {
        const target = deps.trackSession.scope;
        if (!target) return;
        const [nextServices, nextSources] = await Promise.all([
            services.length ? services : deps.api("services"),
            sources.length ? sources : deps.api("sources"),
        ]);
        if (deps.trackSession.scope !== target) return;
        services = parseServices(nextServices);
        sources = parseSources(nextSources);
    }

    async function action(name: string) {
        const target = deps.trackSession.scope;
        try {
            await deps.api("items/" + requireValue(target).itemId + "/" + name, "POST");
            if (deps.trackSession.scope === target) {
                await deps.refreshSong(true);
                if (deps.trackSession.scope === target && name === "reject-matches")
                    deps.status("Lyrics removed", false, 4000, "action:remove-lyrics");
            }
        } catch (error) {
            if (deps.trackSession.scope === target) throw error;
            throw new DOMException("The song changed", "AbortError");
        }
    }

    async function mark(clear: boolean) {
        const target = deps.trackSession.scope;
        try {
            await deps.api("items/" + requireValue(target).itemId + "/instrumental", "POST", { clear });
            if (deps.trackSession.scope === target) await deps.refreshSong(true);
        } catch (error) {
            if (deps.trackSession.scope === target) throw error;
            throw new DOMException("The song changed", "AbortError");
        }
    }
    return {
        retry,
        capabilities,
        action,
        mark,
        get services(): ServiceCapability[] {
            return services;
        },
        replaceServices(value: ServiceCapability[]) {
            services = value;
        },
        get sources(): SourceCapability[] {
            return sources;
        },
        replaceSources(value: SourceCapability[]) {
            sources = value;
        },
    };
}
