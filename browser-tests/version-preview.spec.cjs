const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");

test("preview cancel restores playback and focus; apply saves the selected version", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.waitForFunction(() => document.querySelector("audio").readyState >= 2);
    await page.locator("audio").evaluate((audio) => {
        audio.pause();
        audio.currentTime = 7;
    });
    await expect.poll(() => page.locator("audio").evaluate((audio) => audio.currentTime)).toBe(7);
    async function search() {
        await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
        await page.getByRole("tab", { name: "Versions", exact: true }).click();
        await page.locator('[data-song-kind="original"]').getByRole("button", { name: "Search versions", exact: true }).click();
        await page.locator(".lb-result").first().click();
    }
    await search();
    await page.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await expect(page.locator(".lb-search")).toBeHidden();
    await page.getByRole("button", { name: "Return to results", exact: true }).click();
    await expect(page.locator(".lb-search")).toBeVisible();
    await page.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await page.locator("audio").evaluate((audio) => {
        audio.currentTime = 19;
    });
    await page.getByRole("button", { name: "Cancel preview", exact: true }).click();
    expect(await page.locator("audio").evaluate((audio) => Math.abs(audio.currentTime - 7))).toBeLessThan(0.2);
    await expect(page.locator(".lb-settings-trigger")).toBeFocused();
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await search();
    await page.getByRole("button", { name: "Use this version", exact: true }).click();
    await expect(page.locator(".lb-status")).toHaveText("Lyric version saved");
    await expect(page.locator(".lb-status")).toBeHidden({ timeout: 6000 });
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
