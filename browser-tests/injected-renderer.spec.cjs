const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");

for (const prefix of ["", "/fixture"]) {
    test(`injected embedded assets load once and retain playback at ${prefix || "root"}`, async ({ page }) => {
        const errors = [];
        const requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
            if (request.url().includes("/LyricBridge/assets/")) requests.push(new URL(request.url()).pathname);
        });
        await demo(page, {
            url: `http://fixture.invalid${prefix}/web/index.html#/lyrics`,
            transformHtml: (html) => {
                const clean = html
                    .replace(/<link[^>]*href="(?:lyricbridge|jellyfin-lyric-motion)\.css"[^>]*>/g, "")
                    .replace(/<script[^>]*src="(?:lyricbridge|jellyfin-lyric-motion)\.js"[^>]*><\/script>/g, "");
                const tags = ["lyricbridge.css", "jellyfin-lyric-motion.css", "lyricbridge.js", "jellyfin-lyric-motion.js"].map((name) => {
                    const url = `../LyricBridge/assets/${name}?v=0123456789abcdef`;
                    return name.endsWith(".css") ? `<link rel="stylesheet" href="${url}">` : `<script defer src="${url}"></script>`;
                });
                return clean.replace(
                    "</head>",
                    `<!-- LyricBridge managed assets -->\n${tags.join("\n")}\n<!-- /LyricBridge managed assets -->\n</head>`,
                );
            },
        });
        await expect(page.locator(".ak-enhanced-line .lb-pronunciation").first()).toBeVisible();
        await expect(page.locator(".lyricsLine")).toHaveCount(6);
        expect(requests).toHaveLength(4);
        expect(new Set(requests).size).toBe(4);
        expect(requests.every((url) => url.startsWith(`${prefix}/LyricBridge/assets/`))).toBe(true);
        await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
        await expect(page.locator(".lb-popup")).toHaveCount(1);
        expect(errors).toEqual([]);
    });
}
