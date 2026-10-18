import assert from "node:assert/strict";
import { test } from "node:test";
import { detectStockJellyfinTvEnvironment } from "./host.ts";
test("explicit TV clients retain stock Jellyfin while desktop and mobile are enhanced", () => {
    assert.equal(detectStockJellyfinTvEnvironment({ userAgent: "Mozilla/5.0 (SMART-TV; Tizen)", platform: "" }).detected, true);
    for (const userAgent of ["Mozilla/5.0 (X11; Linux x86_64)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"])
        assert.equal(detectStockJellyfinTvEnvironment({ userAgent, platform: "" }).detected, false);
});
