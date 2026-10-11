import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const root = new URL(".", import.meta.url).pathname;
const configuration = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
if (!project.options.strict || !project.options.noUncheckedIndexedAccess)
    throw new Error("Application checking must remain strict with checked indexed access.");
const checked = new Set(project.fileNames.map((file) => path.resolve(file)));
let count = 0;
function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            visit(file);
            continue;
        }
        if (/\.(js|jsx)$/.test(file)) throw new Error("Unchecked application JavaScript: " + file);
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        if (!checked.has(file)) throw new Error("Application source excluded from typechecking: " + file);
        const source = fs.readFileSync(file, "utf8");
        if (/@ts-(nocheck|ignore)/.test(source)) throw new Error("Suppressed application checking: " + file);
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        function inspect(node) {
            if (node.kind === ts.SyntaxKind.AnyKeyword) throw new Error("Broad any in application contract: " + file);
            ts.forEachChild(node, inspect);
        }
        inspect(ast);
        count++;
    }
}
visit(root);
console.log(`PASS: ${count} maintained TypeScript sources covered by strict checking; no unchecked application JavaScript or broad any.`);

const buildScript = fs.readFileSync(path.join(root, "build.mjs"), "utf8");
const outputs = new Map();
const buildAst = ts.createSourceFile("build.mjs", buildScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function inspectBuild(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "build") {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
            const properties = options.properties.filter(ts.isPropertyAssignment);
            const entries = properties.find((property) => property.name.getText(buildAst) === "entryPoints")?.initializer;
            const output = properties.find((property) => property.name.getText(buildAst) === "outfile")?.initializer;
            if (entries && ts.isArrayLiteralExpression(entries) && entries.elements.length === 1 && output && ts.isStringLiteral(output)) {
                const entry = entries.elements[0];
                if (entry && ts.isStringLiteral(entry)) outputs.set(entry.text, output.text);
            }
        }
    }
    ts.forEachChild(node, inspectBuild);
}
inspectBuild(buildAst);
for (const [entry, output] of [
    ["bridge.ts", "lyricbridge.js"],
    ["renderer.ts", "jellyfin-lyric-motion.js"],
]) {
    if (outputs.get(entry) !== "../dist/web/" + output) throw new Error("Changed public output filename or unchecked bundle entrypoint: " + entry);
}
