import { isRecord } from "../../shared/invariants.ts";
export interface ServiceOptionInfo {
    id: string;
    name: string;
    capability: string;
    provider: string;
    model: string;
    status: "Ready" | "Disabled" | "Needs setup";
    maxInputMb: number;
    maxUploadMb: number;
}
export function parseServiceOptions(value: unknown): ServiceOptionInfo[] {
    if (
        !Array.isArray(value) ||
        !value.every(
            (o: unknown): o is ServiceOptionInfo =>
                isRecord(o) &&
                typeof o.id === "string" &&
                !!o.id &&
                typeof o.name === "string" &&
                typeof o.capability === "string" &&
                typeof o.provider === "string" &&
                typeof o.model === "string" &&
                ["Ready", "Disabled", "Needs setup"].includes(String(o.status)) &&
                typeof o.maxInputMb === "number" &&
                Number.isFinite(o.maxInputMb) &&
                o.maxInputMb > 0 &&
                typeof o.maxUploadMb === "number" &&
                Number.isFinite(o.maxUploadMb) &&
                o.maxUploadMb > 0,
        )
    )
        throw new Error("Invalid service options. Reload settings and retry.");
    if (new Set(value.map((o) => o.id)).size !== value.length) throw new Error("Duplicate service options. Reload settings and retry.");
    return value;
}
