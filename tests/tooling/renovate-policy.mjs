import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectivePolicy, extractPackageFile } from "../../.build/jpt/node/renovate-api.mjs";

const policy = (depName, updateType, dep = depName) => effectivePolicy({ depName: dep, packageName: depName, updateType });
for (const name of ["esbuild", "Kawazu", "OpenccNetLib", "Lyricify.Lyrics.Helper"]) {
    assert.equal((await policy(name, "patch")).automerge, true);
    for (const update of ["minor", "major"]) assert.equal((await policy(name, update)).automerge, false);
}
for (const name of ["playwright", "mcr.microsoft.com/playwright"]) {
    for (const update of ["patch", "digest", "minor", "major"]) {
        const actual = await policy(name, update);
        assert.equal(actual.groupName, "Playwright package and image");
        assert.equal(actual.automerge, ["patch", "digest"].includes(update));
    }
}
for (const [depName, expected] of [
    ["typescript", ">=7 <8"],
    ["@typescript/typescript6", ">=6 <7"],
])
    assert.equal((await policy(depName, "patch")).allowedVersions, expected);
assert.equal((await policy("typescript", "patch", "@typescript/old")).allowedVersions, ">=6 <7");
assert.equal((await policy("typescript", "patch", "@typescript/native")).allowedVersions, ">=7 <8");
assert.equal((await policy("xunit.v3", "minor")).groupName, (await policy("xunit.analyzers", "minor")).groupName);
const preset = JSON.parse(readFileSync(".build/jpt/default.json", "utf8"));
const dependencies = (await extractPackageFile(readFileSync("plugin.toml", "utf8"), "plugin.toml", preset.customManagers[1])).deps;
assert.equal(dependencies.length, 1);
assert.equal(dependencies[0].depName, "mcr.microsoft.com/playwright");
const playwright = JSON.parse(readFileSync("tests/browser/package.json", "utf8")).dependencies.playwright;
assert.equal(dependencies[0].currentValue, `v${playwright}-noble`);
assert.match(dependencies[0].currentDigest, /^sha256:[a-f0-9]{64}$/);
const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
assert.match(workspace, /^minimumReleaseAge: 1440$/m);
assert.match(workspace, /^minimumReleaseAgeStrict: true$/m);
assert.match(readFileSync("pyproject.toml", "utf8"), /exclude-newer = "1 day"/);
assert.match(readFileSync("uv.lock", "utf8"), /exclude-newer-span = "P1D"/);
console.log("PASS: LyricBridge provider review, compiler ranges, Playwright pairing and native release-age policy");
