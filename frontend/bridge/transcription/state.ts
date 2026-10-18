import { type RequestIssue } from "../../contracts/errors.ts";
import { isRecord } from "../../shared/invariants.ts";
import { parseRequestIssues } from "../transport/api.ts";
export interface TimedToken {
    id: string;
    text: string;
    separator: string;
    position: number;
    endPosition: number;
    start: number;
    end: number;
}
export interface BreakSettings {
    characters: number | null;
    seconds: number;
    keepShortReplies: boolean;
}
export interface BoundaryVersion {
    id: string;
    origin: string;
    algorithm: string;
    created?: string;
    seamTokenIds?: string[];
    model?: string;
    optionName?: string;
    endTokenIds: string[];
    settings: BreakSettings;
}
interface DeletionCapability {
    allowed: boolean;
    reason: string | null;
}
interface SavedBoundaryEntry {
    id: string;
    versionId: string;
    origin: string;
    settings: BreakSettings;
    created?: string;
    optionName?: string;
    model?: string;
    seamTokenIds: string[];
    deletion: DeletionCapability;
}
export interface ReviewDocument {
    transcript: { optionName?: string; id: string; text: string; language: string; timing: string; tokens: TimedToken[]; warnings: RequestIssue[] };
    versions: BoundaryVersion[];
    savedEntries: SavedBoundaryEntry[];
    deletion: DeletionCapability;
    canManage: boolean;
    reviewResults: {
        id: string;
        versionId: string;
        created?: string;
        optionName?: string;
        model?: string;
        seamTokenIds: string[];
        settings?: BreakSettings;
    }[];
    boundaries: { afterId: string; message: string | null }[];
    selection: string;
    canUse: boolean;
}
function parseSettings(value: unknown): BreakSettings {
    if (
        !isRecord(value) ||
        !(value.characters == null || (Number.isSafeInteger(value.characters) && Number(value.characters) >= 4 && Number(value.characters) <= 200)) ||
        typeof value.seconds !== "number" ||
        !Number.isFinite(value.seconds) ||
        value.seconds < 0.5 ||
        value.seconds > 30 ||
        typeof value.keepShortReplies !== "boolean"
    )
        throw new Error("Invalid line-break settings.");
    return {
        characters: value.characters == null ? null : Number(value.characters),
        seconds: value.seconds,
        keepShortReplies: value.keepShortReplies,
    };
}
export function parseBoundaryVersion(value: unknown): BoundaryVersion {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        typeof value.origin !== "string" ||
        typeof value.algorithm !== "string" ||
        !Array.isArray(value.endTokenIds) ||
        !value.endTokenIds.every((id): id is string => typeof id === "string")
    )
        throw new Error("Invalid boundary version.");
    return {
        id: value.id,
        origin: value.origin,
        seamTokenIds: Array.isArray(value.seamTokenIds) ? value.seamTokenIds.filter((id): id is string => typeof id === "string") : [],
        algorithm: value.algorithm,
        optionName: typeof value.optionName === "string" ? value.optionName : undefined,
        created: typeof value.created === "string" ? value.created : undefined,
        model: isRecord(value.profile) && typeof value.profile.model === "string" ? value.profile.model : undefined,
        endTokenIds: value.endTokenIds,
        settings: parseSettings(value.settings),
    };
}
export function parseReview(value: unknown): ReviewDocument {
    if (
        !isRecord(value) ||
        !isRecord(value.transcript) ||
        !Array.isArray(value.versions) ||
        !Array.isArray(value.boundaries) ||
        typeof value.selection !== "string" ||
        typeof value.canUse !== "boolean"
    )
        throw new Error("Invalid transcription review response.");
    const source = value.transcript;
    if (
        typeof source.id !== "string" ||
        typeof source.text !== "string" ||
        typeof source.language !== "string" ||
        !["word", "segment"].includes(String(source.timing)) ||
        !Array.isArray(source.tokens) ||
        !source.tokens.length
    )
        throw new Error("Invalid preserved transcript.");
    const tokens = source.tokens.map((t): TimedToken => {
        if (
            !isRecord(t) ||
            typeof t.id !== "string" ||
            typeof t.text !== "string" ||
            !t.text.length ||
            typeof t.separator !== "string" ||
            typeof t.position !== "number" ||
            typeof t.endPosition !== "number" ||
            typeof t.start !== "number" ||
            typeof t.end !== "number" ||
            ![t.position, t.endPosition, t.start, t.end].every(Number.isSafeInteger) ||
            t.start < 0 ||
            t.end < t.start
        )
            throw new Error("Invalid preserved token.");
        return { id: t.id, text: t.text, separator: t.separator, position: t.position, endPosition: t.endPosition, start: t.start, end: t.end };
    });
    let offset = 0;
    for (const t of tokens) {
        offset += t.separator.length;
        if (t.position !== offset || t.endPosition !== offset + t.text.length) throw new Error("Invalid token text offsets.");
        offset = t.endPosition;
    }
    if (tokens.map((t) => t.separator + t.text).join("") !== source.text || new Set(tokens.map((t) => t.id)).size !== tokens.length)
        throw new Error("Transcript text does not match preserved tokens.");
    const warnings = parseRequestIssues(source.warnings);
    if (!warnings) throw new Error("Invalid transcription warnings.");
    const versions = value.versions.map(parseBoundaryVersion);
    for (const v of versions) validateEnds(tokens, v.endTokenIds);
    const boundaries = value.boundaries.map((b) => {
        if (!isRecord(b) || typeof b.afterId !== "string" || !(b.message == null || typeof b.message === "string"))
            throw new Error("Invalid boundary guidance.");
        return { afterId: b.afterId, message: typeof b.message === "string" ? b.message : null };
    });
    if (value.reviewResults != null && !Array.isArray(value.reviewResults)) throw new Error("Invalid saved AI reviews.");
    const reviewResults = (Array.isArray(value.reviewResults) ? value.reviewResults : []).map((result) => {
        if (
            !isRecord(result) ||
            typeof result.id !== "string" ||
            typeof result.versionId !== "string" ||
            !versions.some((version) => version.id === result.versionId)
        )
            throw new Error("Invalid saved AI review reference.");
        return {
            id: result.id,
            versionId: result.versionId,
            created: typeof result.created === "string" ? result.created : undefined,
            optionName: typeof result.optionName === "string" ? result.optionName : undefined,
            model: isRecord(result.profile) && typeof result.profile.model === "string" ? result.profile.model : undefined,
            seamTokenIds: Array.isArray(result.seamTokenIds) ? result.seamTokenIds.filter((id): id is string => typeof id === "string") : [],
            settings: result.settings != null ? parseSettings(result.settings) : undefined,
        };
    });
    const deletion = (v: unknown): DeletionCapability => {
        if (!isRecord(v) || typeof v.allowed !== "boolean" || !(v.reason == null || typeof v.reason === "string"))
            throw new Error("Invalid deletion permissions.");
        return { allowed: v.allowed, reason: typeof v.reason === "string" ? v.reason : null };
    };
    if (!Array.isArray(value.savedEntries)) throw new Error("Invalid saved line breaks.");
    const savedEntries = value.savedEntries.map((v): SavedBoundaryEntry => {
        if (!isRecord(v) || !isRecord(v.entry)) throw new Error("Invalid saved entry.");
        const entry = v.entry;
        if (
            typeof entry.id !== "string" ||
            typeof entry.versionId !== "string" ||
            typeof entry.origin !== "string" ||
            !versions.some((b) => b.id === entry.versionId)
        )
            throw new Error("Invalid saved entry reference.");
        return {
            id: entry.id,
            versionId: entry.versionId,
            origin: entry.origin,
            settings: parseSettings(entry.settings),
            created: typeof entry.created === "string" ? entry.created : undefined,
            optionName: typeof entry.optionName === "string" ? entry.optionName : undefined,
            model: isRecord(entry.profile) && typeof entry.profile.model === "string" ? entry.profile.model : undefined,
            seamTokenIds: Array.isArray(entry.seamTokenIds) ? entry.seamTokenIds.filter((id): id is string => typeof id === "string") : [],
            deletion: deletion(v.deletion),
        };
    });
    return {
        transcript: {
            ...(typeof source.optionName === "string" ? { optionName: source.optionName } : {}),
            id: source.id,
            text: source.text,
            language: source.language,
            timing: String(source.timing),
            tokens,
            warnings,
        },
        versions,
        savedEntries,
        deletion: deletion(value.deletion),
        canManage: value.canManage === true,
        reviewResults,
        boundaries,
        selection: value.selection,
        canUse: value.canUse,
    };
}
export function validateEnds(tokens: TimedToken[], ends: string[]): void {
    const ids = tokens.map((t) => t.id);
    const order = new Map(ids.map((id, index) => [id, index]));
    const positions = ends.map((id) => order.get(id) ?? -1);
    if (!ends.length || ends.at(-1) !== ids.at(-1) || positions.some((p, i) => p < 0 || (i > 0 && p <= positions[i - 1]!)))
        throw new Error("Invalid line breaks: every token must appear exactly once, in order.");
}
export class BoundaryHistory {
    private entries: string[][];
    private index = 0;
    readonly tokens: TimedToken[];
    constructor(tokens: TimedToken[], ends: string[]) {
        this.tokens = tokens;
        validateEnds(tokens, ends);
        this.entries = [ends.slice()];
    }
    get ends(): string[] {
        return this.entries[this.index]!.slice();
    }
    get canUndo(): boolean {
        return this.index > 0;
    }
    get canRedo(): boolean {
        return this.index < this.entries.length - 1;
    }
    replace(ends: string[]): void {
        validateEnds(this.tokens, ends);
        if (JSON.stringify(ends) === JSON.stringify(this.ends)) return;
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(ends.slice());
        this.index++;
    }
    split(id: string): void {
        const selected = new Set([...this.ends, id]);
        this.replace(this.tokens.filter((t) => selected.has(t.id)).map((t) => t.id));
    }
    merge(id: string): void {
        if (id !== this.tokens.at(-1)?.id) this.replace(this.ends.filter((end) => end !== id));
    }
    undo(): void {
        if (this.canUndo) this.index--;
    }
    redo(): void {
        if (this.canRedo) this.index++;
    }
    get phrases(): TimedToken[][] {
        const ends = new Set(this.ends);
        const result: TimedToken[][] = [];
        let current: TimedToken[] = [];
        for (const token of this.tokens) {
            current.push(token);
            if (ends.has(token.id)) {
                result.push(current);
                current = [];
            }
        }
        return result;
    }
}
export function graphemeEnds(text: string): Set<number> {
    return new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.index + s.segment.length));
}
