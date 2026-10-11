/** Checked access to an invariant established by the owning workflow. */
export function requireValue<T>(value: T | null | undefined, context = "Required application state is unavailable"): T {
    if (value === null || value === undefined) throw new Error(context);
    return value;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
