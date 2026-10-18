const { test, expect } = require("playwright/test");
const path = require("node:path");
const { demo } = require("../fixtures/demo-fixture.cjs");
// Original baselines predate renderer extraction. Intentional settings and
// Lucide icon updates were reviewed across all four projects; provenance and
// current asset hashes are recorded in visual-baseline-provenance.json.
test("paused multilingual playback and settings preserve the visual baseline", async ({ page, browserName }) => {
    // Keep the pre-extraction capture's artwork grace period independent of host load.
    const start = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time: start });
    // Freeze relative to the installed clock so slow browser startup cannot
    // make the requested pause time fall into the past. No fixture is loaded yet.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("lyricbridge.renderer.accent", "ruby"));
    const root = process.env.LYRICBRIDGE_VISUAL_BASELINE_ROOT;
    await demo(page, root ? { root: path.resolve(root) } : {});
    // Initialization may need an animation frame. Advance bounded virtual time
    // rather than letting slow host setup consume the artwork grace period.
    await expect
        .poll(async () => {
            await page.clock.runFor(16);
            return page.locator(".ak-enhanced-line .lb-pronunciation").count();
        })
        .toBeGreaterThan(0);
    await page.evaluate(async () => {
        await document.fonts.ready;
        const audio = document.querySelector("audio");
        await audio.play();
        audio.pause();
        audio.currentTime = 7;
        audio.dispatchEvent(new Event("seeked"));
    });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
    await page.clock.runFor(600);
    await expect(page).toHaveScreenshot("multilingual-playback.png", { animations: "disabled", maxDiffPixelRatio: 0.002 });
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Display", exact: true }).click();
    // The WebKit baseline includes the confirmed no-artwork background. Wait for
    // that state instead of racing its delayed fallback against the settings capture.
    if (browserName === "webkit") {
        await page.clock.runFor(3000);
        await page.waitForFunction(() => window.JellyfinLyricMotion.performance().atmosphereNoArtwork);
    }
    await expect(page).toHaveScreenshot("display-settings.png", { animations: "disabled", maxDiffPixelRatio: 0.002 });
});
