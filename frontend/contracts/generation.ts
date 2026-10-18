import type { RequestFailure } from "./errors.ts";
export interface GenerationJob {
    id: string;
    taskKind?: string;
    stage?: string;
    resultId?: string | null;
    reviewRequestCount?: number;
    chunkCount?: number;
    allowChunking?: boolean;
    hash?: string;
    state: string;
    progress: number;
    outputDeleted?: boolean;
    outputDeletedAt?: string | null;
    request: { optionName?: string; optionId?: string; service: string; kind: string; language?: string };
    error?: string | null;
    failure?: RequestFailure | null;
}
