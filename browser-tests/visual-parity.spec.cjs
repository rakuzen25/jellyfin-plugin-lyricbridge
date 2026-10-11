const { test, expect } = require("playwright/test");
const path = require("node:path");
const { demo } = require("./demo-fixture.cjs");
// Baselines were captured from the pre-extraction web ZIP using the same
// synthetic, seekable media fixture. Override is used only to recapture them.
test("paused multilingual playback and settings preserve the visual baseline", async ({ page, browserName }) => {
    // Keep the pre-extraction capture's artwork grace period independent of host load.
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("lyricbridge.renderer.accent", "ruby"));
    const root = process.env.LYRICBRIDGE_VISUAL_BASELINE_ROOT;
    await demo(page, root ? { root: path.resolve(root) } : {});
    await page.waitForSelector(".ak-enhanced-line .lb-pronunciation");
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
