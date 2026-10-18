/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. */
import type { ReadView } from "../../shared/read-view.ts";

export interface PerformancePolicyState {
    performanceMode: "auto" | "desktop" | "mobile";
    performanceProfile: "desktop" | "mobile";
}

export interface PerformancePolicyStatePort {
    readonly snapshot: ReadView<PerformancePolicyState>;
    restorePerformanceMode(value: "auto" | "desktop" | "mobile"): void;
    setPerformanceProfile(value: "desktop" | "mobile"): void;
}
