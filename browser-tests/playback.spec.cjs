const { test, expect } = require("playwright/test");
const assert = require("node:assert/strict");
const { demo } = require("./demo-fixture.cjs");
test("multilingual playback, settings and scrolling preserve auxiliary rows", async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await demo(page);
    await page.waitForSelector(".ak-enhanced-line .lb-pronunciation", { timeout: 20000 });
    assert.equal(await page.locator(".lyricsLine").count(), 6);
    assert.equal(await page.locator(".lb-status:visible").count(), 0, "routine ready status is hidden");
    assert.equal(await page.locator(".lyricsLine").first().locator(".lb-aux").count(), 2);
    assert.equal(await page.locator(".lyricsLine").last().locator(".lb-aux").count(), 0);
    assert.equal(await page.locator(".ak-background-vocal").count(), 1);
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Display", exact: true }).click();
    const originalLanguage = () => page.locator("label:visible").filter({ hasText: "Original language" }).locator("select");
    await originalLanguage().selectOption("en");
    await page.waitForFunction(() => !document.querySelector(".lb-popup")?.textContent.includes("Japanese romaji"));
    await page.waitForTimeout(700);
    await originalLanguage().selectOption("auto");
    await page.waitForFunction(() => document.querySelector(".lb-popup")?.textContent.includes("Japanese romaji"));
    await page.locator(".lb-popup details").evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
    assert.equal(await page.locator("label:visible").filter({ hasText: "Chinese translation text" }).count(), 0);
    await page.locator("label:visible").filter({ hasText: "Auxiliary row order" }).locator("select").selectOption("translation-first");
    await page.waitForFunction(() => document.querySelector(".lyricsLine .lb-aux")?.classList.contains("lb-translation"));
    await page.locator("label:visible").filter({ hasText: "Japanese romaji" }).locator("input").uncheck();
    await page.waitForFunction(() => !document.querySelector(".lyricsLine")?.querySelector(".lb-pronunciation"));
    await page.locator("label:visible").filter({ hasText: "Japanese romaji" }).locator("input").check();
    await page.locator("label:visible").filter({ hasText: "Translation language" }).locator("select:visible").selectOption("zh-Hant");
    await page.waitForFunction(() => document.querySelector(".lyricsLine .lb-translation")?.textContent.includes("戶"));
    const language = page.locator("label:visible").filter({ hasText: "Translation language" }).locator("select:visible");
    await language.selectOption("ar");
    await page.waitForSelector(".lb-translation[lang=ar]");
    assert.equal(await page.locator(".lb-translation[lang=ar]").getAttribute("dir"), "auto");
    assert.equal(await page.locator(".lb-translation[lang=ar]").innerText(), "مرحبا بالعالم");
    await language.selectOption("zh-Hans");
    await page.waitForSelector(".lb-translation[lang=zh-Hans]");
    await page.locator(".lb-popup").getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(async () => {
        const audio = document.querySelector("audio");
        await audio.play();
        audio.currentTime = 8;
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
        const audio = document.querySelector("audio");
        audio.pause();
        audio.currentTime = 20;
        audio.dispatchEvent(new Event("seeked"));
    });
    await page.waitForTimeout(500);
    assert.equal(await page.locator(".lyricsLine").first().locator(".lb-aux").count(), 2, "rows survive play/pause/seek");
    await page.locator(".lyricsLine").nth(2).hover();
    await page.mouse.wheel(0, 500);
    await page.waitForSelector(".lb-sync:not([hidden])");
    const time = await page.locator("audio").evaluate((a) => a.currentTime);
    await page.getByRole("button", { name: "Resume following the playing lyric" }).click();
    assert(Math.abs((await page.locator("audio").evaluate((a) => a.currentTime)) - time) < 0.2, "Sync does not seek");

    const diagnostics = await page.evaluate(() => window.JellyfinLyricMotion.performance());
    assert(Number.isFinite(diagnostics.measuredFps));
    assert(Array.isArray(diagnostics.currentMotionPlan));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: testInfo.outputPath("playback.png"), fullPage: true });
});

