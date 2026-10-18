const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");
async function artwork(page) {
    await page.route("**/Items/*/Images/Primary?*", (route) =>
        route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#993377"/></svg>',
        }),
    );
    await page.evaluate(async () => {
        const audio = document.querySelector("audio");
        audio.src = "/Audio/11111111111111111111111111111111/demo.wav";
        audio.load();
        await audio.play();
        audio.currentTime = 1;
    });
}
test("identical and auxiliary refreshes retain original nodes and follow state", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.evaluate(() => {
        window.originalWord = document.querySelector(".ak-word");
        window.originalLine = document.querySelector(".ak-enhanced-line");
        window.JellyfinLyricMotion.applyRichPayload(window.LyricBridge.rendererSnapshot().payload, "11111111111111111111111111111111");
    });
    await page.waitForTimeout(200);
    expect(
        await page.evaluate(
            () => window.originalWord === document.querySelector(".ak-word") && window.originalLine === document.querySelector(".ak-enhanced-line"),
        ),
    ).toBe(true);
    await page.evaluate(async () => {
        await fetch("/LyricBridge/items/11111111111111111111111111111111/language-version", {
            method: "POST",
            body: JSON.stringify({ kind: "translation", key: "demo-saved-translation" }),
        });
        await window.LyricBridge.refreshSong(true);
    });
    await expect(page.locator(".lb-translation").first()).toContainText("另一种翻译");
    expect(await page.evaluate(() => window.originalWord === document.querySelector(".ak-word"))).toBe(true);
});
test("changed original cues rebuild their word geometry", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.evaluate(() => {
        window.cueWord = document.querySelector(".ak-word");
        const payload = structuredClone(window.LyricBridge.rendererSnapshot().payload);
        payload.Lyrics[0].Cues[0].End -= 1000;
        window.JellyfinLyricMotion.applyRichPayload(payload, "11111111111111111111111111111111");
    });
    await expect.poll(() => page.evaluate(() => window.cueWord !== document.querySelector(".ak-word"))).toBe(true);
});
test("forced refresh repairs missing lyric DOM", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.evaluate(async () => {
        document.querySelector(".lyricsContainer").replaceChildren();
        await window.LyricBridge.refreshSong(true);
    });
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await expect(page.locator(".lb-translation").first()).toBeVisible();
});
test("quality setting is browser-local and survives reinstall without changing originals", async ({ page }) => {
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Display", exact: true }).click();
    await page.getByText("Text sizes and layout", { exact: true }).click();
    await page.getByRole("combobox", { name: "Rendering quality", exact: true }).selectOption("low-power");
    expect(await page.evaluate(() => window.JellyfinLyricMotion.renderQuality())).toBe("low-power");
    await page.reload();
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    expect(await page.evaluate(() => window.JellyfinLyricMotion.renderQuality())).toBe("low-power");
    await page.evaluate(() => window.JellyfinLyricMotion.setRenderQuality("standard"));
    await expect(page.locator("html")).not.toHaveClass(/ak-low-power/);
});
test("low power freezes loaded artwork and pause/exit drains animation work", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Verified WebGL performance fixture uses Chromium.");
    await demo(page);
    await artwork(page);
    await page.waitForFunction(() => window.JellyfinLyricMotion.performance().atmosphereRendering?.renderedFrames > 2);
    await page.evaluate(() => window.JellyfinLyricMotion.setRenderQuality("low-power"));
    await page.waitForFunction(() => window.JellyfinLyricMotion.performance().atmosphereRendering?.renderedFrames > 0);
    const first = await page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereRendering);
    await page.waitForTimeout(1200);
    const last = await page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereRendering);
    expect(last.running).toBe(false);
    expect(last.renderedFrames).toBe(first.renderedFrames);
    expect(Math.max(last.warpWidth, last.warpHeight)).toBeLessThanOrEqual(800);
    await page.evaluate(() => document.querySelector("audio").pause());
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.JellyfinLyricMotion.lifecycleDiagnostics().frames)).toBe(0);
    await page.evaluate(() => document.querySelector(".lyricPage").dispatchEvent(new Event("viewbeforehide", { bubbles: true })));
    expect(await page.evaluate(() => window.JellyfinLyricMotion.lifecycleDiagnostics().frames)).toBe(0);
});

test("replaced media elements release their listeners instead of accumulating owners", async ({ page }) => {
    test.setTimeout(60000);
    await demo(page);
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    const counts = [];
    for (let i = 0; i < 12; i++) {
        await page.evaluate(async () => {
            const old = document.querySelector("audio");
            old.pause();
            window.retiredMedia = old;
            const next = old.cloneNode(true);
            // A cloned marker is not proof that this new element has listeners.
            next.removeAttribute("data-ak-perf-hooks");
            old.replaceWith(next);
            next.load();
            await next.play();
            window.JellyfinLyricMotion.refreshLayout();
        });
        await page.waitForFunction(() => document.querySelector("audio").dataset.akPerfHooks === "true");
        expect(await page.evaluate(() => window.retiredMedia.dataset.akPerfHooks)).toBeUndefined();
        counts.push(await page.evaluate(() => window.JellyfinLyricMotion.lifecycleDiagnostics().cleanups));
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.JellyfinLyricMotion.dispose());
    expect(await page.locator("audio").getAttribute("data-ak-perf-hooks")).toBeNull();
});
