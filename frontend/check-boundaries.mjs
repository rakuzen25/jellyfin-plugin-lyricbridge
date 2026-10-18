import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { bundleEntries } from "./build.mjs";
import { checkRendererContract, checkModuleBoundary, checkAcyclic } from "./contract-boundaries.mjs";
const root = new URL(".", import.meta.url).pathname;
const configuration = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
if (!project.options.strict || !project.options.noUncheckedIndexedAccess)
    throw new Error("Application checking must remain strict with checked indexed access.");
const checked = new Set(project.fileNames.map((file) => path.resolve(file)));
let count = 0;
const graph = new Map();
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
        checkRendererContract(path.relative(root, file), source);
        if (/@ts-(nocheck|ignore)/.test(source)) throw new Error("Suppressed application checking: " + file);
        if (file !== path.join(root, "bridge/ui/feedback.ts") && /e\("div",\s*"lb-(feedback|confirmation)"/.test(source))
            throw new Error("Feature-specific feedback markup: use the shared feedback adapter: " + file);
        if (file.startsWith(path.join(root, "bridge") + path.sep) && /progress\.textContent\s*[+]?=/.test(source))
            throw new Error("Direct progress text bypasses shared feedback: " + file);
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const relative = path.relative(root, file).split(path.sep).join("/");
        const dependencies = [];
        for (const declaration of ast.statements) {
            if (!ts.isImportDeclaration(declaration) && !ts.isExportDeclaration(declaration)) continue;
            const specifier = declaration.moduleSpecifier;
            if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier.text));
            const clause = ts.isImportDeclaration(declaration) ? declaration.importClause : undefined;
            const named = clause?.namedBindings;
            const typeOnly =
                !!declaration.isTypeOnly ||
                !!clause?.isTypeOnly ||
                (!!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((item) => item.isTypeOnly));
            checkModuleBoundary(relative, target, typeOnly);
            if (!typeOnly) dependencies.push(target);
        }
        graph.set(relative, dependencies);
        function inspect(node) {
            const dynamic = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
            const importedType = ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined;
            const specifier = dynamic || importedType;
            if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
                const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier.text));
                checkModuleBoundary(relative, target, !!importedType);
                if (dynamic) dependencies.push(target);
            }
            if (
                ts.isStringLiteral(node) &&
                (ts.isImportDeclaration(node.parent) ||
                    ts.isExportDeclaration(node.parent) ||
                    (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent)) ||
                    (ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword)) &&
                (path.isAbsolute(node.text) || /^[A-Za-z]:[\\/]/.test(node.text))
            )
                throw new Error("Machine-specific absolute module import: " + file);
            if (node.kind === ts.SyntaxKind.AnyKeyword) throw new Error("Broad any in application contract: " + file);
            ts.forEachChild(node, inspect);
        }
        inspect(ast);
        count++;
    }
}
visit(root);
checkAcyclic(graph);
console.log(`PASS: ${count} maintained TypeScript sources covered by strict checking; no unchecked application JavaScript or broad any.`);

for (const [entry, output] of Object.entries(bundleEntries)) {
    if (!checked.has(path.join(root, entry))) throw new Error("Unchecked bundle entrypoint: " + entry);
    const expected = { "bridge.ts": "lyricbridge.js", "renderer.ts": "jellyfin-lyric-motion.js" };
    if (expected[entry] !== output) throw new Error("Changed public output filename: " + entry);
}
