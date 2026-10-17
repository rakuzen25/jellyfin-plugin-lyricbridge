const { expectPlaybackPreview } = require("./preview-assertions.cjs");
const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");
async function openUpload(
    page,
    file = { name: "lyrics.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:01.00]Uploaded first\n[00:02.00]Uploaded second") },
) {
    if (!(await page.getByRole("dialog", { name: "Lyrics settings", exact: true }).isVisible()))
        await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import lyrics", exact: true }).click();
    await (await chooser).setFiles(file);
    return page.getByRole("dialog", { name: "Import lyrics", exact: true });
}
function intercept(code) {
    return (html) => html.replace("const path = new URL(request.url).pathname;", "const path = new URL(request.url).pathname;\n" + code);
}
test("@layout upload preview shares controls, preserves playback until confirmation, and supports cancellation", async ({ page }, testInfo) => {
    await demo(page);
    await page.waitForSelector(".ak-enhanced-line");
    await page.locator("audio").evaluate((audio) => {
        audio.pause();
        audio.currentTime = 7;
    });
    const baseline = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    const panel = await openUpload(page);
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(panel.locator(".lb-import-preview")).toContainText("Uploaded first");
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath("upload-preview.png") });
    await panel.getByRole("button", { name: "Playback preview", exact: true }).click();
    await expect(page.locator(".ak-enhanced-line").first()).toContainText("Uploaded first");
    await expectPlaybackPreview(page, "Return to upload preview");
    await page.locator("audio").evaluate((audio) => (audio.currentTime = 12));
    await page
        .getByRole("region", { name: "Lyric version playback preview" })
        .getByRole("button", { name: "Return to upload preview", exact: true })
        .click();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    expect(await page.locator("audio").evaluate((audio) => audio.currentTime)).toBeCloseTo(12, 1);
    await panel.getByRole("button", { name: "Playback preview", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Playback preview", exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);
    const reopened = await openUpload(page);
    await expect(reopened.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await reopened.getByRole("button", { name: "Import", exact: true }).click();
    await expect(reopened).toHaveCount(0);
    await expect(page.locator(".ak-enhanced-line").first()).toContainText("Uploaded first");
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe("demo-import");
});
test("@workflow invalid upload retains selection, and encoding changes revalidate original bytes", async ({ page }) => {
    await demo(page);
    await page.waitForSelector(".ak-enhanced-line");
    const baseline = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    const panel = await openUpload(page, { name: "bad.lrc", mimeType: "text/plain", buffer: Buffer.from("[00:01.00]good\n[xx:00]bad") });
    await expect(panel.getByRole("alert")).toContainText("Line 2");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Choose another file", exact: true }).click();
    await (
        await chooser
    ).setFiles({ name: "legacy.lrc", mimeType: "text/plain", buffer: Buffer.from([91, 48, 48, 58, 48, 49, 46, 48, 48, 93, 99, 97, 102, 233]) });
    await expect(panel.getByRole("alert")).toBeVisible();
    await panel.getByLabel("Text encoding", { exact: true }).selectOption("windows-1252");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(panel.locator(".lb-import-preview")).toContainText("café");
    await panel.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.locator(".ak-enhanced-line").first()).toContainText("café");
});
test("@workflow server rejection on confirmation never reports success or changes selection", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import')) return new Response(JSON.stringify({error:{code:'invalid_import_format',message:'File changed: invalid timing.',retryable:false}}),{status:422});
    `),
    });
    await page.waitForSelector(".ak-enhanced-line");
    const baseline = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    const panel = await openUpload(page);
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Import", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("File changed");
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    await expect(page.locator(".lb-status").filter({ hasText: "Local lyrics selected" })).toHaveCount(0);
});
test("@workflow late previews cannot replace a changed encoding or reopened upload panel", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import/preview')) {
            const input=await request.clone().json();
            window.uploadDrafts??=[];window.uploadDrafts.push(input);
            if(input.encoding==='auto' && window.uploadDrafts.length===1) await new Promise(resolve=>window.releaseUpload=resolve);
        }
    `),
    });
    const panel = await openUpload(page);
    await expect.poll(() => page.evaluate(() => window.uploadDrafts?.length)).toBe(1);
    await panel.getByLabel("Text encoding", { exact: true }).selectOption("utf-8");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    const drafts = await page.evaluate(() => window.uploadDrafts);
    expect(drafts[0].fileBytes).toBe(drafts[1].fileBytes);
    await page.keyboard.press("Escape");
    const reopened = await openUpload(page);
    await expect(reopened.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await page.evaluate(() => window.releaseUpload());
    await expect(reopened.locator(".lb-import-preview .lb-preview-line")).toHaveCount(2);
});
test("@workflow file read failures and oversized files leave Import disabled", async ({ page }) => {
    await page.addInitScript(() => {
        File.prototype.arrayBuffer = async () => {
            throw new Error("Synthetic file read failure");
        };
    });
    await demo(page);
    const panel = await openUpload(page);
    await expect(panel.getByRole("alert")).toContainText("Synthetic file read failure");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "Choose another file", exact: true }).click();
    await (await chooser).setFiles({ name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(1_000_001, 120) });
    await expect(panel.getByRole("alert")).toContainText("up to 1 MB");
});

