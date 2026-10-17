const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");
function fixture(html) {
    return html.replace(
        "const path = new URL(request.url).pathname;",
        `const path = new URL(request.url).pathname;
        if(path.endsWith('/transcription')) return new Response(JSON.stringify({configured:true,canTranscribe:true,canUse:true,options:[{id:'audio-choice',name:'Audio fixture',provider:'AI',capability:'transcription',model:'fixture',status:'Ready',maxInputMb:256,maxUploadMb:25}],reviewOptions:[]}));
        if(path.endsWith('/transcriptions') || path.endsWith('/transcription-uploads')) return new Response('[]');
        if(path.endsWith('/select') && window.holdSelection) return new Promise(resolve => {window.releaseSelection=()=>resolve(new Response(null,{status:204}));});
        if (path.endsWith('/export/preview')) {
            const input = await request.json();
            if(window.holdPreview) return new Promise(resolve => {window.finishPreview=()=>resolve(new Response(JSON.stringify({fileName:'lyrics.zip',fingerprint:'late',files:[],warnings:[],hasTranslation:true,hasPronunciation:true})));});
            return new Response(JSON.stringify({fileName:'lyrics.zip',fingerprint:JSON.stringify(input),files:[{fileName:'lyrics.lrc',text:'[00:01.000]Hello',bytes:1500}],warnings:[{code:'ends_discarded',message:'Explicit word ends are not preserved.'}],hasTranslation:true,hasPronunciation:true}));
        }
    `,
    );
}
async function settings(page) {
    const panel = page.getByRole("dialog", { name: "Lyrics settings", exact: true });
    if (!(await panel.isVisible())) await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await panel.getByRole("tab", { name: "Versions", exact: true }).click();
    return panel;
}
async function launch(page, action) {
    const parent = await settings(page);
    const trigger = parent.getByRole("button", { name: action, exact: true }).first();
    if (action === "Import lyrics") {
        const chooser = page.waitForEvent("filechooser");
        await trigger.click();
        await (await chooser).setFiles([]);
    } else await trigger.click();
    return page.getByRole("dialog", { name: action === "Search versions" ? "Search versions" : action, exact: true });
}
test("@layout all lyric workflows share non-modal chrome, fixed footers, and return to Versions", async ({ page }, testInfo) => {
    await demo(page, { transformHtml: fixture });
    await page.waitForSelector(".ak-enhanced-line");
    for (const action of ["Search versions", "Import lyrics", "Export lyrics", "Transcribe audio"]) {
        const panel = await launch(page, action);
        await expect(panel).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await expect(panel).not.toHaveAttribute("aria-modal", "true");
        await expect(panel.locator(":scope > .lb-dialog-body")).toHaveCount(1);
        await expect(panel.locator(":scope > .lb-dialog-feedback")).toHaveCount(1);
        await expect(panel.locator(":scope > .lb-dialog-footer")).toHaveCount(1);
        await expect(panel.locator(".lb-popup-header").getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
        if (action === "Import lyrics") await expect(panel.locator(":scope > .lb-dialog-feedback")).toBeHidden();
        const spacing = await panel.evaluate((root) => {
            const style = (node) => getComputedStyle(node);
            return {
                shellGap: style(root).gap,
                bodyGap: style(root.querySelector(".lb-dialog-body")).gap,
                footerGap: style(root.querySelector(".lb-dialog-footer")).gap,
                footerPadding: style(root.querySelector(".lb-dialog-footer")).paddingTop,
                fields: [...root.querySelectorAll(".lb-field")]
                    .filter((node) => node.getClientRects().length)
                    .map((node) => ({ gap: style(node).gap, top: style(node).paddingTop, bottom: style(node).paddingBottom })),
            };
        });
        expect(spacing.shellGap).toBe("12px");
        expect(spacing.bodyGap).toBe("12px");
        expect(spacing.footerGap).toBe("8px");
        expect(spacing.footerPadding).toBe("12px");
        for (const field of spacing.fields) expect(field).toEqual({ gap: "8px", top: "0px", bottom: "0px" });
        const box = await panel.boundingBox(),
            viewport = page.viewportSize();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        if (action === "Export lyrics") {
            await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
            const top = await panel.locator(".lb-dialog-body").evaluate((body) => ({
                scroll: body.scrollTop,
                edge: body.getBoundingClientRect().top,
                heading: body.querySelector("h3").getBoundingClientRect().top,
            }));
            expect(top.scroll).toBe(0);
            expect(top.heading).toBeGreaterThanOrEqual(top.edge + 4);
        }
        if (action === "Transcribe audio")
            await expect(panel.getByRole("heading", { name: "Saved transcription results", exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(action.toLowerCase().replaceAll(" ", "-") + ".png") });
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
        const restored = page.getByRole("dialog", { name: "Lyrics settings", exact: true });
        await expect(restored.getByRole("tab", { name: "Versions", exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(restored.getByRole("button", { name: action, exact: true }).first()).toBeFocused();
    }
});
test("@workflow closing restores the settings scroll and Escape closes only the active dialog", async ({ page }) => {
    await demo(page, { transformHtml: fixture });
    await page.waitForSelector(".ak-enhanced-line");
    const parent = await settings(page);
    await parent.locator(".lb-panel-body").evaluate((node) => {
        node.scrollTop = 90;
    });
    await page.evaluate(() =>
        document.addEventListener(
            "click",
            () => {
                window.launchScroll = document.querySelector(".lb-settings-panel .lb-panel-body")?.scrollTop;
            },
            { capture: true, once: true },
        ),
    );
    await parent.getByRole("button", { name: "Export lyrics", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Export lyrics", exact: true });
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await page.locator("audio").evaluate((audio) => {
        audio.tabIndex = 0;
        audio.focus();
    });
    await expect(page.locator("audio")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(parent).toBeVisible();
    expect(await parent.locator(".lb-panel-body").evaluate((node) => node.scrollTop)).toBe(await page.evaluate(() => window.launchScroll));
    await expect(parent.getByRole("button", { name: "Export lyrics", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(parent).toHaveCount(0);
});
test("@workflow export keeps controls and focus stable and exposes compact details", async ({ page }) => {
    await demo(page, { transformHtml: fixture });
    await page.waitForSelector(".ak-enhanced-line");
    const panel = await launch(page, "Export lyrics");
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
    await expect(panel).toContainText("1.5 KB");
    await expect(panel.locator(".lb-export-file")).not.toHaveAttribute("open");
    await panel.getByLabel("File layout", { exact: true }).selectOption("zip");
    const checkbox = panel.getByLabel("Include current translation", { exact: true });
    await expect(checkbox).toBeEnabled();
    await checkbox.evaluate((node) => {
        window.translationControl = node;
    });
    await checkbox.focus();
    await checkbox.check();
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await expect(checkbox).toBeFocused();
    expect(await checkbox.evaluate((node) => node === window.translationControl)).toBe(true);
    await expect(panel).toContainText("even when companion files are unchecked");
    await expect(panel.locator(".lb-dialog-footer .lb-feedback")).toContainText("1 format limitation");
    await panel.locator(".lb-export-file summary").click();
    await expect(panel.locator(".lb-export-text")).toBeVisible();
    await panel.getByLabel("Include lossless copy").uncheck();
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await expect(panel.locator(".lb-export-file")).toHaveAttribute("open", "");
});
test("@workflow navigation discards dialog return state and late previews cannot reopen settings", async ({ page }) => {
    await demo(page, { transformHtml: fixture });
    await page.waitForSelector(".ak-enhanced-line");
    const panel = await launch(page, "Export lyrics");
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await page.evaluate(() => {
        window.holdPreview = true;
    });
    await panel.getByLabel("Format", { exact: true }).selectOption("txt");
    await expect.poll(() => page.evaluate(() => !!window.finishPreview)).toBe(true);
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => window.finishPreview());
    await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("@workflow Search blocks dismissal while saving and restores refreshed Versions afterward", async ({ page }) => {
    await demo(page, { transformHtml: fixture });
    await page.waitForSelector(".ak-enhanced-line");
    const panel = await launch(page, "Search versions");
    await panel.locator(".lb-result").first().click();
    await page.evaluate(() => {
        window.holdSelection = true;
    });
    await panel.getByRole("button", { name: "Use this version", exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!window.releaseSelection)).toBe(true);
    await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await page.evaluate(() => window.releaseSelection());
    await expect(panel).toHaveCount(0);
    const parent = page.getByRole("dialog", { name: "Lyrics settings", exact: true });
    await expect(parent.getByRole("tab", { name: "Versions", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(parent.locator('[data-song-kind="original"]').getByRole("button", { name: "Search versions", exact: true })).toBeFocused();
});
test("@workflow changing account discards the suspended settings and pending workflow", async ({ page }) => {
    await demo(page, { transformHtml: fixture });
    await page.waitForSelector(".ak-enhanced-line");
    const panel = await launch(page, "Export lyrics");
    await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeEnabled();
    await page.evaluate(() => {
        window.holdPreview = true;
    });
    await panel.getByLabel("Format", { exact: true }).selectOption("txt");
    await expect.poll(() => page.evaluate(() => !!window.finishPreview)).toBe(true);
    await page.evaluate(() => fetch("/Audio/11111111111111111111111111111111/Lyrics", { headers: { "X-Emby-Token": "another-account" } }));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => window.finishPreview());
    await expect(page.locator(".lb-settings-panel")).toHaveCount(0);
});
