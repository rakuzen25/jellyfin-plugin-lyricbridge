const { test, expect } = require("playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { demo } = require("./demo-fixture.cjs");

test("late renderer consumes bridge state without intercepting transport", async ({ page }) => {
    const root = path.resolve(__dirname, "../dist/web");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const name = new URL(route.request().url()).pathname.split("/").at(-1);
        if (name === "demo.html")
            return route.fulfill({
                contentType: "text/html",
                body: fs.readFileSync(path.join(root, name), "utf8").replace('<script defer src="jellyfin-lyric-motion.js"></script>', ""),
            });
        if (["lyricbridge.js", "lyricbridge.css", "jellyfin-lyric-motion.js", "jellyfin-lyric-motion.css"].includes(name))
            return route.fulfill({ path: path.join(root, name) });
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://fixture.invalid/base/web/lyricbridge/demo.html");
    await page.waitForFunction(() => window.LyricBridge?.rendererSnapshot()?.payload?.Lyrics?.length > 0);
    await page.evaluate(() => {
        window.fixtureFetch = window.fetch;
        window.fixtureOpen = XMLHttpRequest.prototype.open;
        window.fixtureSend = XMLHttpRequest.prototype.send;
    });
    await page.addScriptTag({ url: "jellyfin-lyric-motion.js" });
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    expect(await page.evaluate(() => typeof window.AppleKaraoke)).toBe("undefined");
    expect(
        await page.evaluate(
            () =>
                window.fixtureFetch === window.fetch &&
                window.fixtureOpen === XMLHttpRequest.prototype.open &&
                window.fixtureSend === XMLHttpRequest.prototype.send,
        ),
    ).toBe(true);
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await page.waitForFunction(() => window.LyricBridge.rendererSnapshot()?.itemId === "22222222222222222222222222222222");
    expect(errors).toEqual([]);
});

test("XHR rewriting preserves base URLs, headers and request reuse", async ({ page }) => {
    const root = path.resolve(__dirname, "../dist/web");
    const received = [];
    await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        const name = url.pathname.split("/").at(-1);
        if (name === "demo.html") return route.fulfill({ path: path.join(root, name) });
        if (["lyricbridge.js", "lyricbridge.css", "jellyfin-lyric-motion.js", "jellyfin-lyric-motion.css"].includes(name))
            return route.fulfill({ path: path.join(root, name) });
        if (url.pathname.includes("/LyricBridge/items/")) {
            received.push({ path: url.pathname, token: route.request().headers()["x-emby-token"] });
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    state: "ready",
                    complete: true,
                    lyrics: { hash: "fixture", lines: [{ id: "xhr-line", text: "XHR fixture", start: 0 }] },
                    variants: [],
                    preferences: {},
                    accountPreferences: {},
                    songOverrides: {},
                }),
            });
        }
        if (url.pathname === "/base/plain") return route.fulfill({ body: "plain response" });
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://fixture.invalid/base/web/lyricbridge/demo.html");
    await page.waitForFunction(() => window.LyricBridge?.rendererSnapshot());
    const result = await page.evaluate(async () => {
        const xhr = new XMLHttpRequest();
        const get = (url) =>
            new Promise((resolve, reject) => {
                xhr.open("GET", url);
                xhr.setRequestHeader("X-Emby-Token", "synthetic-token");
                xhr.onload = () => resolve({ text: xhr.responseText, url: xhr.responseURL });
                xhr.onerror = reject;
                xhr.send();
            });
        const lyric = await get("/base/Audio/33333333333333333333333333333333/Lyrics");
        const plain = await get("/base/plain");
        return { lyric, plain };
    });
    expect(JSON.parse(result.lyric.text).Lyrics[0].Text).toBe("XHR fixture");
    expect(result.lyric.url).toContain("/base/Audio/33333333333333333333333333333333/Lyrics");
    expect(result.plain.text).toBe("plain response");
    expect(result.plain.url).toContain("/base/plain");
    expect(received).toContainEqual({ path: "/base/LyricBridge/items/33333333333333333333333333333333/lyrics", token: "synthetic-token" });
});

test("renderer disposal releases resources and supports a fresh installation", async ({ page }) => {
    const root = path.resolve(__dirname, "../dist/web");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
        const name = new URL(route.request().url()).pathname.split("/").at(-1);
        if (["demo.html", "lyricbridge.js", "lyricbridge.css", "jellyfin-lyric-motion.js", "jellyfin-lyric-motion.css"].includes(name))
            return route.fulfill({ path: path.join(root, name) });
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://fixture.invalid/base/web/lyricbridge/demo.html");
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    const resources = await page.evaluate(() => {
        const runtime = window.JellyfinLyricMotion;
        const before = runtime.lifecycleResources();
        runtime.dispose();
        runtime.dispose();
        return { before, after: runtime.lifecycleResources(), installed: !!window.JellyfinLyricMotion };
    });
    expect(resources.before).toBeGreaterThan(0);
    expect(resources.after).toBe(0);
    expect(resources.installed).toBe(false);
    await page.addScriptTag({ url: "jellyfin-lyric-motion.js" });
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    expect(await page.evaluate(() => window.JellyfinLyricMotion.lifecycleResources())).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

test("repeated renderer installation releases all owned resources", async ({ page }) => {
    const { demo } = require("./demo-fixture.cjs");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await demo(page);
    for (let cycle = 0; cycle < 8; cycle++) {
        await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
        const after = await page.evaluate(() => {
            const renderer = window.JellyfinLyricMotion;
            renderer.dispose();
            return { resources: renderer.lifecycleResources(), artwork: renderer.artworkPendingLoads() };
        });
        expect(after).toEqual({ resources: 0, artwork: 0 });
        await page.addScriptTag({ url: "jellyfin-lyric-motion.js" });
    }
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    expect(errors).toEqual([]);
});

test("bridge disposal restores transport and repeated installation does not accumulate owners", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    let expected;
    for (let index = 0; index < 4; index++) {
        const result = await page.evaluate(() => {
            const bridge = window.LyricBridge,
                resources = bridge.lifecycleDiagnostics();
            bridge.dispose();
            bridge.dispose();
            return { resources, disposed: bridge.lifecycleDiagnostics(), removed: !window.LyricBridge };
        });
        if (index) expect(result.resources.cleanups).toBe(expected);
        else expected = result.resources.cleanups;
        expect(result.removed).toBe(true);
        expect(result.disposed).toEqual({ disposed: true, cleanups: 0, frames: 0, timers: 0, intervals: 0 });
        await page.addScriptTag({ url: "http://fixture.invalid/base/web/lyricbridge/lyricbridge.js?install=" + index });
        await page.evaluate(() => fetch("/Audio/44444444444444444444444444444444/Lyrics"));
    }
    expect(await page.locator(".lb-tools").count()).toBe(1);
});
