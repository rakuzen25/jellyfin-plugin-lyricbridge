import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import native from "@typescript/native/package.json" with { type: "json" };

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
for (const workspace of [".", "frontend"]) {
    test(`${workspace} resolves the native compiler and tooling compiler API`, async () => {
        const directory = path.resolve(root, workspace);
        const require = createRequire(path.join(directory, "package.json"));
        const { default: ts } = await import(require.resolve("typescript"));
        assert.match(ts.version, /^6\./);
        const config = ts.readConfigFile(path.join(root, "frontend/tsconfig.json"), ts.sys.readFile);
        assert.equal(config.error, undefined);
        const project = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(root, "frontend"));
        assert.equal(project.errors.length, 0);
        assert.ok(project.fileNames.includes(path.join(root, "frontend/bridge.ts")));
        const source = ts.createSourceFile("fixture.ts", 'import "./module.ts";', ts.ScriptTarget.Latest, true);
        const imports = [];
        ts.forEachChild(source, (node) => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
        });
        assert.deepEqual(imports, ["./module.ts"]);
        assert.match(native.version, /^7\./);
        const { stdout } = await execute(path.join(directory, "node_modules/.bin/tsc"), ["--version"], {
            cwd: directory,
            encoding: "utf8",
        });
        assert.equal(stdout.trim(), `Version ${native.version}`);
    });
}

test("strict test project includes every frontend test without adding Node globals to production", async () => {
    const { readdirSync } = await import("node:fs");
    const require = createRequire(path.join(root, "frontend/package.json"));
    const { default: ts } = await import(require.resolve("typescript"));
    const directory = path.join(root, "frontend");
    const read = (name) => {
        const config = ts.readConfigFile(path.join(directory, name), ts.sys.readFile);
        assert.equal(config.error, undefined);
        const project = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
        assert.deepEqual(project.errors, []);
        return project;
    };
    const application = read("tsconfig.json");
    const tests = read("tsconfig.tests.json");
    const discovered = readdirSync(directory, { recursive: true })
        .filter((file) => !file.split(path.sep).includes("node_modules") && file.endsWith(".test.ts"))
        .map((file) => path.join(directory, file))
        .sort();
    assert.ok(discovered.length > 0);
    assert.deepEqual(tests.fileNames.filter((file) => file.endsWith(".test.ts")).sort(), discovered);
    assert.ok(!application.fileNames.some((file) => file.endsWith(".test.ts")));
    assert.equal(tests.options.strict, true);
    assert.equal(tests.options.noUncheckedIndexedAccess, true);
    assert.deepEqual(application.options.types, []);
    assert.deepEqual(tests.options.types, ["node"]);
    assert.ok(tests.fileNames.includes(path.join(directory, "platform/globals.ts")));
});
