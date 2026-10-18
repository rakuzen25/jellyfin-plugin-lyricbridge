interface Baseline<TOwner, TDocument> {
    owner: TOwner;
    doc: TDocument;
    time: number;
}
export interface PreviewUpdate<TDocument> {
    data: TDocument;
    renderNow: boolean;
    order?: number;
}
/** A playback preview owns one baseline and deferred retrieval responses, never a new track. */
export class PreviewSession<TOwner, TDocument> {
    private saved: Baseline<TOwner, TDocument> | null = null;
    private pending: PreviewUpdate<TDocument> | null = null;
    get baseline(): Readonly<Baseline<TOwner, TDocument>> | null {
        return this.saved;
    }
    begin(owner: TOwner, doc: TDocument, time: number): void {
        if (this.saved?.owner === owner) return;
        this.saved = { owner, doc, time };
        this.pending = null;
    }
    defer(owner: TOwner, update: PreviewUpdate<TDocument>): boolean {
        if (!this.saved || this.saved.owner !== owner) return false;
        const previousOrder = this.pending?.order;
        if (previousOrder === undefined || update.order === undefined || update.order >= previousOrder) this.pending = update;
        return true;
    }
    finish(
        owner: TOwner | null,
        restore: boolean,
    ): {
        baseline: Readonly<Baseline<TOwner, TDocument>> | null;
        pending: PreviewUpdate<TDocument> | null;
    } {
        const matches = restore && this.saved?.owner === owner;
        const result = { baseline: matches ? this.saved : null, pending: matches ? this.pending : null };
        this.discard();
        return result;
    }
    discard(): void {
        this.saved = null;
        this.pending = null;
    }
}
