const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");

// Real elapsed playback, synthetic media and local images. No application server.
test("sustained playback and view transitions keep owned work bounded", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "CDP performance metrics are Chromium-only; lifecycle cases run in every engine.");
    test.setTimeout(150000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await demo(page);
    await page.route("**/Items/*/Images/Primary?*", (route) =>
        route.fulfill({
            contentType: "image/svg+xml",
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#${new URL(route.request().url()).pathname.split("/")[2].slice(-6)}"/></svg>`,
        }),
    );
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((value) => [value.name, value.value]));
    const samples = [];
    for (let cycle = 0; cycle < 12; cycle++) {
        const id = (cycle + 0x334455).toString(16).padStart(32, "0");
        await page.evaluate(async (id) => {
            await fetch("/Audio/" + id + "/Lyrics");
            const audio = document.querySelector("audio");
            audio.src = "/Audio/" + id + "/demo.wav";
            audio.load();
            await audio.play();
            audio.currentTime = 1;
        }, id);
        await expect.poll(() => page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereArtwork)).toContain(id);
        const start = await metrics();
        await page.waitForTimeout(5000);
        const end = await metrics();
        await page.evaluate(() => {
            document.querySelector(".lyricPage").dispatchEvent(new Event("viewbeforehide", { bubbles: true }));
            document.querySelector("audio").pause();
        });
        expect(await page.evaluate(() => window.JellyfinLyricMotion.artworkPendingLoads())).toBe(0);
        await page.waitForTimeout(250);
        const resources = await page.evaluate(() => window.JellyfinLyricMotion.lifecycleDiagnostics());
        samples.push({
            cycle,
            scriptMs: 1000 * (end.ScriptDuration - start.ScriptDuration),
            layoutMs: 1000 * (end.LayoutDuration - start.LayoutDuration),
            resources,
        });
        // Long-lived registrations must not grow with the number of visited tracks.
        if (cycle > 0) {
            expect(resources.cleanups).toBe(samples[0].resources.cleanups);
            expect(resources.intervals).toBe(samples[0].resources.intervals);
        }
        expect(resources.frames).toBe(0);
        expect(resources.timers).toBeLessThanOrEqual(2);
        await page.evaluate(() => document.querySelector(".lyricPage").dispatchEvent(new Event("viewshow", { bubbles: true })));
    }
    const first = samples.slice(1, 5),
        last = samples.slice(-4);
    const mean = (values, key) => values.reduce((sum, value) => sum + value[key], 0) / values.length;
    for (const key of ["scriptMs", "layoutMs"]) expect(mean(last, key)).toBeLessThanOrEqual(Math.max(mean(first, key) * 2, mean(first, key) + 150));
    const playback = await page.evaluate(() => window.JellyfinLyricMotion.performance());
    expect(playback.animationLoopErrors).toBe(0);
    const disposed = await page.evaluate(() => {
        const runtime = window.JellyfinLyricMotion;
        runtime.dispose();
        return runtime.lifecycleDiagnostics();
    });
    expect(disposed).toEqual({ disposed: true, cleanups: 0, frames: 0, timers: 0, intervals: 0 });
    expect(errors).toEqual([]);
    await testInfo.attach("long-session-performance.json", {
        contentType: "application/json",
        body: JSON.stringify({ elapsedPlaybackSeconds: 60, transitions: 12, viewport: page.viewportSize(), samples, disposed }, null, 2),
    });
});
