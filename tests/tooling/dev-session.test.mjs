import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rebuildQueue, classifyChange, proxyServer, session } from "../../scripts/dev/session.mjs";
import { compileWeb, buildWeb } from "../../frontend/build.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
}

test("watch queue batches bursts, serializes work and processes edits received during a failed build", async () => {
    const batches = [],
        errors = [];
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const queue = rebuildQueue(
        async (batch) => {
            batches.push([...batch].sort());
            if (batches.length === 1) {
                await gate;
                throw new Error("compile failure");
            }
        },
        (error) => errors.push(error.message),
        1,
    );
    queue.request("frontend");
    queue.request("backend");
    await delay(20);
    queue.request("frontend");
    queue.request("frontend");
    await delay(20);
    assert.equal(batches.length, 1);
    release();
    await delay(20);
    await queue.close();
    assert.deepEqual(batches, [["backend", "frontend"], ["frontend"]]);
    assert.deepEqual(errors, ["compile failure"]);
    queue.request("backend");
    await delay(5);
    assert.equal(batches.length, 2);
});

test("watch inputs exclude tests, dependencies and generated trees", () => {
    for (const name of ["frontend/admin/config.ts", "frontend/admin/config.html", "frontend/assets/lyricbridge.css"])
        assert.equal(classifyChange(name), "frontend");
    for (const name of ["src/Host/Api/Api.cs", "src/Host/packages.lock.json", "vendor/Helper/Helper.csproj", "Directory.Build.props"])
        assert.equal(classifyChange(name), "backend");
    for (const name of ["frontend/foo.test.ts", "frontend/node_modules/a.ts", "src/Host/obj/generated.cs", ".build/dev/a.js"])
        assert.equal(classifyChange(name), null);
});

test("proxy preserves authentication/status, supplies live assets, injects reload only into the entry page and forwards WebSockets", async (t) => {
    const upstream = http.createServer((req, res) => {
        if (req.url.includes("ConfigurationPage") && req.headers.authorization !== "fixture") {
            res.writeHead(401);
            res.end("unauthorized");
            return;
        }
        res.writeHead(200, { "Content-Type": req.url.startsWith("/web/") ? "text/html" : "application/javascript", ETag: "old" });
        res.end("<head></head><body>embedded</body>");
    });
    upstream.on("upgrade", (req, socket) => {
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n");
        socket.pipe(socket);
    });
    const port = await listen(upstream);
    const state = {
        port,
        files: new Map([
            ["config.html", Buffer.from("live config")],
            ["lyricbridge.js", Buffer.from("live script")],
        ]),
    };
    const proxy = proxyServer(state);
    const proxyPort = await listen(proxy.server);
    t.after(async () => {
        await proxy.close();
        upstream.closeAllConnections();
        await new Promise((resolve) => upstream.close(resolve));
    });
    const base = "http://127.0.0.1:" + proxyPort;
    const denied = await fetch(base + "/web/ConfigurationPage?name=lyricbridge");
    assert.equal(denied.status, 401);
    assert.equal(await denied.text(), "unauthorized");
    const config = await fetch(base + "/web/ConfigurationPage?name=lyricbridge", { headers: { authorization: "fixture" } });
    assert.equal(await config.text(), "live config");
    assert.equal(config.headers.get("etag"), null);
    const script = await fetch(base + "/LyricBridge/assets/lyricbridge.js?v=old");
    assert.equal(await script.text(), "live script");
    assert.equal(script.headers.get("cache-control"), "no-store");
    const index = await fetch(base + "/web/index.html");
    assert.match(await index.text(), /__lyricbridge_dev\/client.js/);
    const other = await fetch(base + "/web/other.html");
    assert.doesNotMatch(await other.text(), /__lyricbridge_dev/);
    const events = await fetch(base + "/__lyricbridge_dev/events");
    const reader = events.body.getReader();
    assert.match(Buffer.from((await reader.read()).value).toString(), /data: 0/);
    proxy.reload();
    assert.match(Buffer.from((await reader.read()).value).toString(), /data: 1/);
    await reader.cancel();
    const socket = net.connect(proxyPort, "127.0.0.1");
    await once(socket, "connect");
    socket.write("GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n");
    assert.match((await once(socket, "data"))[0].toString(), /101 Switching Protocols/);
    socket.write("hello");
    assert.equal((await once(socket, "data"))[0].toString(), "hello");
    socket.destroy();
    state.port = null;
    assert.equal((await fetch(base + "/health")).status, 503);
});

test("production output contains no dev client and failed compilation retains the published generation", async (t) => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "lyricbridge-build-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    for (const directory of ["frontend/admin", "frontend/assets", "vendor"]) await mkdir(path.join(fixture, directory), { recursive: true });
    for (const [file, text] of Object.entries({
        "Directory.Build.props": "<Project><LyricBridgeVersion>1.2.3</LyricBridgeVersion></Project>",
        NOTICE: "notice",
        "vendor/LUCIDE-LICENSE": "license",
        "frontend/bridge.ts": "console.log('bridge')",
        "frontend/renderer.ts": "console.log('renderer')",
        "frontend/admin/config.ts": "console.log('admin')",
        "frontend/admin/config.html": "<div><!-- LYRICBRIDGE_CONFIG_SCRIPT --></div>",
        "frontend/assets/lyricbridge.css": "body{}",
    }))
        await writeFile(path.join(fixture, file), text);
    const output = path.join(fixture, "output");
    await buildWeb(output, fixture);
    const previous = await readFile(path.join(output, "config.html"), "utf8");
    assert.match(previous, /console.log/);
    assert.doesNotMatch(previous, /__lyricbridge_dev|EventSource/);
    const files = await compileWeb(fixture);
    assert.deepEqual([...files.keys()].sort(), [
        "LUCIDE-LICENSE.txt",
        "NOTICE.txt",
        "config.html",
        "jellyfin-lyric-motion.js",
        "lyricbridge.css",
        "lyricbridge.js",
    ]);
    await writeFile(path.join(fixture, "frontend/admin/config.ts"), "syntax !!! error");
    await assert.rejects(buildWeb(output, fixture));
    assert.equal(await readFile(path.join(output, "config.html"), "utf8"), previous);
});

test("occupied dev port fails before any sandbox operation", async (t) => {
    const occupied = http.createServer();
    const port = await listen(occupied);
    t.after(() => new Promise((resolve) => occupied.close(resolve)));
    await assert.rejects(session(["--port", String(port)]), { code: "EADDRINUSE" });
});
