import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import native from "@typescript/native/package.json" with { type: "json" };

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);
for (const workspace of [".", "frontend"]) {
    test(`${workspace} resolves the native compiler and legacy compiler API side by side`, async () => {
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
        for (const [binary, expected] of [
            ["tsc", native.version],
            ["tsc6", ts.version],
        ]) {
            const { stdout } = await execute(path.join(directory, "node_modules/.bin", binary), ["--version"], {
                cwd: directory,
                encoding: "utf8",
            });
            assert.equal(stdout.trim(), `Version ${expected}`);
        }
    });
}
