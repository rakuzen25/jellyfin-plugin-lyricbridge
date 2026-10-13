import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = JSON.parse(readFileSync(new URL("../renovate.json", import.meta.url), "utf8"));
function policy(name, update) {
    return Object.assign(
        {},
        ...config.packageRules.filter(
            (rule) =>
                (!rule.matchPackageNames || rule.matchPackageNames.includes(name)) &&
                (!rule.matchUpdateTypes || rule.matchUpdateTypes.includes(update)),
        ),
    );
}
test("routine updates automate while major and coupled toolchain changes require review", () => {
    for (const name of ["mypy", "prettier", "actions/checkout", "xunit.v3"]) {
        assert.equal(policy(name, "patch").automerge, true, name);
        assert.equal(policy(name, "major").automerge, false, name);
    }
    for (const name of ["typescript", "typescript-eslint", "pnpm", "node", "python", "ubuntu", "esbuild", "Kawazu", "OpenccNetLib"]) {
        assert.equal(policy(name, "minor").automerge, false, name);
        assert.equal(policy(name, "minor").groupName, null, name);
    }
    assert.equal(policy("typescript", "major").allowedVersions, "<7");
    assert.equal(policy("xunit.v3", "minor").groupName, policy("xunit.analyzers", "minor").groupName);
    assert.equal(policy("actions/upload-artifact", "major").groupName, policy("actions/download-artifact", "major").groupName);
});
test("Playwright and its extracted versioned image share a patch-only automerge group", () => {
    for (const name of ["playwright", "mcr.microsoft.com/playwright"]) {
        assert.equal(policy(name, "patch").automerge, true);
        assert.equal(policy(name, "digest").automerge, true);
        assert.equal(policy(name, "minor").automerge, false);
        assert.equal(policy(name, "major").automerge, false);
        assert.equal(policy(name, "patch").groupName, "Playwright package and image");
    }
    const manager = config.customManagers[0];
    const script = readFileSync(new URL("./test-browser.sh", import.meta.url), "utf8");
    const match = new RegExp(manager.matchStrings[0]).exec(script);
    assert.equal(match?.groups?.depName, "mcr.microsoft.com/playwright");
    const expected = JSON.parse(readFileSync(new URL("../browser-tests/package.json", import.meta.url), "utf8")).dependencies.playwright;
    assert.equal(match.groups.currentValue, `v${expected}-noble`);
    assert.match(match.groups.currentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(config.platformAutomerge, true);
    assert.equal(config.rebaseWhen, "behind-base-branch");
    assert.equal(config.ignoreTests, false);
});
