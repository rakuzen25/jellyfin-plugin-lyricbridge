import type { RequestFailure, RequestIssue } from "../../contracts/errors.ts";
import { isRecord } from "../../shared/invariants.ts";
import type { TransportScope } from "./transport.ts";
export class AudioUploadBody {
    readonly file: Blob;
    readonly progress: (loaded: number, total: number) => void;
    constructor(file: Blob, progress: (loaded: number, total: number) => void) {
        this.file = file;
        this.progress = progress;
    }
}
function upload(url: URL, headers: Headers, body: AudioUploadBody, signal: AbortSignal | null | undefined): Promise<Response> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const finish = () => signal?.removeEventListener("abort", abort);
        if (signal?.aborted) {
            reject(new DOMException("Upload cancelled", "AbortError"));
            return;
        }
        xhr.open("POST", url);
        xhr.withCredentials = true;
        headers.forEach((value, name) => {
            if (name.toLowerCase() !== "content-type") xhr.setRequestHeader(name, value);
        });
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (event) => body.progress(event.loaded, event.lengthComputable ? event.total : body.file.size);
        xhr.onload = () => {
            finish();
            resolve(new Response(xhr.responseText || null, { status: xhr.status, headers: { "Content-Type": "application/json" } }));
        };
        xhr.onerror = () => {
            finish();
            reject(new Error("Audio upload failed. Check the connection and retry."));
        };
        xhr.onabort = () => {
            finish();
            reject(new DOMException("Upload cancelled", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        xhr.send(body.file);
    });
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

export class BridgeRequestError<TScope> extends Error {
    readonly details: RequestFailure;
    readonly scope: TScope | null;
    readonly status?: number;
    constructor(details: RequestFailure, scope: TScope | null, status?: number) {
        super(details.message);
        this.details = details;
        this.scope = scope;
        this.status = status;
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
        if (body !== undefined && !(body instanceof AudioUploadBody)) headers.set("Content-Type", "application/json");
        const root = request
            ? new URL(request.url.replace(/\/Audio\/[^/]+\/Lyrics(?:\?.*)?$/i, "/LyricBridge/"))
            : new URL("/LyricBridge/", location.origin);
        const response =
            body instanceof AudioUploadBody
                ? await upload(new URL(path, root), headers, body, signal)
                : await options.fetch(new URL(path, root), {
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
            throw new BridgeRequestError(details, scope, response.status);
        }
        if (/^items\/[^/]+\/export$/.test(path)) return response.blob();
        const data: unknown = response.status === 204 ? null : await response.json();
        if (data && typeof data === "object" && order !== undefined) Object.defineProperty(data, options.responseOrder, { value: order });
        return data;
    };
}
