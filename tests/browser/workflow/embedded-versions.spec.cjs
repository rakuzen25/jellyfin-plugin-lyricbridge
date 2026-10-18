const { expectPlaybackPreview } = require("../fixtures/preview-assertions.cjs");
const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");
function fixture(backgroundOnly = false) {
    return (html) =>
        html.replace(
            "window.fetch = async function (input, init) {",
            `
      const embeddedBase=payload;
      payload=function(){const d=embeddedBase();if(!d.lyrics)return d;
        d.lyrics.source='QQ Music';
        d.lyrics.lines=d.lyrics.lines.map((line,i)=>({...line,pronunciation:${backgroundOnly}?' \\u200B':i===0?'supplied romaji':null,translations:!${backgroundOnly}&&i===0?{'zh':'包含的翻译'}:{},background:i===1?{id:'background',text:'background voice',language:'ja',pronunciation:'background romaji',translations:{zh:'背景翻译'}}:null}));
        d.variants=[{key:'gap-translation',hash:d.lyrics.hash,kind:'translation',language:'zh-Hans',service:'AI fixture',model:'fixture',originType:'generated',text:{l0:'Generated first',l2:'Generated gap'}},
          {key:'gap-romaji',hash:d.lyrics.hash,kind:'pronunciation',language:'ja',service:'Kawazu',model:'fixture',originType:'local',text:{l2:'local gap'}}].map(v=>({contextBefore:0,contextAfter:0,promptVersion:1,reasoningEffort:'',...v}));
        return d;};
      window.fetch = async function (input, init) {`,
        );
}
async function versions(page) {
    if (!(await page.getByRole("dialog", { name: "Lyrics settings", exact: true }).isVisible()))
        await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
}
function table(page, kind) {
    return page.locator('[data-version-kind="' + kind + '"]');
}
function embedded(page, kind) {
    return table(page, kind).locator('[data-key="provider"]');
}

test("@layout embedded cards share Automatic usage labels and selecting them preserves gaps", async ({ page }, testInfo) => {
    await demo(page, { transformHtml: fixture() });
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    expect(
        await page.evaluate(() => {
            const doc = window.LyricBridge.current;
            return ["translation", "pronunciation"].map((kind) => window.LyricBridge.auxiliary(doc.lyrics.lines[2], kind, doc.preferences)?.text);
        }),
    ).toEqual(["Generated gap", "local gap"]);
    await versions(page);
    for (const kind of ["translation", "pronunciation"]) {
        const card = embedded(page, kind);
        await expect(card.locator("strong").first()).toHaveText("QQ Music");
        await expect(card).toContainText("Provider supplied");
        await expect(card.locator(".lb-status-badge")).toHaveText("In use · Automatic");
        await card.locator(".lb-version-toggle").click();
        await expect(card.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
        await card.scrollIntoViewIfNeeded();
        const bounds = await card.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
        await card.screenshot({ path: testInfo.outputPath("embedded-" + kind + ".png") });
        const use = card.getByRole("button", { name: "Use", exact: true });
        if (kind === "pronunciation") {
            await use.focus();
            await use.press("Enter");
        } else await use.locator("svg").click();
        await expect(embedded(page, kind).locator(".lb-status-badge")).toHaveText("In use");
    }
    await expect(page.locator(".lb-popup")).not.toContainText("Provider supplied only");
    expect(
        await page.evaluate(() => {
            const doc = window.LyricBridge.current;
            return ["translation", "pronunciation"].map((kind) => window.LyricBridge.auxiliary(doc.lyrics.lines[2], kind, doc.preferences));
        }),
    ).toEqual([null, null]);
});

test("@layout embedded background rows support preview and selected-language filtering", async ({ page }) => {
    await demo(page, { transformHtml: fixture(true) });
    await expect(page.locator(".ak-enhanced-line")).toHaveCount(6);
    await page.waitForFunction(() => document.querySelector("audio").readyState >= 2);
    await page.locator("audio").evaluate((audio) => {
        audio.pause();
        audio.currentTime = 7;
    });
    await versions(page);
    const generated = table(page, "translation").locator('[data-key="gap-translation"]');
    await generated.locator(".lb-version-toggle").click();
    await generated.getByRole("button", { name: "Use", exact: true }).click();
    const card = embedded(page, "translation");
    await card.locator(".lb-version-toggle").click();
    await card.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(card.locator(".lb-preview-block")).toContainText("背景翻译");
    await card.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await expect(page.locator(".lb-popup")).toBeHidden();
    await expectPlaybackPreview(page, "Return to versions");
    await page.getByRole("button", { name: "Return to versions", exact: true }).click();
    await expect(page.locator(".lb-popup")).toBeVisible();
    await expect.poll(() => page.locator("audio").evaluate((audio) => audio.currentTime)).toBe(7);
    await expect(generated.locator(".lb-status-badge")).toHaveText("In use");
    // Change only the translation language; pronunciation remains available on the background vocal.
    await page.locator(".lb-popup").getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(async () => {
        await fetch("/LyricBridge/items/11111111111111111111111111111111/language-preferences", {
            method: "PUT",
            body: JSON.stringify({ translationLanguage: "fr" }),
        });
        await window.LyricBridge.refreshSong(true);
    });
    await versions(page);
    await expect(embedded(page, "translation")).toHaveCount(0);
    await expect(embedded(page, "pronunciation")).toHaveCount(1);
});
