import type { RequestFailure } from "../../contracts/errors.ts";
import type { MatchAssessment } from "../../contracts/search.ts";
import { isRecord as record } from "../../shared/invariants.ts";

export interface Candidate {
    source: string;
    id: string;
    title: string;
    artist: string;
    score: number;
    album?: string;
    durationMs?: number | null;
    verification?: string;
    wordTiming?: boolean | null;
    translationLanguages?: string[] | null;
    hasPronunciation?: boolean | null;
    assessment?: MatchAssessment | null;
}
export interface SearchQuery {
    title: string;
    artist: string;
    source: string | null;
}
export interface SearchImprovement {
    key: string;
    hash: string;
    baselineHash: string;
    reason: string;
    description: string;
}
export interface SearchResults {
    state: string;
    finished: number;
    total: number;
    candidates: Candidate[];
    recommended?: string | null;
    improvement?: SearchImprovement | null;
    errors: RequestFailure[];
}
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
export function isMatchAssessment(value: unknown): value is MatchAssessment {
    if (!record(value)) return false;
    const timing = value.timing,
        auxiliary = value.auxiliary;
    return (
        numeric(value.score) &&
        numeric(value.tier) &&
        typeof value.eligible === "boolean" &&
        strings(value.reasons) &&
        Array.isArray(value.fields) &&
        value.fields.every(
            (field: unknown) =>
                record(field) &&
                typeof field.field === "string" &&
                typeof field.result === "string" &&
                (field.points == null || numeric(field.points)),
        ) &&
        typeof value.recording === "string" &&
        typeof value.candidateRecording === "string" &&
        (value.durationDifferenceMs == null || numeric(value.durationDifferenceMs)) &&
        numeric(value.providerOrder) &&
        (timing == null ||
            (record(timing) &&
                typeof timing.category === "string" &&
                ["rank", "coverage", "sungLines", "wordLines", "invalidCues"].every((key) => numeric(timing[key])))) &&
        (auxiliary == null ||
            (record(auxiliary) && ["translationCoverage", "pronunciationCoverage", "completeness"].every((key) => numeric(auxiliary[key]))))
    );
}
function candidate(value: unknown): value is Candidate {
    return (
        record(value) &&
        typeof value.source === "string" &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.artist === "string" &&
        numeric(value.score) &&
        (value.album === undefined || typeof value.album === "string") &&
        (value.durationMs == null || numeric(value.durationMs)) &&
        (value.verification === undefined || typeof value.verification === "string") &&
        (value.wordTiming == null || typeof value.wordTiming === "boolean") &&
        (value.hasPronunciation == null || typeof value.hasPronunciation === "boolean") &&
        (value.translationLanguages == null || strings(value.translationLanguages)) &&
        (value.assessment == null || isMatchAssessment(value.assessment))
    );
}
function requestFailure(value: unknown): value is RequestFailure {
    return (
        record(value) &&
        typeof value.code === "string" &&
        typeof value.message === "string" &&
        (value.retryable === undefined || typeof value.retryable === "boolean") &&
        (value.diagnosticId == null || typeof value.diagnosticId === "string") &&
        (value.retryAt == null || typeof value.retryAt === "string")
    );
}
export function parseSearchAdmission(value: unknown): { id: string } {
    if (!record(value) || typeof value.id !== "string" || !value.id.trim())
        throw new Error("Jellyfin returned an invalid search session. Retry the search.");
    return { id: value.id };
}
function searchImprovement(value: unknown): value is SearchImprovement {
    return (
        record(value) &&
        typeof value.key === "string" &&
        typeof value.hash === "string" &&
        typeof value.baselineHash === "string" &&
        typeof value.reason === "string" &&
        typeof value.description === "string"
    );
}
export function parseSearchResults(value: unknown): SearchResults {
    if (
        !record(value) ||
        typeof value.state !== "string" ||
        !numeric(value.finished) ||
        !numeric(value.total) ||
        !Array.isArray(value.candidates) ||
        !value.candidates.every(candidate) ||
        !Array.isArray(value.errors) ||
        !value.errors.every(requestFailure) ||
        !(value.recommended == null || typeof value.recommended === "string") ||
        !(value.improvement == null || searchImprovement(value.improvement))
    )
        throw new Error("Jellyfin returned invalid search results. Retry the search.");
    return {
        state: value.state,
        finished: value.finished,
        total: value.total,
        candidates: value.candidates,
        errors: value.errors,
        recommended: value.recommended,
        improvement: value.improvement,
    };
}
/** Shared search ordering used by the UI without changing provider ranking policy. */
export function rankCandidates(a: Candidate, b: Candidate): number {
    const x = a.assessment,
        y = b.assessment;
    const aKey = a.source + ":" + a.id,
        bKey = b.source + ":" + b.id;
    return (
        Number(!!y?.eligible) - Number(!!x?.eligible) ||
        (y?.tier || 0) - (x?.tier || 0) ||
        (y?.timing?.rank ?? -1) - (x?.timing?.rank ?? -1) ||
        (y?.timing?.coverage || 0) - (x?.timing?.coverage || 0) ||
        (y?.score ?? b.score) - (x?.score ?? a.score) ||
        (y?.auxiliary?.completeness || 0) - (x?.auxiliary?.completeness || 0) ||
        (x?.providerOrder || 0) - (y?.providerOrder || 0) ||
        (aKey < bKey ? -1 : aKey > bKey ? 1 : 0)
    );
}
