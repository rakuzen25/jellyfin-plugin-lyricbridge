import ts from "typescript";

/** Public renderer types must remain independent of implementation inference. */
export function checkRendererContract(file, source) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
        if (
            file.startsWith("contracts/") &&
            file !== "contracts/renderer.ts" &&
            (ts.isImportTypeNode(node) || ts.isTypeQueryNode(node) || (ts.isTypeReferenceNode(node) && node.typeName.getText(ast) === "ReturnType"))
        )
            throw new Error("Contracts cannot infer types from implementations: " + file);
        if (
            file === "contracts/renderer.ts" &&
            (ts.isImportDeclaration(node) ||
                ts.isImportTypeNode(node) ||
                ts.isTypeQueryNode(node) ||
                (ts.isTypeReferenceNode(node) && node.typeName.getText(ast) === "ReturnType"))
        )
            throw new Error("Renderer contracts must declare independent public types: " + file);
        if (
            file === "platform/globals.ts" &&
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            !node.moduleSpecifier.text.startsWith("../contracts/")
        )
            throw new Error("Shared renderer declarations must depend on contracts: " + file);
        const windowExpression = (expression) => ["window", "globalThis.window", "self"].includes(expression.getText(ast));
        const rendererAccess =
            (ts.isPropertyAccessExpression(node) && windowExpression(node.expression) && node.name.text === "JellyfinLyricMotion") ||
            (ts.isElementAccessExpression(node) &&
                windowExpression(node.expression) &&
                ts.isStringLiteral(node.argumentExpression) &&
                node.argumentExpression.text === "JellyfinLyricMotion");
        if (file.startsWith("bridge/") && file !== "bridge/transport/renderer-port.ts" && rendererAccess)
            throw new Error("Bridge renderer access must use its narrow port: " + file);
        ts.forEachChild(node, visit);
    }
    visit(ast);
}

// These modules expose reusable feature operations or pure algorithms. Controllers and
// views behind them are constructed by composition roots or by their owning feature.
const featureApis = new Set([
    "bridge/jobs/generation-state.ts",
    "bridge/lyrics/auxiliary.ts",
    "bridge/preferences/preferences.ts",
    "bridge/preview/playback-preview.ts",
    "bridge/preview/preview-session.ts",
    "bridge/search/search-models.ts",
    "bridge/services/service-options.ts",
    "bridge/transport/api.ts",
    "bridge/transport/renderer-port.ts",
    "bridge/transport/responses.ts",
    "bridge/ui/controls.ts",
    "bridge/ui/dialog.ts",
    "bridge/ui/feedback.ts",
    "bridge/ui/playback-notifications.ts",
    "renderer/common/dom.ts",
    "renderer/common/settings.ts",
    "renderer/host/host.ts",
    "renderer/lyrics/cue-ranges.ts",
    "renderer/lyrics/geometry.ts",
    "renderer/lyrics/karaoke-animation.ts",
    "renderer/lyrics/payload.ts",
    "renderer/playback/ticks.ts",
    "renderer/playback/timeline.ts",
    "renderer/pronunciation/text-processing.ts",
    "admin/data/data-review.ts",
    "admin/data/record-inspector.ts",
    "admin/services/credentials.ts",
    "admin/settings/contracts.ts",
    "admin/settings/settings-draft.ts",
    "admin/ui/controls.ts",
    "admin/ui/settings-row.ts",
    "admin/ui/ui.ts",
]);

export function checkModuleBoundary(file, target, typeOnly) {
    const from = file.split("/"),
        to = target.split("/");
    if (from[0] === "contracts" && (to[0] !== "contracts" || !typeOnly))
        throw new Error("Contracts may depend only on independent contract types: " + file + " -> " + target);
    if (from[0] === "shared" && !["shared", "contracts"].includes(to[0]))
        throw new Error("Shared primitives cannot depend on applications: " + file + " -> " + target);
    if (from[0] === "platform" && !["platform", "shared", "contracts"].includes(to[0]))
        throw new Error("Platform adapters cannot depend on application implementations: " + file + " -> " + target);
    const applications = ["bridge", "renderer", "admin"];
    if (!applications.includes(from[0]) || !applications.includes(to[0])) return;
    if (from[0] !== to[0]) throw new Error("Applications must communicate through contracts: " + file + " -> " + target);
    if (from.length < 3 || from[1] === to[1]) return;
    if (typeOnly && /(?:^|\/)(?:[^/]*(?:ports|contracts|models))\.ts$/.test(target)) return;
    if (!featureApis.has(target)) throw new Error("Cross-feature implementation import: " + file + " -> " + target);
}

export function checkAcyclic(graph) {
    const active = new Set(),
        complete = new Set();
    function visit(node) {
        if (active.has(node)) throw new Error("Application runtime dependency cycle: " + node);
        if (complete.has(node)) return;
        active.add(node);
        for (const dependency of graph.get(node) || []) visit(dependency);
        active.delete(node);
        complete.add(node);
    }
    for (const node of graph.keys()) visit(node);
}
