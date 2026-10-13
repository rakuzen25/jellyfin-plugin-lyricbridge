import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyVersions } from "./check-toolchain.mjs";

const manifest = { packageManager: "pnpm@12.11.2", engines: { pnpm: "12.11.2", node: "26.11.1" } };
test("matching pinned tools pass; wrong executables and inconsistent declarations fail", () => {
    verifyVersions(manifest, "26.11.1", "26.11.1", "12.11.2");
    assert.throws(() => verifyVersions(manifest, "26.11.1", "26.11.1", "10.33.4"), /pnpm 12.11.2 required/);
    assert.throws(() => verifyVersions(manifest, "26.11.1", "26.10.0", "12.11.2"), /Node 26.11.1 required/);
    assert.throws(() => verifyVersions(manifest, "26.10.0", "26.10.0", "12.11.2"), /engines.node/);
    assert.throws(() => verifyVersions({ ...manifest, packageManager: "pnpm@12" }, "26.11.1", "26.11.1", "12.11.2"), /same exact/);
});
