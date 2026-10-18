/** Authenticated requests are admitted against the caller's captured scope. */
export type BridgeApi = (path: string, method?: string, body?: unknown, signal?: AbortSignal | null) => Promise<unknown>;
