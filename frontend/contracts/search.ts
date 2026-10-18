export interface MatchAssessment {
    score: number;
    tier: number;
    eligible: boolean;
    reasons: string[];
    fields: { field: string; result: string; points?: number | null }[];
    recording: string;
    candidateRecording: string;
    durationDifferenceMs?: number | null;
    providerOrder: number;
    timing?: { category: string; rank: number; coverage: number; sungLines: number; wordLines: number; invalidCues: number } | null;
    auxiliary?: { translationCoverage: number; pronunciationCoverage: number; completeness: number } | null;
}
