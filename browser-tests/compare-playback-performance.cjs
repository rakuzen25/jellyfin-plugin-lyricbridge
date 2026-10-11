/* Compare two local web-asset directories with synthetic media; no server target. */
const { chromium } = require("playwright");
const { demo } = require("./demo-fixture.cjs");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const before = process.argv[2],
    after = process.argv[3] || path.resolve(__dirname, "../dist/web");
const longSession = process.argv.includes("--long"),
    seconds = longSession ? 60 : 3,
    rounds = longSession ? 1 : 3;
if (!before) throw new Error("Supply a pre-extraction web-asset directory. No remote server is accepted.");
for (const root of [before, after])
    for (const name of ["demo.html", "lyricbridge.js", "jellyfin-lyric-motion.js"]) assert(fs.statSync(path.join(root, name)).isFile());
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const result = {};
        for (const [name, viewport] of [
            ["desktop", { width: 1280, height: 720 }],
            ["mobile", { width: 390, height: 844 }],
        ]) {
            const samples = { before: [], after: [] };
            for (let round = 0; round < rounds; round++)
                for (const [revision, root] of [
                    ["before", before],
                    ["after", after],
                ]) {
                    const context = await browser.newContext({ viewport });
                    const page = await context.newPage();
                    const errors = [];
                    page.on("pageerror", (error) => errors.push(error.message));
                    await page.addInitScript(() => {
                        // Pin both namespaces only for comparing the retained historical baseline.
                        localStorage.setItem("appleKaraokePremiumAccent", "ruby");
                        localStorage.setItem("lyricbridge.renderer.accent", "ruby");
                    });
                    await demo(page, { root: path.resolve(root) });
                    await page.waitForSelector(".ak-enhanced-line .lb-pronunciation");
                    await page.evaluate(() => document.fonts.ready);
                    if (longSession)
                        await page.route("**/Items/*/Images/Primary?*", (route) =>
                            route.fulfill({
                                contentType: "image/svg+xml",
                                body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#334455"/></svg>',
                            }),
                        );
                    const session = await context.newCDPSession(page);
                    await session.send("Performance.enable");
                    const metrics = async () =>
                        Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]));
                    const start = await metrics();
                    await page.evaluate(async () => {
                        const audio = document.querySelector("audio");
                        audio.currentTime = 1;
                        await audio.play();
                        window.comparisonFrames = 0;
                        const frame = () => {
                            window.comparisonFrames++;
                            window.comparisonFrameId = requestAnimationFrame(frame);
                        };
                        window.comparisonFrameId = requestAnimationFrame(frame);
                    });
                    const resources = [];
                    if (longSession) {
                        for (let cycle = 0; cycle < 12; cycle++) {
                            await page.evaluate(
                                async (id) => {
                                    const view = document.querySelector(".lyricPage");
                                    view.dispatchEvent(new Event("viewbeforehide", { bubbles: true }));
                                    await fetch("/Audio/" + id + "/Lyrics");
                                    const audio = document.querySelector("audio");
                                    audio.src = "/Audio/" + id + "/demo.wav";
                                    audio.load();
                                    view.dispatchEvent(new Event("viewshow", { bubbles: true }));
                                    await audio.play();
                                    audio.currentTime = 1;
                                },
                                (cycle + 0x334455).toString(16).padStart(32, "0"),
                            );
                            await page.waitForTimeout(5000);
                            resources.push(await page.evaluate(() => window.JellyfinLyricMotion.lifecycleResources()));
                        }
                    } else await page.waitForTimeout(seconds * 1000);
                    const end = await metrics();
                    samples[revision].push({
                        scriptMs: 1000 * (end.ScriptDuration - start.ScriptDuration),
                        layoutMs: 1000 * (end.LayoutDuration - start.LayoutDuration),
                        resources,
                        frames:
                            (await page.evaluate(() => {
                                cancelAnimationFrame(window.comparisonFrameId);
                                return window.comparisonFrames;
                            })) /
                            (end.Timestamp - start.Timestamp),
                    });
                    assert.deepEqual(errors, []);
                    await context.close();
                }
            result[name] = Object.fromEntries(
                ["before", "after"].map((revision) => [
                    revision,
                    Object.fromEntries(
                        ["scriptMs", "layoutMs", "frames"].map((metric) => [metric, median(samples[revision].map((sample) => sample[metric]))]),
                    ),
                ]),
            );
            for (const revision of ["before", "after"]) result[name][revision].resources = samples[revision].map((sample) => sample.resources);
            for (const metric of ["scriptMs", "layoutMs"])
                assert(
                    result[name].after[metric] <= Math.max(result[name].before[metric] * 1.5, result[name].before[metric] + 50),
                    `${name} ${metric} regression`,
                );
        }
        console.log(
            JSON.stringify(
                {
                    fixture: longSession
                        ? "60-second playback with 12 artwork/track/view transitions; one alternating trial per revision and viewport"
                        : "three-second multilingual playback; three alternating trials per revision",
                    metrics: result,
                },
                null,
                2,
            ),
        );
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
