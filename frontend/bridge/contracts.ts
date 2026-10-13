import type { RichLyrics } from "../shared/lyrics.ts";
import type { RequestFailure } from "./api.ts";
import type { GenerationJob } from "./generation-state.ts";
import type { AuxiliaryKind, Preferences, Variant } from "./models.ts";
import type { MatchAssessment } from "./search-models.ts";
interface SavedOriginal {
    itemId: string;
    hash: string;
    source: string;
    providerId: string;
    title: string;
    artist: string;
    wordTimed: boolean;
    savedAt: string;
    revision: number;
}
export interface BridgeDocument {
    savedOriginals?: SavedOriginal[];
    canDeleteOriginals?: boolean;
    itemId?: string;
    lyrics?: RichLyrics | null;
    variants?: Variant[];
    preferences: Preferences;
    accountPreferences?: Preferences;
    songOverrides?: { sourceLanguage?: string | null; translationLanguage?: string | null };
    auxiliaryChoices?: { translation: string; pronunciation: string };
    track?: { title: string; artist: string; album: string; durationMs?: number | null } | null;
    state?: string;
    complete?: boolean;
    finished?: number;
    total?: number;
    errors?: RequestFailure[];
    instrumental?: { source: string; reason: string; manual?: boolean }[];
    detectedLanguages?: string[];
    canSelect?: boolean;
    canDeleteVariants?: boolean;
    canGenerate?: boolean;
    pronunciation?: { state: string; error?: string | null } | null;
    timingFingerprint?: string | null;
    timingCorrection?: { seconds: number; hash: string; fingerprint: string } | null;
    better?: RichLyrics | null;
    improvement?: { baselineHash: string; description?: string; reason?: string; assessment?: MatchAssessment | null } | null;
    matchAssessment?: MatchAssessment | null;
    suggestedMapping?: Record<string, string> | null;
    suggestedOriginHash?: string | null;
}
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
export interface ServiceCapability {
    service: string;
    translation: boolean;
    pronunciation: boolean;
    languages: string[];
}
export interface SourceCapability {
    name: string;
    enabled: boolean;
    configured: boolean;
    requiresCredential?: boolean;
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
