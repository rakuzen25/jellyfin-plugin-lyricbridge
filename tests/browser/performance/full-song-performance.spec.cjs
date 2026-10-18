const { writeFileSync } = require("node:fs");
const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");
test.use({ deviceScaleFactor: 2 });

test("full song playback keeps inactive lines out of promoted animation layers", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "LayerTree and retained heap measurements require Chromium CDP.");
    test.setTimeout(60000);
    await demo(page, {
        transformHtml: (html) =>
            html
                .replace(
                    'let scenario = "ready",',
                    'texts.splice(0, texts.length, ...Array.from({length:120},(_,i)=>["なんか皆さんはい歌声が夜空に響く一緒に歩いて行こう"+i,"nanka minasan hai","合唱的声音响彻夜空" ])); let scenario = "ready",',
                )
                .replace(
                    /cues: \[\.\.\.text\]\.map\(\(char, j\) => \{[\s\S]*?\}\),/,
                    "cues: [{position:0,endPosition:text.length,start,end:start+50000000}],",
                ),
    });
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(121, { timeout: 30000 });
    await page.route("**/Items/*/Images/Primary?*", (route) =>
        route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#993377"/></svg>',
        }),
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("LayerTree.enable");
    let layers = [];
    cdp.on("LayerTree.layerTreeDidChange", (event) => {
        layers = event.layers || [];
    });
    await page.evaluate(async () => {
        const audio = document.querySelector("audio");
        audio.src = "/Audio/11111111111111111111111111111111/demo.wav";
        audio.load();
        await audio.play();
    });
    await page.waitForFunction(() => window.JellyfinLyricMotion.performance().atmosphereRendering?.renderedFrames > 2);
    const backgroundBefore = await page.evaluate(() => window.JellyfinLyricMotion.performance().atmosphereRendering.renderedFrames);
    await cdp.send("HeapProfiler.collectGarbage");
    const read = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const first = await read();
    await page.waitForTimeout(6000);
    await cdp.send("HeapProfiler.collectGarbage");
    const last = await read();
    expect(last.JSHeapUsedSize).toBeLessThan(first.JSHeapUsedSize * 1.3 + 2_000_000);
    expect(last.ScriptDuration - first.ScriptDuration).toBeLessThan(3);
    const rendering = await page.evaluate(() => window.JellyfinLyricMotion.performance());
    expect(rendering.animationLoopErrors).toBe(0);
    expect(rendering.atmosphereRendering.renderedFrames).toBeGreaterThan(backgroundBefore);
    expect(Math.max(rendering.atmosphereRendering.warpWidth, rendering.atmosphereRendering.warpHeight)).toBeLessThanOrEqual(800);
    await expect(page.locator(".lyricsLine:not(.ak-current):not(.ak-motion-handoff) .ak-glow-layer").first()).toBeHidden();
    const report = testInfo.outputPath("full-song-performance.json");
    writeFileSync(
        report,
        JSON.stringify(
            {
                first,
                last,
                layers: layers.length,
                layerPixelBytes: layers.reduce((sum, layer) => sum + layer.width * layer.height * 4, 0),
                rendering,
            },
            null,
            2,
        ),
    );
    await testInfo.attach("full-song-performance.json", { contentType: "application/json", path: report });
});
