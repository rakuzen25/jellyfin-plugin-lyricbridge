import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { TrackScope } from "./contracts.ts";

/** Captured track identity and the document commands used by neighboring features. */
export interface TrackSessionPort {
    readonly current: Readonly<BridgeDocument> | null;
    readonly scope: TrackScope | null;
    readonly lastRequest: Request | null;
    setPreferences(value: BridgeDocument["preferences"]): void;
    setAccountPreferences(value: BridgeDocument["accountPreferences"]): void;
    setSongOverrides(value: BridgeDocument["songOverrides"]): void;
    replaceCurrent(value: BridgeDocument | null): void;
}
