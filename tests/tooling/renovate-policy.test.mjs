import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = JSON.parse(readFileSync(new URL("../../renovate.json", import.meta.url), "utf8"));
const preset = JSON.parse(readFileSync(new URL("../../.build/toolkit/current/default.json", import.meta.url), "utf8"));
function matches(pattern, name) {
    if (pattern.startsWith("!/") && pattern.endsWith("/")) return !new RegExp(pattern.slice(2, -1)).test(name);
    return pattern === name;
}
function policy(name, update, dependency = name) {
    return Object.assign(
        {},
        ...[...preset.packageRules, ...config.packageRules].filter(
            (rule) =>
                (!rule.matchPackageNames || rule.matchPackageNames.some((pattern) => matches(pattern, name))) &&
                (!rule.matchDepNames || rule.matchDepNames.includes(dependency)) &&
                (!rule.matchUpdateTypes || rule.matchUpdateTypes.includes(update)),
        ),
    );
}
test("routine updates automate while major and coupled toolchain changes require review", () => {
    for (const name of ["mypy", "prettier", "actions/checkout", "xunit.v3"]) {
        assert.equal(policy(name, "patch").automerge, true, name);
        assert.equal(policy(name, "major").automerge, false, name);
    }
    for (const name of [
        "typescript",
        "@typescript/typescript6",
        "typescript-eslint",
        "pnpm",
        "node",
        "python",
        "ubuntu",
        "esbuild",
        "Kawazu",
        "OpenccNetLib",
    ]) {
        assert.equal(policy(name, "minor").automerge, false, name);
        assert.equal(policy(name, "minor").groupName, null, name);
    }
    for (const [name, allowedVersions] of [
        ["typescript", ">=7 <8"],
        ["@typescript/typescript6", ">=6 <7"],
    ]) {
        for (const update of ["patch", "minor", "major"]) {
            assert.equal(policy(name, update).allowedVersions, allowedVersions);
            assert.equal(policy(name, update).automerge, update === "patch");
        }
    }
    for (const update of ["patch", "minor", "major"]) {
        assert.equal(policy("typescript", update, "@typescript/old").allowedVersions, ">=6 <7");
        assert.equal(policy("typescript", update, "@typescript/old").automerge, update === "patch");
        assert.equal(policy("typescript", update, "@typescript/native").allowedVersions, ">=7 <8");
    }
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
    const manager = preset.customManagers[1];
    assert.ok(new RegExp(manager.managerFilePatterns[0].slice(1, -1)).test("plugin.toml"));
    const script = readFileSync(new URL("../../plugin.toml", import.meta.url), "utf8");
    const match = new RegExp(manager.matchStrings[0]).exec(script);
    assert.equal(match?.groups?.depName, "mcr.microsoft.com/playwright");
    const expected = JSON.parse(readFileSync(new URL("../browser/package.json", import.meta.url), "utf8")).dependencies.playwright;
    assert.equal(match.groups.currentValue, `v${expected}-noble`);
    assert.match(match.groups.currentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(config.platformAutomerge, true);
    assert.equal(config.rebaseWhen, "behind-base-branch");
    assert.equal(config.ignoreTests, false);
});

test("Renovate, pnpm and pip enforce the same 24-hour release age", () => {
    assert.equal(config.minimumReleaseAge, "1 day");
    assert.equal(config.minimumReleaseAgeBuffer, "30 minutes");
    assert.equal(config.minimumReleaseAgeBehaviour, "timestamp-optional");
    assert.equal(config.internalChecksFilter, "strict");
    for (const rule of config.packageRules) {
        for (const key of ["minimumReleaseAge", "minimumReleaseAgeBuffer", "minimumReleaseAgeBehaviour", "internalChecksFilter"]) {
            assert.equal(Object.hasOwn(rule, key), false, `Package rule overrides ${key}`);
        }
    }
    const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
    const minutes = Number(workspace.match(/^minimumReleaseAge: (\d+)$/m)?.[1]);
    assert.equal(minutes, 24 * 60);
    assert.match(workspace, /^minimumReleaseAgeStrict: true$/m);
    const excludes = workspace.split("minimumReleaseAgeExclude:\n")[1];
    for (const line of (excludes || "").trim().split("\n").filter(Boolean)) {
        assert.match(line.trim(), /^- "?[^*]+@\d+\.\d+\.\d+"?$/, "Exceptions must pin exact versions");
    }
    const tasks = readFileSync(new URL("../../.build/toolkit/current/jellyfin_plugin_toolkit/tasks.py", import.meta.url), "utf8");
    assert.match(tasks, /["\']--uploaded-prior-to=P1D["\']/);
    assert.match(tasks, /"jellyfin_plugin_toolkit\.checks\.check_pip"/);
    const setup = readFileSync(new URL("../../.build/toolkit/current/.github/actions/setup/action.yml", import.meta.url), "utf8");
    assert.match(setup, /--uploaded-prior-to=P1D/);
});
