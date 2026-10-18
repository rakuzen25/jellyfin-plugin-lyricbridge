const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");

test("seeking and version replacement leave one stable playback scheduler", async ({ page }, testInfo) => {
    await demo(page);
    await page.bringToFront();
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.evaluate(async () => {
        const media = document.querySelector("audio");
        await media.play();
        media.currentTime = 1;
    });
    await page.evaluate(() => {
        window.nativeFrames = 0;
        const frame = () => {
            window.nativeFrames++;
            window.nativeFrameId = requestAnimationFrame(frame);
        };
        window.nativeFrameId = requestAnimationFrame(frame);
    });
    const samples = [];
    for (const phase of ["normal", "seek", "replacement", "return"]) {
        if (phase === "replacement") {
            await page.evaluate(async () => {
                await fetch("/LyricBridge/items/11111111111111111111111111111111/language-version", {
                    method: "POST",
                    body: JSON.stringify({ kind: "translation", key: "demo-saved-translation" }),
                });
                await window.LyricBridge.refreshSong(true);
            });
            await expect(page.locator(".lb-translation").first()).toContainText("另一种翻译");
        }
        await page.evaluate((phase) => {
            const media = document.querySelector("audio");
            if (phase === "return") {
                const view = document.querySelector(".lyricPage");
                view.dispatchEvent(new Event("viewbeforehide", { bubbles: true }));
                view.dispatchEvent(new Event("viewshow", { bubbles: true }));
            }
            media.currentTime = 1;
            media.dispatchEvent(new Event("seeked"));
            if (phase === "seek") document.querySelector(".lyricsLine").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }, phase);
        await expect.poll(() => page.locator("audio").evaluate((media) => !media.paused && !media.seeking && media.readyState >= 2)).toBe(true);
        await page.waitForTimeout(800);
        const nativeBefore = await page.evaluate(() => window.nativeFrames);
        const start = await page.evaluate(() => window.JellyfinLyricMotion.performance());
        await page.waitForTimeout(2000);
        const end = await page.evaluate(() => window.JellyfinLyricMotion.performance());
        expect(end.animationLoopErrors).toBe(0);
        expect(end.animationLoopStarts - start.animationLoopStarts).toBeLessThanOrEqual(1);
        const nativeFrames = (await page.evaluate(() => window.nativeFrames)) - nativeBefore;
        if (nativeFrames >= 15) expect(end.renderedFrameCount - start.renderedFrameCount, JSON.stringify({ phase, start, end })).toBeGreaterThan(15);
        else
            testInfo.annotations.push({
                type: "limitation",
                description: `Native RAF supplied only ${nativeFrames} frames during ${phase}; frame-rate validation unavailable in this headless run.`,
            });
        expect(end.renderedFrameCount - start.renderedFrameCount).toBeLessThanOrEqual(nativeFrames + 5);
        samples.push({
            phase,
            nativeFrames,
            frames: end.renderedFrameCount - start.renderedFrameCount,
            resources: await page.evaluate(() => window.JellyfinLyricMotion.lifecycleDiagnostics()),
        });
    }
    await page.evaluate(() => cancelAnimationFrame(window.nativeFrameId));
    expect(samples.at(-1).resources.cleanups).toBe(samples[0].resources.cleanups);
    await testInfo.attach("playback-stability.json", { contentType: "application/json", body: JSON.stringify(samples, null, 2) });
});
