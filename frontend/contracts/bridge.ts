import type { RequestFailure } from "./errors.ts";
import type { RichLyrics } from "./lyrics.ts";
import type { AuxiliaryDocument, Preferences, Variant } from "./preferences.ts";
import type { MatchAssessment } from "./search.ts";
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
    autoSaved?: boolean;
}

export interface BridgeDocument {
    resolvedAuxiliary?: AuxiliaryDocument["resolvedAuxiliary"];
    savedOriginals?: SavedOriginal[];
    canDeleteOriginals?: boolean;
    itemId?: string;
    lyrics?: RichLyrics | null;
    variants?: Variant[];
    preferences: Preferences;
    accountPreferences?: Preferences;
    songOverrides?: { sourceLanguage?: string | null; translationLanguage?: string | null; originalChineseScript?: string | null };
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

export interface ServiceCapability {
    optionId: string;
    name: string;
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
