export interface Target {
    kind: string;
    id: string;
}
interface Identity {
    id: string;
    name: string;
    missing: boolean;
}
export interface Entity {
    identity: Identity;
    artist: string;
    records: number;
    payloadBytes: number;
}
export interface DataPage<T> {
    items: T[];
    total: number;
    offset: number;
    limit: number;
}
export interface StoredRecord {
    target: Target;
    displayType?: string;
    inspection?: {
        lines: { text: string; startSeconds?: number; endSeconds?: number }[];
        fields: { label: string; value: string; format?: string }[];
        metadata: { label: string; value: string; format?: string }[];
        relationships: { role: string; target: Target; label: string; missing: boolean }[];
        restriction?: string;
        canCancel: boolean;
    };
    category: string;
    title: string;
    itemIds: string[];
    userIds: string[];
    payloadBytes: number;
    canDelete: boolean;
    blocker?: string;
    dependencies: Target[];
    data?: Record<string, unknown>;
    readableText?: string;
    source?: string;
    storedAt?: string;
    songs?: Identity[];
    accounts?: Identity[];
}
export interface Selection {
    action: string;
    targets?: Target[];
    category?: string;
    itemId?: string;
    userId?: string;
}
export interface Preview {
    token: string;
    confirmation: string;
    items: StoredRecord[];
    effects: string[];
    expires: string;
}
export interface DataResult {
    outcomes: { target: Target; status: string; message?: string }[];
    complete: boolean;
    phase?: string;
}
export interface DataHost {
    call<T>(path: string, method?: string, data?: unknown): Promise<T>;
    feedback(target: HTMLElement, message: string, error?: boolean): void;
    unsaved(): boolean;
    busy(): boolean;
    discard(): Promise<void>;
    maintenance(value: boolean): void;
    reload(): Promise<void>;
    settings(tab: number): void;
}
export const targetKey = (target: Target) => target.kind + ":" + target.id;
export const recordType = (kind: string) =>
    ({
        "saved-original": "Original lyrics",
        document: "Shared lyric content",
        raw: "Provider response",
        variant: "Language version",
        transcript: "Transcript",
        "saved-boundary-entry": "Saved line-break review",
        "boundary-version": "Line-break version",
        selected: "Selected lyrics",
        "auxiliary-choice": "Language choice",
        job: "Generation request",
        preferences: "Account preferences",
        "boundary-review-result": "Line-break review result",
        "transcript-original": "Published transcript",
        "mixed-origin": "Version provenance",
        "selection-assessment": "Selection assessment",
        "timing-correction": "Timing adjustment",
        instrumental: "Instrumental classification",
        "instrumental-evidence": "Classification evidence",
        "rejected-match": "Rejected match",
        "discovery-suppressed": "Retrieval suppression",
        "pronunciation-choice": "Pronunciation choice",
        "job-admission": "Quota accounting",
        candidate: "Search result",
        preview: "Temporary lyric preview",
        "preview-assessment": "Preview assessment",
        better: "Improvement offer",
        "review-checkpoint": "Review checkpoint",
        "transcript-chunk": "Transcription chunk",
        "audio-staging": "Staged audio",
        "song-preferences": "Song preferences",
    })[kind] || "Internal record";
