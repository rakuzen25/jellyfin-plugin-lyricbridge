import type { RequestFailure } from "../../contracts/errors.ts";
import type { GenerationJob } from "../../contracts/generation.ts";
import type { AuxiliaryKind } from "../../contracts/preferences.ts";

export interface TrackScope {
    id: number;
    itemId: string;
    controller: AbortController;
    issued: number;
    accepted: number;
    timer?: number;
    loadingTimer?: number;
    overrideTimer?: number;
    loadingStarted?: number;
    overrideDirty?: boolean;
    overrideRevision?: number;
    dismissedLocalError?: string | null;
    dismissedUpgrade?: string;
    dismissedNotices?: Set<string>;
    dismissedJobs?: Set<string>;
    jobsRestored?: boolean;
    jobs?: Map<string, GenerationJob>;
    jobActions?: Map<string, { retry: () => Promise<void>; cancel: () => Promise<void> }>;
    versionBrowsing?: Partial<Record<AuxiliaryKind | "original", string | null>>;
    reusableVersionRows?: Map<string, HTMLElement>;
}

export interface DisplayFailure {
    name?: string;
    message?: string | null;
    scope?: TrackScope | null;
    noticeKey?: string;
    persistent?: boolean;
    details?: Partial<RequestFailure> | null;
    providerErrors?: RequestFailure[];
}
