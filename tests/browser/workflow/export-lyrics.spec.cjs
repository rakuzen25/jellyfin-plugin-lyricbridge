const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");
const fs = require("node:fs/promises");
function exportFixture(extra = "", ordinary = false) {
    return (html) =>
        html.replace("canSelect: true", ordinary ? "canSelect: false" : "canSelect: true").replace(
            "const path = new URL(request.url).pathname;",
            `const path = new URL(request.url).pathname;
        ${extra}
        if (path.endsWith('/export/preview')) {
            const body = await request.json();
            window.exportRequests = [...(window.exportRequests || []), {path, body}];
            const ext = body.format === 'lyricbridge' ? 'lyricbridge.json' : body.format;
            const fileName = 'Artist - Song.' + (body.layout === 'zip' ? 'zip' : ext);
            return new Response(JSON.stringify({fileName, fingerprint: JSON.stringify(body), files:[{fileName:'Artist - Song.'+ext, text:'[00:01.000]Exported lyrics', bytes:26}], warnings:body.format==='lyricbridge'?[]:[{code:'ends_discarded',message:'Explicit cue ends are lost.'}],hasTranslation:true,hasPronunciation:true}));
        }
        if (path.endsWith('/export')) {
            const body = await request.json(); window.lastExport = {path, body};
            if(window.failExport)return new Response(JSON.stringify({error:{code:'export_changed',message:'The lyric composition changed. Preview the export again.'}}),{status:409});
            return new Response('fixture lyric download', {headers:{'Content-Type':'application/octet-stream'}});
        }
    `,
        );
}
async function openExport(page) {
    await page.waitForSelector(".ak-enhanced-line");
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    await page.getByRole("button", { name: "Export lyrics", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export lyrics", exact: true });
    await expect(dialog.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    return dialog;
}
test("@workflow ordinary users can export ZIP companions with an optional lossless copy", async ({ page }) => {
    await demo(page, { transformHtml: exportFixture("", true) });
    const panel = await openExport(page);
    await expect(page.getByRole("button", { name: "Import lyrics", exact: true })).toHaveCount(0);
    await panel.getByLabel("File layout", { exact: true }).selectOption("zip");
    await expect(panel.getByLabel("Include current translation")).toBeEnabled();
    await panel.getByLabel("Include current translation").check();
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await panel.getByLabel("Include current pronunciation").check();
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await expect(panel.getByLabel("Include lossless copy")).toBeChecked();
    const pending = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("Artist - Song.zip");
    expect(await fs.readFile(await download.path(), "utf8")).toBe("fixture lyric download");
    const request = await page.evaluate(() => window.lastExport);
    expect(request.path).toContain("/LyricBridge/items/");
    expect(request.body).toMatchObject({ format: "lrc", layout: "zip", translation: true, pronunciation: true, losslessCopy: true });
    expect(request.body.fingerprint).toBeTruthy();
});
test("@layout export dialog adapts format options and remains within viewport", async ({ page }) => {
    await demo(page, { transformHtml: exportFixture() });
    const panel = await openExport(page);
    await expect(panel).toContainText("1 format limitation");
    await expect(panel.locator(".lb-export-file")).not.toHaveAttribute("open");
    await panel.locator(".lb-dialog-footer").getByText("Details", { exact: true }).click();
    await expect(panel).toContainText("Explicit cue ends are lost.");
    await panel.getByLabel("Format", { exact: true }).selectOption("txt");
    await panel.getByLabel("File layout", { exact: true }).selectOption("interleaved");
    await expect(panel.getByLabel("Include current translation")).toBeEnabled();
    await panel.getByLabel("Format", { exact: true }).selectOption("elrc");
    await expect(panel.getByLabel("File layout", { exact: true })).toHaveValue("original");
    await panel.getByLabel("Format", { exact: true }).selectOption("lyricbridge");
    await expect(panel.getByLabel("File layout", { exact: true })).toBeHidden();
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    const box = await panel.boundingBox(),
        viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
});
test("@workflow stale download requires a fresh preview and retains the song", async ({ page }) => {
    await demo(page, { transformHtml: exportFixture() });
    const panel = await openExport(page);
    const baseline = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    await page.evaluate(() => {
        window.failExport = true;
    });
    await panel.getByRole("button", { name: "Download", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Preview the export again");
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    await page.evaluate(() => {
        window.failExport = false;
    });
    await panel.getByRole("button", { name: "Refresh preview", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
});
test("@workflow import offers lossless JSON and exported ZIP bundle choices", async ({ page }) => {
    await demo(page);
    await page.waitForSelector(".ak-enhanced-line");
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import lyrics", exact: true }).click();
    const input = await chooser;
    await input.setFiles([]);
    const panel = page.getByRole("dialog", { name: "Import lyrics", exact: true });
    await expect(panel.getByLabel("Format", { exact: true }).locator("option[value='lyricbridge']")).toHaveCount(1);
    await expect(panel.getByLabel("Format", { exact: true }).locator("option[value='bundle']")).toHaveCount(1);
    await panel.getByLabel("Format", { exact: true }).selectOption("bundle");
    await expect(panel.getByLabel("Text encoding", { exact: true })).toBeDisabled();
});

test("@workflow navigation disposes a pending export and ignores its late preview", async ({ page }) => {
    await demo(page, {
        transformHtml: exportFixture(`
        if(path.endsWith('/export/preview') && window.delayExport) {
            const body = await request.json();
            window.exportSignal = request.signal;
            return new Promise(resolve => { window.finishExport = () => resolve(new Response(JSON.stringify({fileName:'late.lrc',fingerprint:'late',files:[{fileName:'late.lrc',text:'Late result',bytes:11}],warnings:[],hasTranslation:false,hasPronunciation:false}))); });
        }
    `),
    });
    const panel = await openExport(page);
    await page.evaluate(() => {
        window.delayExport = true;
    });
    await panel.getByLabel("Format", { exact: true }).selectOption("txt");
    await expect.poll(() => page.evaluate(() => !!window.finishExport)).toBe(true);
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => window.exportSignal.aborted)).toBe(true);
    await page.evaluate(() => window.finishExport());
    await expect(page.getByText("Late result", { exact: true })).toHaveCount(0);
});
