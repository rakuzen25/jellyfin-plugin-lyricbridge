const { test, expect } = require("playwright/test");
const path = require("node:path");
const { demo } = require("./demo-fixture.cjs");
// Baselines were captured from the pre-extraction web ZIP using the same
// synthetic, seekable media fixture. Override is used only to recapture them.
// WebKit images were individually reviewed/refreshed for Playwright 1.64's
// font rasterization and native media/checkbox controls; other engines retain
// their earlier baselines. See DEPENDENCY_UPGRADES.md.
test("paused multilingual playback and settings preserve the visual baseline", async ({ page, browserName }) => {
    // Keep the pre-extraction capture's artwork grace period independent of host load.
    const start = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(new Date(start.getTime() + 100));
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
