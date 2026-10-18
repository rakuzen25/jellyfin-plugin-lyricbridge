const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");

test("native fit-content rows keep short Japanese words on one line", async ({ page }) => {
    await demo(page, {
        transformHtml: (html) =>
            html
                .replace("originalSize: 40,", "originalSize: 80,")
                .replace("showTranslation: true,", "showTranslation: false,")
                .replace(
                    /cues: \[\.\.\.text\]\.map\(\(char, j\) => \{[\s\S]*?\}\),/,
                    "cues: [{ position: 0, endPosition: text.length, start, end: start + 50000000 }],",
                )
                .replace('"朝の光が窓を照らす", "asa no hikari ga mado o terasu"', '"なんか、", "nanka,"')
                .replace('"新しい道を歩こう", "atarashii michi o arukou"', '"皆さん", "minasan"')
                .replace('"Hello 世界 — مرحبا", "hello sekai — marhaban"', '"はい", "hai"')
                .replace(
                    "</style>",
                    ".lyricPage,.lyricsContainer{display:flex}.lyricPage{justify-content:center}.lyricsContainer{flex-direction:column}.lyricsLine{display:inline-block;width:fit-content}</style>",
                ),
    });
    await expect(page.locator(".lyricsLine .lb-pronunciation").first()).toBeVisible();
    const measurements = await page.locator(".lyricsLine").evaluateAll((lines) =>
        lines.slice(0, 3).map((line) => {
            const range = document.createRange();
            range.selectNodeContents(line.querySelector(".ak-word")?.firstChild || line.firstChild);
            const rects = [...range.getClientRects()];
            return {
                text: line.textContent,
                tops: rects.map((rect) => rect.top),
                fontSize: parseFloat(getComputedStyle(line).fontSize),
            };
        }),
    );
    for (const value of measurements) {
        expect(Math.max(...value.tops) - Math.min(...value.tops), JSON.stringify(value)).toBeLessThan(value.fontSize * 0.5);
    }
});
