import type { TransportScope } from "./transport.ts";
import { isRecord } from "../shared/invariants.ts";
export interface RequestIssue {
    code: string;
    message: string;
    location?: string | null;
}
export function parseRequestIssues(value: unknown): RequestIssue[] | null {
    if (!Array.isArray(value)) return null;
    const result: RequestIssue[] = [];
    for (const issue of value) {
        if (
            !isRecord(issue) ||
            typeof issue.code !== "string" ||
            typeof issue.message !== "string" ||
            (issue.location != null && typeof issue.location !== "string")
        )
            return null;
        result.push({ code: issue.code, message: issue.message, location: issue.location as string | null | undefined });
    }
    return result;
}
export interface RequestFailure {
    code: string;
    message: string;
    retryable?: boolean;
    diagnosticId?: string | null;
    retryAt?: string | null;
    issues?: RequestIssue[];
    issueCount?: number;
}
export class BridgeRequestError<TScope> extends Error {
    readonly details: RequestFailure;
    readonly scope: TScope | null;
    constructor(details: RequestFailure, scope: TScope | null) {
        super(details.message);
        this.details = details;
        this.scope = scope;
    }
}
interface ApiOptions<TScope extends TransportScope> {
    request: () => Request | null;
    scope: () => TScope | null;
    fetch: typeof fetch;
    responseOrder: symbol;
    received: () => void;
}
function failure(value: unknown): RequestFailure | null {
    if (!value || typeof value !== "object" || !("error" in value)) return null;
    const error = value.error;
    if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        !("message" in error) ||
        typeof error.code !== "string" ||
        typeof error.message !== "string"
    )
        return null;
    return {
        code: error.code,
        message: error.message,
        retryable: "retryable" in error && typeof error.retryable === "boolean" ? error.retryable : undefined,
        diagnosticId: "diagnosticId" in error && typeof error.diagnosticId === "string" ? error.diagnosticId : undefined,
        retryAt: "retryAt" in error && typeof error.retryAt === "string" ? error.retryAt : undefined,
        issues: "issues" in error ? (parseRequestIssues(error.issues) ?? undefined) : undefined,
        issueCount:
            "issueCount" in error && typeof error.issueCount === "number" && Number.isSafeInteger(error.issueCount) && error.issueCount >= 0
                ? error.issueCount
                : undefined,
    };
}
/** Captures authentication and cancellation at admission; preserves Jellyfin base URLs. */
export function createApi<TScope extends TransportScope>(options: ApiOptions<TScope>) {
    return async function api(
        path: string,
        method = "GET",
        body?: unknown,
        signal: AbortSignal | null | undefined = options.scope()?.controller.signal,
    ): Promise<unknown> {
        const scope = options.scope();
        const order = /^items\/[^/]+\/(lyrics|discovery|retry)$/.test(path) && scope ? ++scope.issued : undefined;
        const request = options.request(),
            headers = new Headers(request?.headers);
        if (body !== undefined) headers.set("Content-Type", "application/json");
        const root = request
            ? new URL(request.url.replace(/\/Audio\/[^/]+\/Lyrics(?:\?.*)?$/i, "/LyricBridge/"))
            : new URL("/LyricBridge/", location.origin);
        const response = await options.fetch(new URL(path, root), {
            method,
            headers,
            credentials: "same-origin",
            signal,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        options.received();
        if (!response.ok) {
            let data: unknown;
            try {
                data = await response.json();
            } catch {}
            const details = failure(data) ?? {
                code: response.status === 401 ? "sign_in_required" : response.status === 403 ? "permission_denied" : "request_failed",
                message:
                    response.status === 401
                        ? "Your session expired. Sign in again."
                        : response.status === 403
                          ? "This action is not permitted for your account."
                          : [502, 503, 504].includes(response.status)
                            ? "Jellyfin could not complete the lyric request right now. Your existing lyrics were retained; try again shortly."
                            : `The lyric action failed (${response.status}).`,
                retryable: response.status >= 500,
            };
            throw new BridgeRequestError(details, scope);
        }
        const data: unknown = response.status === 204 ? null : await response.json();
        if (data && typeof data === "object" && order !== undefined) Object.defineProperty(data, options.responseOrder, { value: order });
        return data;
    };
}
