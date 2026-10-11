import type { RichLyrics } from "../shared/lyrics.ts";
export interface Preferences {
    translationLanguage: string;
    sourceLanguage: string;
    showTranslation: boolean;
    showPronunciation: boolean;
    japaneseRomaji: boolean;
    originalChineseScript: string;
    romanizationSystem: string;
    rowOrder: string;
    originalSize: number;
    pronunciationSize: number;
    translationSize: number;
    rowSpacing: number;
}
export type AuxiliaryKind = "translation" | "pronunciation";
interface GenerationProfile {
    service: string;
    endpointIdentity: string;
    model: string;
    kind: AuxiliaryKind;
    language: string;
    sourceLanguage: string;
    reasoningEffort: string;
    contextBefore: number;
    contextAfter: number;
    promptRevision: number;
}
export interface Variant {
    key: string;
    hash: string;
    kind: AuxiliaryKind;
    language: string;
    service: string;
    model: string;
    text: Record<string, string>;
    contextBefore: number;
    contextAfter: number;
    reasoningEffort: string;
    promptVersion: number;
    cacheKey?: string | null;
    createdAt?: string | null;
    origin?: { source: string; providerId: string; donorHash?: string | null } | null;
    skippedRows?: Record<string, string> | null;
    profile?: GenerationProfile | null;
    originType: "generated" | "supplied" | "local";
}
export interface AuxiliaryDocument {
    lyrics?: RichLyrics | null;
    variants?: Variant[];
    auxiliaryChoices?: { translation: string; pronunciation: string };
}