test("@workflow track changes close an upload and ignore its late preview", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import/preview')) await new Promise(resolve=>window.releaseTrackUpload=resolve);
    `),
    });
    const panel = await openUpload(page);
    await expect.poll(() => page.evaluate(() => typeof window.releaseTrackUpload)).toBe("function");
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await expect(panel).toHaveCount(0);
    await page.evaluate(() => window.releaseTrackUpload());
    await expect(page.getByRole("dialog", { name: "Import lyrics", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).not.toBe("demo-import");
});

test("@workflow binary uploads preserve bytes through preview and confirmation", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import/preview') || path.endsWith('/import')) {
            const input=await request.json();window.binaryUploads??=[];window.binaryUploads.push(input);
            const doc={...payload(),lyrics:{...payload().lyrics,hash:'binary-import',source:'Imported',lines:[{id:'binary',text:'Decoded binary lyrics',start:10000000,cues:[],translations:{},background:{id:'binary-bg',text:'Background vocal',start:10000000,cues:[],pronunciation:'Background reading',translations:{zh:'背景歌词'}}}]},canSelect:false,canGenerate:false};
            if(path.endsWith('/import/preview')) return new Response(JSON.stringify({fileName:input.fileName,format:'KRC',encoding:'UTF-8',timing:'word',lineCount:2,warnings:[],document:doc}));
            importedDemo=doc.lyrics;return new Response(null,{status:204});
        }
    `),
    });
    const bytes = Buffer.from([107, 114, 99, 49, 0, 255, 128, 233, 13, 10]);
    const panel = await openUpload(page, { name: "original.krc", mimeType: "application/octet-stream", buffer: bytes });
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(panel.locator(".lb-import-preview")).toContainText("Decoded binary lyrics");
    await expect(panel.locator(".lb-import-preview")).toContainText("Background reading");
    await expect(panel.locator(".lb-import-preview")).toContainText("背景歌词");
    expect((await page.evaluate(() => window.binaryUploads))[0].fileBytes).toBe(bytes.toString("base64"));
    await panel.getByRole("button", { name: "Import", exact: true }).click();
    await expect(panel).toHaveCount(0);
    const inputs = await page.evaluate(() => window.binaryUploads);
    expect(inputs[1]).toEqual(inputs[0]);
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe("binary-import");
});

test("@workflow long parsed files remain browsable without rendering all rows at once", async ({ page }) => {
    await demo(page);
    const contents = Array.from({ length: 201 }, (_, i) => `[00:01.00]Line ${i}`).join("\n");
    const panel = await openUpload(page, { name: "long.lrc", mimeType: "text/plain", buffer: Buffer.from(contents) });
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(panel.locator(".lb-import-preview")).not.toContainText("Line 200");
    await panel.getByRole("button", { name: "Show more lyrics", exact: true }).click();
    await panel.getByRole("button", { name: "Show more lyrics", exact: true }).click();
    await expect(panel.locator(".lb-import-preview")).toContainText("Line 200");
    await expect(panel.getByRole("button", { name: "Show more lyrics", exact: true })).toHaveCount(0);
});

