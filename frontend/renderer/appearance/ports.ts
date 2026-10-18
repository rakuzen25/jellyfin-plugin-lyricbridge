/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { RendererPerformanceSnapshot } from "../../contracts/renderer.ts";

export interface ArtworkLifecyclePort {
    requestRefresh(): void;
    cancelProbes(): void;
    resetMediaIdentity(): void;
    trackChanged(): void;
    readonly root: HTMLElement | null;
    readonly artwork: string;
}
export interface ArtworkDiagnosticSnapshot {
    atmosphereArtwork: string;
    atmosphereSource: string;
    atmosphereTimeoutCount: number;
    atmospherePendingKey: string;
    atmospherePendingSince: number;
    atmosphereDynamicDirectLoadFailures: number;
    atmosphereDynamicDomFallbackCommits: number;
    atmosphereDynamicFastInheritedCommits: number;
    atmosphereDynamicFingerprintFailures: number;
    atmosphereDynamicNoArtwork: boolean;
    atmosphereDynamicStaleCommitDrops: number;
    atmosphereDynamicVisualDedupCount: number;
    atmosphereDynamicWebglFailureCount: number;
    atmosphereDynamicWebglRetryAt: number;
    atmosphereDynamicRenderer: { diagnostics(): NonNullable<RendererPerformanceSnapshot["atmosphereRendering"]> } | null;
}
