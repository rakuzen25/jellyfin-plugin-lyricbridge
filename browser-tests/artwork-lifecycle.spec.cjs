const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");
// Fresh identities avoid reusing artwork already admitted by demo startup.
const first = "33333333333333333333333333333333",
    second = "44444444444444444444444444444444";
const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`;
async function track(page, id) {
    await page.evaluate(async (id) => {
        await fetch("/Audio/" + id + "/Lyrics");
        const audio = document.querySelector("audio");
        audio.src = "/Audio/" + id + "/demo.wav";
        audio.load();
    }, id);
}
test("late artwork cannot replace the current track and disposal drains pending images", async ({ page }) => {
    await demo(page);
    let pending;
    await page.route("**/Items/*/Images/Primary?*", async (route) => {
        if (route.request().url().includes(first)) {
            await new Promise((resolve) => (pending = resolve));
        }
        try {
            await route.fulfill({ contentType: "image/svg+xml", body: svg(route.request().url().includes(first) ? "red" : "blue") });
        } catch (error) {
            if (!route.request().failure()) throw error;
        }
    });
    await track(page, first);
    await expect.poll(() => !!pending).toBe(true);
    await track(page, second);
    await expect.poll(() => page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereArtwork)).toContain(second);
    pending();
    await expect.poll(() => page.evaluate(() => window.JellyfinLyricMotion.artworkPendingLoads())).toBe(0);
    expect(await page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereArtwork)).toContain(second);
    const disposed = await page.evaluate(() => {
        const renderer = window.JellyfinLyricMotion;
        renderer.dispose();
        return [renderer.lifecycleResources(), renderer.artworkPendingLoads()];
    });
    expect(disposed).toEqual([0, 0]);
});

test("leaving the lyric view cancels in-flight artwork before it can commit", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    let release;
    await page.route("**/Items/*/Images/Primary?*", async (route) => {
        await new Promise((resolve) => (release = resolve));
        await route.fulfill({ contentType: "image/svg+xml", body: svg("red") }).catch(() => {});
    });
    // Hide in the same browser turn as image admission. A slow test driver cannot
    // mistake the renderer's deliberate 900ms timeout for missing admission.
    await page.evaluate((id) => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
        Object.defineProperty(HTMLImageElement.prototype, "src", {
            ...descriptor,
            set(value) {
                descriptor.set.call(this, value);
                if (String(value).includes("/Items/" + id + "/Images/Primary"))
                    queueMicrotask(() => {
                        if (window.fixtureHide) return;
                        const renderer = window.JellyfinLyricMotion;
                        const before = renderer.artworkPendingLoads();
                        document.querySelector(".lyricPage").dispatchEvent(new Event("viewbeforehide", { bubbles: true }));
                        window.fixtureHide = { before, after: renderer.artworkPendingLoads() };
                    });
            },
        });
    }, first);
    await track(page, first);
    await expect.poll(() => page.evaluate(() => window.fixtureHide)).toBeTruthy();
    const pending = await page.evaluate(() => window.fixtureHide);
    expect(pending.before).toBeGreaterThan(0);
    expect(pending.after).toBe(0);
    if (release) release();
    await expect.poll(() => page.evaluate(() => window.JellyfinLyricMotion.artworkPendingLoads())).toBe(0);
    expect(await page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereArtwork)).not.toContain(first);
});
