import type { BridgeDocument, ServiceCapability, SourceCapability } from "../../contracts/bridge.ts";
import { type RequestFailure } from "../../contracts/errors.ts";
import type { Cue, LyricLine, RichLyrics } from "../../contracts/lyrics.ts";
import type { Preferences, Variant } from "../../contracts/preferences.ts";
import { isRecord } from "../../shared/invariants.ts";
import { effectiveAuxiliaryChoice } from "../lyrics/auxiliary.ts";
import { isMatchAssessment } from "../search/search-models.ts";
import type { DisplayFailure, TrackScope } from "../session/contracts.ts";
import { parseRequestIssues } from "./api.ts";
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const stringMap = (v: unknown): v is Record<string, string> => isRecord(v) && Object.values(v).every((x) => typeof x === "string");
function cue(v: unknown): v is Cue {
    return isRecord(v) && number(v.position) && number(v.endPosition) && number(v.start) && (v.end == null || number(v.end));
}
function line(v: unknown): v is LyricLine {
    return (
        isRecord(v) &&
        typeof v.id === "string" &&
        typeof v.text === "string" &&
        (v.start == null || number(v.start)) &&
        (v.end == null || number(v.end)) &&
        (v.language === undefined || typeof v.language === "string") &&
        (v.pronunciation == null || typeof v.pronunciation === "string") &&
        (v.translations === undefined || stringMap(v.translations)) &&
        (v.cues === undefined || (Array.isArray(v.cues) && v.cues.every(cue))) &&
        (v.background == null || line(v.background))
    );
}
function lyrics(v: unknown): v is RichLyrics {
    return (
        isRecord(v) &&
        typeof v.hash === "string" &&
        Array.isArray(v.lines) &&
        v.lines.every(line) &&
        ["source", "providerId", "language", "title", "artist"].every((k) => v[k] === undefined || typeof v[k] === "string") &&
        ["wordTimed", "manual"].every((k) => v[k] === undefined || typeof v[k] === "boolean")
    );
}
function variant(v: unknown): v is Variant {
    if (!isRecord(v)) return false;
    const profile = v.profile;
    return (
        isRecord(v) &&
        ["key", "hash", "language", "service", "model"].every((k) => typeof v[k] === "string") &&
        (v.kind === "translation" || v.kind === "pronunciation") &&
        stringMap(v.text) &&
        ["contextBefore", "contextAfter", "promptVersion"].every((k) => number(v[k])) &&
        typeof v.reasoningEffort === "string" &&
        (v.originType === "generated" || v.originType === "supplied" || v.originType === "local") &&
        (v.skippedRows == null || stringMap(v.skippedRows)) &&
        (v.createdAt == null || typeof v.createdAt === "string") &&
        (v.cacheKey == null || typeof v.cacheKey === "string") &&
        (v.origin == null ||
            (isRecord(v.origin) &&
                typeof v.origin.source === "string" &&
                typeof v.origin.providerId === "string" &&
                (v.origin.donorHash == null || typeof v.origin.donorHash === "string"))) &&
        (profile == null ||
            (isRecord(profile) &&
                ["service", "endpointIdentity", "model", "language", "sourceLanguage", "reasoningEffort"].every(
                    (k) => typeof profile[k] === "string",
                ) &&
                (profile.kind === "translation" || profile.kind === "pronunciation") &&
                ["contextBefore", "contextAfter", "promptRevision"].every((k) => number(profile[k]))))
    );
}
function failure(v: unknown): v is RequestFailure {
    return (
        isRecord(v) &&
        typeof v.code === "string" &&
        typeof v.message === "string" &&
        (v.retryable === undefined || typeof v.retryable === "boolean") &&
        (v.diagnosticId == null || typeof v.diagnosticId === "string") &&
        (v.retryAt == null || typeof v.retryAt === "string") &&
        (v.issues == null || parseRequestIssues(v.issues) !== null) &&
        (v.issueCount == null || (number(v.issueCount) && Number.isSafeInteger(v.issueCount) && v.issueCount >= 0))
    );
}
function parsePreferences(v: unknown, defaults: Preferences): Preferences {
    if (v === undefined) return { ...defaults };
    if (!isRecord(v)) throw new Error("Jellyfin returned invalid lyric preferences. Reload the settings.");
    const result = { ...defaults };
    for (const k of ["translationLanguage", "sourceLanguage", "originalChineseScript", "romanizationSystem", "rowOrder"] as const) {
        if (v[k] !== undefined) {
            if (typeof v[k] !== "string") throw new Error("Invalid lyric preference: " + k);
            result[k] = v[k];
        }
    }
    for (const k of ["showTranslation", "showPronunciation", "japaneseRomaji"] as const) {
        if (v[k] !== undefined) {
            if (typeof v[k] !== "boolean") throw new Error("Invalid lyric preference: " + k);
            result[k] = v[k];
        }
    }
    for (const k of ["originalSize", "pronunciationSize", "translationSize", "rowSpacing"] as const) {
        if (v[k] !== undefined) {
            if (!number(v[k])) throw new Error("Invalid lyric preference: " + k);
            result[k] = v[k];
        }
    }
    return result;
}
function resolvedRows(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (
        !isRecord(value) ||
        !["translationLanguage", "sourceLanguage", "originalChineseScript"].every((key) => typeof value[key] === "string") ||
        !isRecord(value.choices) ||
        typeof value.choices.translation !== "string" ||
        typeof value.choices.pronunciation !== "string"
    )
        return false;
    return ["translation", "pronunciation"].every((kind) => {
        const rows = value[kind];
        return isRecord(rows) && Object.values(rows).every((row) => isRecord(row) && typeof row.text === "string" && typeof row.key === "string");
    });
}
function document(v: unknown): v is BridgeDocument {
    if (!isRecord(v)) return false;
    if (!resolvedRows(v.resolvedAuxiliary)) return false;
    const songOverrides = v.songOverrides,
        track = v.track,
        improvement = v.improvement;
    return (
        (v.lyrics == null || lyrics(v.lyrics)) &&
        (v.better == null || lyrics(v.better)) &&
        (v.variants === undefined || (Array.isArray(v.variants) && v.variants.every(variant))) &&
        ["itemId", "state", "timingFingerprint", "suggestedOriginHash"].every((k) => v[k] == null || typeof v[k] === "string") &&
        ["complete", "canSelect", "canDeleteVariants", "canDeleteOriginals", "canGenerate"].every(
            (k) => v[k] === undefined || typeof v[k] === "boolean",
        ) &&
        ["finished", "total"].every((k) => v[k] === undefined || number(v[k])) &&
        (v.savedOriginals === undefined ||
            (Array.isArray(v.savedOriginals) &&
                v.savedOriginals.every(
                    (x) =>
                        isRecord(x) &&
                        ["itemId", "hash", "source", "providerId", "title", "artist", "savedAt"].every((k) => typeof x[k] === "string") &&
                        typeof x.wordTimed === "boolean" &&
                        (x.autoSaved === undefined || typeof x.autoSaved === "boolean") &&
                        number(x.revision),
                ))) &&
        (v.detectedLanguages === undefined || strings(v.detectedLanguages)) &&
        (songOverrides === undefined ||
            (isRecord(songOverrides) &&
                ["sourceLanguage", "translationLanguage", "originalChineseScript"].every(
                    (k) => songOverrides[k] == null || typeof songOverrides[k] === "string",
                ))) &&
        (v.auxiliaryChoices === undefined ||
            (isRecord(v.auxiliaryChoices) &&
                typeof v.auxiliaryChoices.translation === "string" &&
                typeof v.auxiliaryChoices.pronunciation === "string")) &&
        (track == null ||
            (isRecord(track) &&
                ["title", "artist", "album"].every((k) => typeof track[k] === "string") &&
                (track.durationMs == null || number(track.durationMs)))) &&
        (v.pronunciation == null ||
            (isRecord(v.pronunciation) &&
                typeof v.pronunciation.state === "string" &&
                (v.pronunciation.error == null || typeof v.pronunciation.error === "string"))) &&
        (v.timingCorrection == null ||
            (isRecord(v.timingCorrection) &&
                number(v.timingCorrection.seconds) &&
                typeof v.timingCorrection.hash === "string" &&
                typeof v.timingCorrection.fingerprint === "string")) &&
        (improvement == null ||
            (isRecord(improvement) &&
                typeof improvement.baselineHash === "string" &&
                ["description", "reason"].every((k) => improvement[k] === undefined || typeof improvement[k] === "string") &&
                (improvement.assessment == null || isMatchAssessment(improvement.assessment)))) &&
        (v.matchAssessment == null || isMatchAssessment(v.matchAssessment)) &&
        (v.suggestedMapping == null || stringMap(v.suggestedMapping)) &&
        (v.errors === undefined || (Array.isArray(v.errors) && v.errors.every(failure))) &&
        (v.instrumental === undefined ||
            (Array.isArray(v.instrumental) &&
                v.instrumental.every(
                    (x) =>
                        isRecord(x) &&
                        typeof x.source === "string" &&
                        typeof x.reason === "string" &&
                        (x.manual === undefined || typeof x.manual === "boolean"),
                )))
    );
}
export function parseDocument(value: unknown, defaults: Preferences): BridgeDocument {
    if (!isRecord(value) || !isRecord(value.preferences) || !isRecord(value.accountPreferences) || !isRecord(value.songOverrides))
        throw new Error("Jellyfin returned an invalid lyric response. Retry retrieval.");
    const normalized = {
        ...value,
        preferences: parsePreferences(value.preferences, defaults),
        accountPreferences: parsePreferences(value.accountPreferences, defaults),
    };
    if (!document(normalized)) throw new Error("Jellyfin returned malformed lyric data. Existing lyrics were retained; retry retrieval.");
    const validated: BridgeDocument = normalized;
    validated.auxiliaryChoices = {
        translation: effectiveAuxiliaryChoice(validated, "translation", validated.preferences),
        pronunciation: effectiveAuxiliaryChoice(validated, "pronunciation", validated.preferences),
    };
    for (const key of Object.getOwnPropertySymbols(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor) Object.defineProperty(normalized, key, descriptor);
    }
    if (validated.lyrics) {
        const identities = new Set<string>();
        for (const row of validated.lyrics.lines) {
            for (const line of row.background ? [row, row.background] : [row]) {
                if (!line.id || identities.has(line.id))
                    throw new Error("Jellyfin returned duplicate lyric line identities. Existing lyrics were retained.");
                identities.add(line.id);
            }
        }
    }
    return validated;
}
export function parseServices(value: unknown): ServiceCapability[] {
    if (
        !Array.isArray(value) ||
        !value.every(
            (v: unknown): v is ServiceCapability =>
                isRecord(v) &&
                typeof v.service === "string" &&
                typeof v.optionId === "string" &&
                v.optionId.length > 0 &&
                typeof v.name === "string" &&
                typeof v.translation === "boolean" &&
                typeof v.pronunciation === "boolean" &&
                strings(v.languages),
        )
    )
        throw new Error("Invalid language-service capabilities. Reload the settings.");
    return value;
}
export function parseSources(value: unknown): SourceCapability[] {
    if (
        !Array.isArray(value) ||
        !value.every(
            (v: unknown): v is SourceCapability =>
                isRecord(v) &&
                typeof v.name === "string" &&
                typeof v.enabled === "boolean" &&
                typeof v.configured === "boolean" &&
                (v.requiresCredential === undefined || typeof v.requiresCredential === "boolean"),
        )
    )
        throw new Error("Invalid lyric-source capabilities. Reload the settings.");
    return value;
}
export function displayFailure(value: unknown): DisplayFailure {
    if (!isRecord(value)) return { message: "The lyric action failed. Please retry." };
    const details = isRecord(value.details)
        ? {
              code: typeof value.details.code === "string" ? value.details.code : undefined,
              message: typeof value.details.message === "string" ? value.details.message : undefined,
              retryable: value.details.retryable === true,
              diagnosticId: typeof value.details.diagnosticId === "string" ? value.details.diagnosticId : undefined,
              retryAt: typeof value.details.retryAt === "string" ? value.details.retryAt : undefined,
              issues: parseRequestIssues(value.details.issues) ?? undefined,
              issueCount:
                  number(value.details.issueCount) && Number.isSafeInteger(value.details.issueCount) && value.details.issueCount >= 0
                      ? value.details.issueCount
                      : undefined,
          }
        : undefined;
    return {
        name: typeof value.name === "string" ? value.name : undefined,
        scope: trackScope(value.scope) ? value.scope : undefined,
        message: typeof value.message === "string" ? value.message : undefined,
        noticeKey: typeof value.noticeKey === "string" ? value.noticeKey : undefined,
        persistent: value.persistent === true,
        details,
        providerErrors: Array.isArray(value.providerErrors) ? value.providerErrors.filter(failure) : undefined,
    };
}

export function responseOrder(value: unknown, key: symbol): number | undefined {
    if (!isRecord(value)) return undefined;
    const order: unknown = Reflect.get(value, key);
    return number(order) ? order : undefined;
}

function trackScope(value: unknown): value is TrackScope {
    return (
        isRecord(value) &&
        number(value.id) &&
        typeof value.itemId === "string" &&
        value.controller instanceof AbortController &&
        number(value.issued) &&
        number(value.accepted)
    );
}
