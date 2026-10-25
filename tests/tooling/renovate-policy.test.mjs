import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const localConfig = JSON.parse(readFileSync(new URL("../../renovate.json", import.meta.url), "utf8"));
const tooling = JSON.parse(readFileSync(new URL("../../.build/jpt/tooling.json", import.meta.url), "utf8"));
const preset = JSON.parse(readFileSync(new URL("../../.build/jpt/default.json", import.meta.url), "utf8"));
const config = {
    ...tooling,
    ...preset,
    ...localConfig,
    packageRules: [...tooling.packageRules, ...preset.packageRules, ...localConfig.packageRules],
};
function matches(pattern, name) {
    if (pattern.startsWith("!/") && pattern.endsWith("/")) return !new RegExp(pattern.slice(2, -1)).test(name);
    return pattern === name;
}
function policy(name, update, dependency = name, manager = "npm") {
    return Object.assign(
        {},
        ...config.packageRules.filter(
            (rule) =>
                (!rule.matchPackageNames || rule.matchPackageNames.some((pattern) => matches(pattern, name))) &&
                (!rule.matchManagers || rule.matchManagers.includes(manager)) &&
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
        assert.equal(policy(name, "minor").groupName, name === "python" ? "Python toolchain" : null, name);
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

test("third-party dependencies retain the 24-hour release age; toolkit releases are immediate", () => {
    assert.equal(config.minimumReleaseAge, "1 day");
    assert.equal(config.minimumReleaseAgeBuffer, "30 minutes");
    assert.equal(config.minimumReleaseAgeBehaviour, "timestamp-optional");
    assert.equal(config.internalChecksFilter, "strict");
    const exceptions = localConfig.packageRules.filter((rule) => Object.hasOwn(rule, "minimumReleaseAge"));
    assert.equal(exceptions.length, 1);
    const [toolkit] = exceptions;
    assert.deepEqual(toolkit.matchPackageNames, ["rakuzen25/jellyfin-plugin-toolkit"]);
    assert.deepEqual(toolkit.matchManagers, ["custom.regex"]);
    assert.deepEqual(toolkit.matchDatasources, ["github-releases"]);
    assert.deepEqual(toolkit.matchFileNames, ["pyproject.toml"]);
    assert.equal(toolkit.enabled, true);
    assert.equal(toolkit.minimumReleaseAge, null);
    assert.equal(toolkit.minimumReleaseAgeBuffer, null);
    for (const rule of localConfig.packageRules) {
        const protectedKeys = ["minimumReleaseAgeBehaviour", "internalChecksFilter"];
        if (rule !== toolkit) protectedKeys.push("minimumReleaseAge", "minimumReleaseAgeBuffer");
        for (const key of protectedKeys) {
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
    const project = readFileSync(new URL("../../pyproject.toml", import.meta.url), "utf8");
    assert.match(project, /exclude-newer = "1 day"/);
    const lock = readFileSync(new URL("../../uv.lock", import.meta.url), "utf8");
    assert.match(lock, /exclude-newer-span = "P1D"/);
});

test("Python and uv share a dedicated group with patch-only automerge", () => {
    for (const name of ["python", "uv", "astral-sh/uv"]) {
        for (const update of ["patch", "minor", "major"]) {
            assert.equal(policy(name, update).groupName, "Python toolchain");
            assert.equal(policy(name, update).automerge, update === "patch");
        }
    }
});
