/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";

export interface PronunciationState {
    romanizationMode: string;
    romanizationAvailable: boolean;
    romanizationCandidate: boolean;
    romanizationLoadState: string;
    romanizationLoadError: string;
    romanizationSource: string;
    googleRomanizationCache: Map<string, string>;
    googleRomanizationFragmentCache: Map<string, string>;
    googleRomanizationAttempted: Set<string>;
    googleRomanizationRequest: Promise<void> | null;
    googleRomanizationState: string;
    googleRomanizationError: string;
    googleRomanizationLineCount: number;
    romanizationLineCount: number;
}

export interface PronunciationStatePort {
    readonly snapshot: ReadView<PronunciationState>;
    setRomanizationLineCount(value: number): void;
    setRomanizationMode(value: string): void;
    clearGoogleRomanizationCache(): void;
    clearGoogleRomanizationFragmentCache(): void;
    clearGoogleRomanizationAttempted(): void;
    setGoogleRomanizationRequest(value: Promise<void> | null): void;
    setGoogleRomanizationState(value: string): void;
    setGoogleRomanizationError(value: string): void;
    setGoogleRomanizationLineCount(value: number): void;
    setRomanizationCandidate(value: boolean): void;
    setRomanizationAvailable(value: boolean): void;
    setRomanizationLoadState(value: string): void;
    setRomanizationSource(value: string): void;
    setRomanizationLoadError(value: string): void;
}
