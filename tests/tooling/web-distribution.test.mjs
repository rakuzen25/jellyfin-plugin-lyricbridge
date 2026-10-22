import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createBuilder } from "../../.build/jpt/node/build.mjs";

test("distributed lyric renderer preserves its public asset names and standalone administrator page", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const files = await (await createBuilder(root)).compileWeb();
    for (const name of ["lyricbridge.js", "jellyfin-lyric-motion.js", "lyricbridge.css", "config.html", "NOTICE.txt"])
        assert.ok(files.has(name), "Missing public asset: " + name);
    const page = files.get("config.html").toString();
    assert.match(page, /<script>/);
    assert.doesNotMatch(page, /__jellyfin_plugin_dev|EventSource/);
});
