import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { checkRendererContract, checkModuleBoundary, checkAcyclic } from "../../frontend/contract-boundaries.mjs";

test("renderer contracts reject implementation-derived types", () => {
    for (const source of [
        'import type { RendererApi } from "./runtime.ts";',
        'type Api = import("./runtime.ts").RendererApi;',
        "type Api = ReturnType<typeof installRenderer>;",
        "type Api = typeof publicApi;",
    ])
        assert.throws(() => checkRendererContract("contracts/renderer.ts", source), /independent public types/);
    checkRendererContract("contracts/renderer.ts", "export interface RendererApi { version: string; dispose(): void; }");
});

test("shared globals and bridge consumers retain their contract boundaries", () => {
    assert.throws(
        () => checkRendererContract("platform/globals.ts", 'import type { RendererApi } from "../renderer/runtime.ts";'),
        /depend on contracts/,
    );
    assert.throws(() => checkRendererContract("bridge/runtime.ts", "window.JellyfinLyricMotion?.dispose();"), /narrow port/);
    checkRendererContract("platform/globals.ts", 'import type { RendererPort } from "../contracts/renderer.ts";');
    checkRendererContract("bridge/runtime.ts", 'rendererPort()?.beginTrack("track");');
    assert.throws(() => checkRendererContract("bridge/runtime.ts", 'window["JellyfinLyricMotion"]?.dispose();'), /narrow port/);
});

test("renderer contracts preserve the legacy API and type partial hosts and narrow bridge access", () => {
    const file = fileURLToPath(new URL("../../frontend/renderer/contract.fixture.ts", import.meta.url));
    const source = `
        import type { RendererApi, RendererBridgePort, RendererPort } from "../contracts/renderer.ts";
        import type { RendererApi as LegacyApi } from "./runtime.ts";
        import type { LyricSessionStatePort } from "./lyrics/session-ports.ts";
        declare const session: LyricSessionStatePort;
        type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
        const legacy: Equal<RendererApi, LegacyApi> = true;
        declare const full: RendererApi;
        const bridge: RendererBridgePort = full;
        const tv: RendererPort = { version: "fixture", enabled: false };
        full.performance().atmosphereRendering?.renderedFrames;
        bridge.beginTrack?.("track");
        tv.applyRichPayload?.({});
    `;
    const options = {
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
    };
    function diagnostics(text) {
        const host = ts.createCompilerHost(options),
            read = host.getSourceFile;
        host.getSourceFile = (name, ...args) =>
            path.resolve(name) === file ? ts.createSourceFile(file, text, options.target, true) : read(name, ...args);
        return ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    }
    assert.deepEqual(
        diagnostics(source).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
        [],
    );
    const errors = diagnostics(
        source + "\nbridge.performance();\nfull.dispose = () => {};\nsession.snapshot.generation = 7;\nsession.snapshot.lineData.push(null);",
    );
    assert.deepEqual(errors.map((error) => error.code).sort(), [2339, 2339, 2540, 2540]);
});

test("module ownership rejects upward dependencies and private feature imports", () => {
    for (const [from, to, typeOnly] of [
        ["contracts/bridge.ts", "bridge/runtime.ts", true],
        ["contracts/bridge.ts", "contracts/lyrics.ts", false],
        ["shared/example.ts", "renderer/runtime.ts", true],
        ["platform/example.ts", "bridge/session/track-session.ts", false],
        ["bridge/search/example.ts", "renderer/lyrics/lyric-view.ts", false],
        ["bridge/search/example.ts", "bridge/transcription/review-controller.ts", false],
        ["renderer/host/example.ts", "renderer/playback/media-controller.ts", true],
    ])
        assert.throws(() => checkModuleBoundary(from, to, typeOnly), /depend|import|contracts/);
    checkModuleBoundary("renderer/host/example.ts", "renderer/playback/media-ports.ts", true);
    checkModuleBoundary("bridge/transcription/editor.ts", "bridge/transcription/review-controller.ts", false);
    checkModuleBoundary("renderer/runtime.ts", "renderer/playback/media-controller.ts", false);
    checkModuleBoundary("shared/example.ts", "contracts/lyrics.ts", true);
    assert.throws(() => checkRendererContract("contracts/bridge.ts", "type Result = ReturnType<typeof controller>;"), /infer types/);
    assert.throws(
        () =>
            checkAcyclic(
                new Map([
                    ["a", ["b"]],
                    ["b", ["a"]],
                ]),
            ),
        /cycle/,
    );
    checkAcyclic(
        new Map([
            ["a", ["b"]],
            ["b", []],
        ]),
    );
});
