const { expectPlaybackPreview } = require("./preview-assertions.cjs");
const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");

test("preview Return and Escape restore playback and focus; apply remains in the source panel", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.waitForFunction(() => document.querySelector("audio").readyState >= 2);
    await page.locator("audio").evaluate((audio) => {
        audio.pause();
        audio.currentTime = 7;
    });
    await expect.poll(() => page.locator("audio").evaluate((audio) => audio.currentTime)).toBe(7);
    async function search() {
        if (!(await page.getByRole("dialog", { name: "Lyrics settings", exact: true }).isVisible()))
            await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
        await page.getByRole("tab", { name: "Versions", exact: true }).click();
        await page.locator('[data-song-kind="original"]').getByRole("button", { name: "Search versions", exact: true }).click();
        await page.locator(".lb-result").first().click();
    }
    await search();
    await page.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await expect(page.locator(".lb-search")).toBeHidden();
    await expectPlaybackPreview(page, "Return to results");
    await page.getByRole("button", { name: "Return to results", exact: true }).click();
    await expect(page.locator(".lb-search")).toBeVisible();
    await page.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await page.locator("audio").evaluate((audio) => {
        audio.currentTime = 19;
    });
    await page.keyboard.press("Escape");
    expect(await page.locator("audio").evaluate((audio) => Math.abs(audio.currentTime - 19))).toBeLessThan(0.2);
    await expect(page.getByRole("button", { name: "Preview with playback", exact: true })).toBeFocused();
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.getByRole("button", { name: "Use this version", exact: true }).click();
    await expect(page.locator('[data-operation="action:status"]')).toHaveText("Lyric version saved");
    await expect(page.locator('[data-operation="action:status"]')).toBeHidden({ timeout: 6000 });
});

test("settings remain inside the viewport with keyboard tab navigation and reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await demo(page);
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    const tab = page.getByRole("tab", { name: "Display", exact: true });
    await tab.focus();
    await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const bounds = await page.locator(".lb-popup").boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".lb-popup")).toHaveCount(0);
    await expect(page.locator(".lb-settings-trigger")).toBeFocused();
});

test("preview bar stays anchored through playback, document and nested lyric scrolling", async ({ page }, info) => {
    await demo(page);
    await page.addStyleTag({
        content: "body { min-height: 2400px; } .lyricPage { min-height: 1800px; isolation: isolate; transform: translateZ(0); }",
    });
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    await page.locator('[data-song-kind="original"]').getByRole("button", { name: "Search versions", exact: true }).click();
    await page.locator(".lb-result").first().click();
    await page.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await expectPlaybackPreview(page, "Return to results");
    const bar = page.locator(".lb-preview-playback-bar"),
        before = await bar.boundingBox();
    await page.locator("audio").evaluate(async (audio) => {
        audio.currentTime = 19;
        await audio.play();
    });
    await expect.poll(() => page.locator("audio").evaluate((audio) => audio.currentTime)).toBeGreaterThan(19.1);
    expect(Math.abs((await bar.boundingBox()).y - before.y)).toBeLessThan(2);
    await page.locator("audio").evaluate((audio) => audio.pause());
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect.poll(async () => Math.abs((await bar.boundingBox()).y - before.y)).toBeLessThan(2);
    await expectPlaybackPreview(page, "Return to results");
    await page.keyboard.press("Escape");
    await expect(page.locator(".lb-search")).toBeVisible();
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        const host = document.querySelector(".lyricPage");
        const viewport = document.createElement("div");
        viewport.id = "preview-scrollport";
        Object.assign(viewport.style, {
            position: "fixed",
            left: "0",
            right: "0",
            top: "100px",
            height: "250px",
            overflowY: "auto",
            transform: "translateZ(0)",
        });
        host.before(viewport);
        viewport.append(host);
    });
    await page.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await expectPlaybackPreview(page, "Return to results");
    const nested = await bar.boundingBox();
    await page.evaluate(() => (document.getElementById("preview-scrollport").scrollTop = 500));
    await expect.poll(async () => Math.abs((await bar.boundingBox()).y - nested.y)).toBeLessThan(2);
    await expectPlaybackPreview(page, "Return to results");
    await page.screenshot({ path: info.outputPath("playback-preview-overlay.png") });
    await page.locator("audio").evaluate((audio) => audio.play());
    await page.getByRole("button", { name: "Return to results", exact: true }).click();
    await expect(page.getByRole("button", { name: "Preview with playback", exact: true })).toBeFocused();
    expect(await page.locator("audio").evaluate((audio) => audio.paused)).toBe(false);
    await page.locator("audio").evaluate((audio) => audio.pause());
});