test("@workflow format overrides revalidate original bytes and are retained on confirmation", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import/preview') || path.endsWith('/import')) {
            const input=await request.clone().json();window.formatUploads??=[];window.formatUploads.push(input);
            if(input.format==='auto' && path.endsWith('/import/preview')) await new Promise(resolve=>window.releaseFormatUpload=resolve);
        }
    `),
    });
    const panel = await openUpload(page, { name: "literal.txt", mimeType: "text/plain", buffer: Buffer.from("<heart>\n{hello}\n[Voice: Alice]") });
    await expect.poll(() => page.evaluate(() => typeof window.releaseFormatUpload)).toBe("function");
    await panel.getByLabel("Format", { exact: true }).selectOption("txt");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(panel.locator(".lb-import-preview")).toContainText("[Voice: Alice]");
    await page.evaluate(() => window.releaseFormatUpload());
    await expect(panel.locator(".lb-version-metadata")).toContainText("TXT");
    const uploads = await page.evaluate(() => window.formatUploads);
    expect(uploads[1].fileBytes).toBe(uploads[0].fileBytes);
    await panel.getByRole("button", { name: "Import", exact: true }).click();
    await expect(panel).toHaveCount(0);
    const confirmed = await page.evaluate(() => window.formatUploads.at(-1));
    expect(confirmed).toEqual(uploads[1]);
});

test("@layout import warnings share glass feedback and preserve full playback text", async ({ page }, testInfo) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import/preview')) {
            const input=await request.json();
            const doc={...payload(),lyrics:{...payload().lyrics,hash:'mixed-import',source:'Imported',lines:[{id:'mixed',text:'hello world goodbye',start:10000000,end:40000000,cues:[{position:6,endPosition:11,start:20000000,end:30000000}],translations:{}}]},canSelect:false,canGenerate:false};
            return new Response(JSON.stringify({fileName:input.fileName,format:'TTML',encoding:'UTF-8',timing:'word',lineCount:1,document:doc,warnings:[{code:'untimed_text_preserved',message:'Text outside timed spans was preserved without inventing word timestamps.',location:'TTML line 4'},{code:'negative_effective_time',message:'Signed timings were preserved.',location:'Line 8'}]}));
        }
    `),
    });
    const panel = await openUpload(page);
    const warning = panel.getByRole("alert");
    await expect(warning).toContainText("2 import warnings");
    await warning.locator("summary").click();
    await expect(warning).toContainText("TTML line 4");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    const bounds = await panel.boundingBox(),
        viewport = page.viewportSize();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    await panel.screenshot({ path: testInfo.outputPath("import-warnings.png") });
    await panel.getByRole("button", { name: "Playback preview", exact: true }).click();
    const played = page.locator(".ak-enhanced-line").first();
    await expect(played).toHaveAttribute("aria-label", "hello world goodbye");
    await expect(played).toContainText("hello ");
    await expect(played).toContainText(" goodbye");
    await page.getByRole("button", { name: "Return to upload preview", exact: true }).click();
    await expect(warning.locator("details")).toHaveAttribute("open", "");
});

test("@layout closing upload previews aborts their requests and late responses cannot reopen them", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import/preview')) {
            request.signal.addEventListener('abort',()=>window.previewAborted=true);
            await new Promise(resolve=>window.releaseClosedUpload=resolve);
        }
    `),
    });
    const panel = await openUpload(page);
    await expect.poll(() => page.evaluate(() => typeof window.releaseClosedUpload)).toBe("function");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.previewAborted)).toBe(true);
    await page.evaluate(() => window.releaseClosedUpload());
    await expect(page.getByRole("dialog", { name: "Import lyrics", exact: true })).toHaveCount(0);
});

test("@workflow final import cannot be dismissed while saving and failure restores its controls", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
        if(path.endsWith('/import')) {
            window.finalImport=await request.json();
            await new Promise(resolve=>window.releaseFinalImport=resolve);
            return new Response(JSON.stringify({error:{code:'invalid_import_format',message:'Import could not be saved.',issues:[{code:'invalid_import_format',message:'Unmatched auxiliary row.',location:'ytlrc.lyric / Line 2'}],issueCount:1,retryable:false}}),{status:422});
        }
    `),
    });
    const panel = await openUpload(page);
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    const hash = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    await panel.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.releaseFinalImport)).toBe("function");
    await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await page.evaluate(() => window.releaseFinalImport());
    const error = panel.getByRole("alert");
    await expect(error).toContainText("Import could not be saved");
    await error.locator("summary").click();
    await expect(error).toContainText("ytlrc.lyric / Line 2");
    await expect(panel.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(hash);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);
});
