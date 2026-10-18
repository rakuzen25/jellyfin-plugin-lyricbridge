import assert from "node:assert/strict";
import { test } from "node:test";
import { BridgeRequestError, createApi } from "../transport/api.ts";
import { parseExportPreview } from "./export-panel.ts";

test("export preview validates bounded file and warning contracts", () => {
    const value = {
        fileName: "lyrics.zip",
        fingerprint: "composition",
        files: [{ fileName: "lyrics.lrc", text: "[00:01.000]Hello", bytes: 19 }],
        warnings: [{ code: "ends_discarded", message: "Ends lost." }],
        hasTranslation: true,
        hasPronunciation: false,
    };
    assert.equal(parseExportPreview(value).files[0]?.text, "[00:01.000]Hello");
    assert.throws(() => parseExportPreview({ ...value, fingerprint: null }));
    assert.throws(() => parseExportPreview({ ...value, files: [{ fileName: "lyrics.txt", text: "test", bytes: -1 }] }));
    assert.throws(() => parseExportPreview({ ...value, warnings: [{}] }));
});
test("export download retains authentication and base path and returns Blob", async () => {
    const controller = new AbortController();
    const request = new Request("https://fixture.invalid/base/Audio/track/Lyrics", { headers: { "X-Emby-Token": "fixture-token" } });
    const api = createApi({
        request: () => request,
        scope: () => ({ controller, issued: 0 }),
        responseOrder: Symbol(),
        received: () => {},
        fetch: async (url, init) => {
            assert.equal(String(url), "https://fixture.invalid/base/LyricBridge/items/track/export");
            assert.equal(new Headers(init?.headers).get("X-Emby-Token"), "fixture-token");
            assert.equal(init?.signal, controller.signal);
            return new Response("export text", { headers: { "Content-Type": "text/plain" } });
        },
    });
    const blob = await api("items/track/export", "POST", { fingerprint: "snapshot" });
    assert.ok(blob instanceof Blob);
    assert.equal(await blob.text(), "export text");
});
test("export download failures keep the existing structured error contract", async () => {
    const api = createApi({
        request: () => new Request("https://fixture.invalid/base/Audio/track/Lyrics"),
        scope: () => null,
        responseOrder: Symbol(),
        received: () => {},
        fetch: async () => new Response(JSON.stringify({ error: { code: "export_changed", message: "Preview again." } }), { status: 409 }),
    });
    await assert.rejects(
        api("items/track/export", "POST", {}),
        (error: unknown) => error instanceof BridgeRequestError && error.details.code === "export_changed",
    );
});