test("timing controls share settings styling and retain icon interactions", async ({ page }, testInfo) => {
    await demo(page);
    await page.waitForSelector(".ak-enhanced-line .lb-pronunciation");
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    const settings = page.locator(".lb-popup");
    const style = (node) => {
        const css = getComputedStyle(node);
        return Object.fromEntries(
            ["backgroundImage", "backgroundColor", "borderColor", "borderRadius", "color", "font", "minHeight", "padding", "gap"].map((key) => [
                key,
                css[key],
            ]),
        );
    };
    const settingsButton = await settings.getByRole("button", { name: "Adjust timing", exact: true }).evaluate(style);
    const settingsClose = await settings.getByRole("button", { name: "Close", exact: true }).evaluate(style);
    const settingsPanel = await settings.evaluate((node) => {
        const css = getComputedStyle(node);
        return { background: css.backgroundImage, radius: css.borderRadius, border: css.borderColor, font: css.font };
    });
    await settings.getByRole("button", { name: "Adjust timing", exact: true }).click();
    const timing = page.locator("#ak-lyrics-timing-popover");
    await expect(timing).toBeVisible();
    const staticIcons = await page.locator(".lb-icon").evaluateAll((nodes) =>
        nodes.map((node) => {
            const css = getComputedStyle(node);
            return [css.width, css.height, parseFloat(css.strokeWidth), node.getAttribute("aria-hidden"), node.getAttribute("focusable")];
        }),
    );
    for (const attrs of staticIcons) assert.deepEqual(attrs, ["20px", "20px", 2, "true", "false"]);
    const reset = timing.getByRole("button", { name: "Reset", exact: true });
    const minus = timing.getByRole("button", { name: "Decrease timing by 0.1 seconds", exact: true });
    const plus = timing.getByRole("button", { name: "Increase timing by 0.1 seconds", exact: true });
    const sync = timing.getByRole("button", { name: "Sync lyric to now", exact: true });
    await expect(reset).toBeDisabled();
    await expect(timing.locator(".ak-timing-current-value")).toHaveText("+0.0s");
    // A horizontal SVG path has a zero-height box in Chromium/WebKit. Dispatch on
    // the path to exercise delegation; normal button/icon clicks follow below.
    await plus.locator("svg path").first().dispatchEvent("click");
    await expect(timing.locator(".ak-timing-current-value")).toHaveText("+0.1s");
    await expect(reset).toBeEnabled();
    assert.deepEqual(await reset.evaluate(style), settingsButton);
    assert.deepEqual(await timing.getByRole("button", { name: "Close", exact: true }).evaluate(style), settingsClose);
    const timingPanel = await timing.evaluate((node) => {
        const css = getComputedStyle(node);
        return { background: css.backgroundImage, radius: css.borderRadius, border: css.borderColor, font: css.font };
    });
    // Mobile settings use sheet corners; compact timing retains the desktop panel radius.
    assert.equal(timingPanel.radius, "16px");
    assert.equal(timingPanel.background, settingsPanel.background);
    assert.equal(timingPanel.border, settingsPanel.border);
    assert.equal(timingPanel.font, settingsPanel.font);
    await minus.locator("svg").click();
    await expect(reset).toBeDisabled();
    await plus.click();
    await reset.locator("svg path").first().click();
    await expect(timing.locator(".ak-timing-current-value")).toHaveText("+0.0s");
    await sync.locator("svg circle").first().click();
    await expect(timing.getByRole("button", { name: "Tap lyric to sync…", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(timing.locator('[data-ak-timing-action="sync-one"] .lb-icon')).toHaveCount(1);
    await page.locator(".ak-enhanced-line").first().click();
    await expect(timing).toHaveCount(0);
    await page.locator(".ak-lyrics-timing-chip").click();
    await expect(sync).toHaveAttribute("aria-pressed", "false");
    await expect(sync.locator(".lb-icon")).toHaveCount(1);
    await plus.click();
    await reset.click();
    const box = await timing.boundingBox();
    const viewport = page.viewportSize();
    assert(box.x >= 0 && box.x + box.width <= viewport.width, "timing fits viewport width");
    assert(box.y >= 0 && box.y + box.height <= viewport.height, "timing fits viewport height");
    await timing.screenshot({ path: testInfo.outputPath("timing-panel.png") });
    await timing.getByRole("button", { name: "Close", exact: true }).locator("svg path").first().click();
    await expect(timing).toHaveCount(0);
    await expect(page.locator(".ak-lyrics-timing-chip")).toBeFocused();
    await page.locator(".ak-lyrics-timing-chip").click();
    await sync.click();
    await page.keyboard.press("Escape");
    await expect(timing).toHaveCount(0);
    await expect(page.locator(".lyricPage")).not.toHaveClass(/ak-timing-pick-mode/);
    await page.locator(".ak-lyrics-timing-chip").click();
    await page.locator("h1").click();
    await expect(timing).toHaveCount(0);
    await page.locator(".ak-enhanced-line").nth(2).hover();
    await page.mouse.wheel(0, 500);
    const follow = page.getByRole("button", { name: "Resume following the playing lyric" });
    await expect(follow).toBeVisible();
    await expect(follow.locator(".lb-icon")).toHaveCount(1);
    assert.deepEqual(await follow.evaluate(style), settingsButton);
    await page.screenshot({ path: testInfo.outputPath("sync-button.png") });
    const time = await page.locator("audio").evaluate((audio) => audio.currentTime);
    await follow.locator("svg circle").first().click();
    await expect(follow).toBeHidden();
    assert.equal(await page.locator("audio").evaluate((audio) => audio.currentTime), time, "Sync does not seek paused playback");
});
