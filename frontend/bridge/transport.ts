/** One owner for Jellyfin's native lyric requests. Domain state stays in the bridge. */
export interface TransportScope {
    controller: AbortController;
    issued: number;
}

export interface TransportOptions<TScope extends TransportScope> {
    fetch: (request: Request, itemId: string) => Promise<Response>;
    begin: (request: Request, itemId: string) => TScope;
    transform: (data: unknown, scope: TScope, order: number, status: number) => unknown;
    error: (scope: TScope) => void;
}

interface Capture<TScope> {
    url: string;
    itemId: string;
    headers: Headers;
    scope?: TScope;
    order?: number;
    cleanup?: () => void;
}

export function installLyricTransport<TScope extends TransportScope>(options: TransportOptions<TScope>): () => void {
    const originalFetch = window.fetch;
    const interceptedFetch: typeof fetch = async (input, init) => {
        let request: Request;
        try {
            request = new Request(input, init);
        } catch {
            return originalFetch.call(window, input, init);
        }
        const itemId = new URL(request.url).pathname.match(/\/Audio\/([a-f0-9-]+)\/Lyrics$/i)?.[1];
        if (request.method !== "GET" || !itemId) return originalFetch.call(window, input, init);
        return options.fetch(request, itemId);
    };
    window.fetch = interceptedFetch;
    const proto = window.XMLHttpRequest?.prototype;
    if (!proto)
        return () => {
            if (window.fetch === interceptedFetch) window.fetch = originalFetch;
        };
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const originalSet = proto.setRequestHeader;
    const getText = Object.getOwnPropertyDescriptor(proto, "responseText")?.get;
    const getResponse = Object.getOwnPropertyDescriptor(proto, "response")?.get;
    if (!getText || !getResponse)
        return () => {
            if (window.fetch === interceptedFetch) window.fetch = originalFetch;
        };
    const captures = new WeakMap<XMLHttpRequest, Capture<TScope>>();
    const active = new Set<() => void>();
    // Keep the native overload's synchronous-request behavior and optional credentials.
    const interceptedOpen: typeof proto.open = function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        async: boolean = true,
        username?: string | null,
        password?: string | null,
    ) {
        const previous = captures.get(this);
        previous?.cleanup?.();
        if (previous) {
            for (const key of ["responseText", "response", "responseURL"]) Reflect.deleteProperty(this, key);
            captures.delete(this);
        }
        const absolute = new URL(url, location.href);
        const itemId = absolute.pathname.match(/\/Audio\/([a-f0-9-]+)\/Lyrics$/i)?.[1];
        if (method.toUpperCase() !== "GET" || !itemId) return originalOpen.call(this, method, url, async, username, password);
        const capture: Capture<TScope> = { url: absolute.href, itemId, headers: new Headers() };
        captures.set(this, capture);
        let cached = false;
        let textCache: string | undefined;
        let jsonCache: unknown;
        const transform = (raw: unknown): unknown => {
            if (this.readyState !== 4 || !capture.scope || capture.order === undefined) return raw;
            if (cached) return typeof raw === "string" ? textCache : jsonCache;
            try {
                const data: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
                jsonCache = options.transform(data, capture.scope, capture.order, this.status);
                textCache = JSON.stringify(jsonCache);
                cached = true;
                return typeof raw === "string" ? textCache : jsonCache;
            } catch {
                return raw;
            }
        };
        Object.defineProperty(this, "responseText", { configurable: true, get: () => transform(getText.call(this)) });
        Object.defineProperty(this, "response", { configurable: true, get: () => transform(getResponse.call(this)) });
        Object.defineProperty(this, "responseURL", { configurable: true, get: () => capture.url });
        absolute.pathname = absolute.pathname.replace(/\/Audio\/[^/]+\/Lyrics$/i, "/LyricBridge/items/" + itemId + "/lyrics");
        return originalOpen.call(this, method, absolute.href, async, username, password);
    };
    const interceptedSet: typeof proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
        originalSet.call(this, name, value);
        captures.get(this)?.headers.append(name, value);
    };
    const interceptedSend: typeof proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const capture = captures.get(this);
        if (capture) {
            capture.scope = options.begin(new Request(capture.url, { headers: capture.headers }), capture.itemId);
            capture.order = ++capture.scope.issued;
            const scope = capture.scope;
            const onAbort = () => {
                if (this.readyState !== 4) this.abort();
            };
            const onError = () => options.error(scope);
            const cleanup = () => {
                scope.controller.signal.removeEventListener("abort", onAbort);
                this.removeEventListener("error", onError);
                this.removeEventListener("loadend", cleanup);
                active.delete(cleanup);
                capture.cleanup = undefined;
            };
            capture.cleanup = cleanup;
            active.add(cleanup);
            scope.controller.signal.addEventListener("abort", onAbort, { once: true });
            this.addEventListener("error", onError, { once: true });
            this.addEventListener("loadend", cleanup, { once: true });
        }
        try {
            return originalSend.call(this, body);
        } catch (error) {
            capture?.cleanup?.();
            throw error;
        }
    };
    proto.open = interceptedOpen;
    proto.send = interceptedSend;
    proto.setRequestHeader = interceptedSet;
    return () => {
        for (const cleanup of active) cleanup();
        if (window.fetch === interceptedFetch) window.fetch = originalFetch;
        if (proto.open === interceptedOpen) proto.open = originalOpen;
        if (proto.send === interceptedSend) proto.send = originalSend;
        if (proto.setRequestHeader === interceptedSet) proto.setRequestHeader = originalSet;
    };
}
