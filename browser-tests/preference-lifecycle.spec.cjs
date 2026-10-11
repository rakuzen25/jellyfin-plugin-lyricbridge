const { test } = require("playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
test("preference writes survive track changes", async ({ page }) => {
    const root = path.resolve(__dirname, "../dist/web");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
        const name = new URL(route.request().url()).pathname.split("/").at(-1);
        if (name === "demo.html") {
            let html = fs.readFileSync(path.join(root, name), "utf8");
            html = html.replace(
                'if (request.method === "PUT") demoPreferences = await request.json();',
                `if (request.method === "PUT") {const body=await request.json();window.savedPreferences??=[];window.savedPreferences.push(body);await new Promise(resolve=>setTimeout(resolve,300));demoPreferences=body;}`,
            );
            return route.fulfill({ body: html, contentType: "text/html" });
        }
        if (["lyricbridge.js", "lyricbridge.css", "jellyfin-lyric-motion.js", "jellyfin-lyric-motion.css"].includes(name))
            return route.fulfill({ path: path.join(root, name) });
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://fixture.invalid/web/lyricbridge/demo.html");
    await page.waitForSelector(".lb-pronunciation");
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Display", exact: true }).click();
    await page.locator(".lb-popup details").evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
    await page.locator("label").filter({ hasText: "Auxiliary row order" }).locator("select").selectOption("translation-first");
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await page.waitForFunction(() => window.savedPreferences?.length === 1);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.savedPreferences[0].rowOrder), "translation-first");
    assert.deepEqual(errors, []);
    console.log("PASS: debounced preference write survives immediate track transition and delayed response.");
});

test("failed preference saves retain edits and expose retry after a track change", async ({ page }) => {
    const root = path.resolve(__dirname, "../dist/web");
    await page.route("**/*", (route) => {
        const name = new URL(route.request().url()).pathname.split("/").at(-1);
        if (name === "demo.html") {
            const html = fs
                .readFileSync(path.join(root, name), "utf8")
                .replace(
                    'if (request.method === "PUT") demoPreferences = await request.json();',
                    `if (request.method === "PUT") {window.preferenceAttempts=(window.preferenceAttempts||0)+1;if(window.preferenceAttempts===1)return new Response('',{status:503});demoPreferences=await request.json();window.acceptedPreferences=demoPreferences;}`,
                );
            return route.fulfill({ body: html, contentType: "text/html" });
        }
        if (["lyricbridge.js", "lyricbridge.css", "jellyfin-lyric-motion.js", "jellyfin-lyric-motion.css"].includes(name))
            return route.fulfill({ path: path.join(root, name) });
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://fixture.invalid/web/lyricbridge/demo.html");
    await page.waitForSelector(".lb-pronunciation");
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Display", exact: true }).click();
    await page.locator(".lb-popup details").evaluateAll((nodes) => nodes.forEach((node) => (node.open = true)));
    await page.locator("label").filter({ hasText: "Auxiliary row order" }).locator("select").selectOption("translation-first");
    await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => window.acceptedPreferences?.rowOrder === "translation-first");
    assert.equal(await page.evaluate(() => window.preferenceAttempts), 2);
    await page.waitForFunction(() => !document.querySelector('[data-notice-key="preferences:preferences"]'));
});
