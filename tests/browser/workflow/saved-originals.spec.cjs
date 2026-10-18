const { expectPlaybackPreview } = require("../fixtures/preview-assertions.cjs");
const { test, expect } = require("playwright/test");
const { demo } = require("../fixtures/demo-fixture.cjs");
function fixture(admin = true, delay = false) {
    return (html) =>
        html
            .replace(
                "window.fetch = async function (input, init) {",
                `
        const basePayload=payload, documents=[basePayload(),basePayload()];
        documents[1].lyrics={...documents[1].lyrics,hash:'saved-import',source:'Imported',providerId:'local',lines:documents[1].lyrics.lines.map(l=>({...l,text:'Imported '+l.text}))};
        let savedHashes=['demo-ready','saved-import'],activeOriginal='demo-ready';
        payload=function(){const d=activeOriginal?structuredClone(documents[activeOriginal==='demo-ready'?0:1]):basePayload();
          if(!activeOriginal){d.lyrics=null;d.state='cleared';d.variants=[];}
          d.canSelect=${admin};d.canDeleteOriginals=${admin};
          d.savedOriginals=savedHashes.map(hash=>({itemId:'11111111111111111111111111111111',hash,source:hash==='demo-ready'?'Demo fixture':'Imported',providerId:hash==='demo-ready'?'42':'local',title:'Morning light',artist:'Fixture',wordTimed:true,savedAt:'2026-10-11T00:00:00Z',revision:0}));return d;};
        window.fetch = async function (input, init) {`,
            )
            .replace(
                "const path = new URL(request.url).pathname;",
                `const path = new URL(request.url).pathname;
          const original=path.match(/\\/originals\\/([^/]+)(?:\\/(preview|select))?$/);
          if(original){const hash=original[1],operation=original[2];
            if(operation==='preview'){window.savedPreviewStarted=true;${delay ? "await new Promise(resolve=>window.releaseSavedPreview=resolve);" : ""}
              const d=payload();d.lyrics=structuredClone(documents[hash==='demo-ready'?0:1].lyrics);return new Response(JSON.stringify(d));}
            if(request.method==='DELETE'){window.originalDeletion=await request.json();savedHashes=savedHashes.filter(h=>h!==hash);if(activeOriginal===hash)activeOriginal=savedHashes.at(-1)||null;return new Response(JSON.stringify({sharedContentRetained:false,lyrics:payload()}));}
            if(operation==='select'){activeOriginal=hash;return new Response(JSON.stringify(payload()));}
          }
        `,
            );
}
async function versions(page) {
    if (!(await page.getByRole("dialog", { name: "Lyrics settings", exact: true }).isVisible()))
        await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
}
function saved(page) {
    return page.locator('[data-version-kind="original"]');
}

test("@layout automatic Jellyfin originals are immediately available and Use preserves them", async ({ page }, testInfo) => {
    await demo(page, {
        transformHtml: (html) =>
            fixture()(html)
                .replace("let savedHashes=", "let automaticCopy=true; let savedHashes=")
                .replace("revision:0}", "revision:0,autoSaved:hash==='demo-ready'&&automaticCopy}")
                .replace("if(operation==='select'){activeOriginal=hash;", "if(operation==='select'){automaticCopy=false;activeOriginal=hash;"),
    });
    await versions(page);
    const automatic = saved(page).locator('[data-hash="demo-ready"]');
    await expect(automatic).toContainText("Loaded from Jellyfin");
    await expect(automatic).toContainText("Saved:");
    await expect(automatic.getByRole("button", { name: "Use", exact: true })).toBeEnabled();
    await automatic.scrollIntoViewIfNeeded();
    const bounds = await automatic.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
    await automatic.screenshot({ path: testInfo.outputPath("automatic-jellyfin-original.png") });
    await automatic.getByRole("button", { name: "Use", exact: true }).click();
    await expect(automatic).toContainText("Saved original");
    await expect(automatic).not.toContainText("Loaded from Jellyfin");
    await expect(automatic.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
});

test("@workflow saved originals preview, switching, and confirmed current deletion", async ({ page }) => {
    await demo(page, { transformHtml: fixture() });
    await versions(page);
    const imported = saved(page).locator('[data-hash="saved-import"]');
    await imported.locator(".lb-version-toggle").click();
    await imported.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(imported.locator(".lb-preview-block").first()).toContainText("Imported");
    await imported.getByRole("button", { name: "Preview with playback", exact: true }).click();
    await expect(page.locator(".lb-popup")).toBeHidden();
    await expect(page.locator(".lb-preview-playback-bar")).toContainText("Previewing original · Imported");
    await expectPlaybackPreview(page, "Return to versions");
    await page.getByRole("button", { name: "Return to versions", exact: true }).click();
    await expect(page.locator(".lb-popup")).toBeVisible();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics?.hash)).toBe("demo-ready");
    await imported.getByRole("button", { name: "Use", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.LyricBridge.current.lyrics?.hash)).toBe("saved-import");
    const current = saved(page).locator('[data-hash="saved-import"]');
    await current.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(current.locator(".lb-confirmation")).toContainText("Shared content and job history are kept");
    await expect(current.locator(".lb-confirmation")).toContainText("Media files are untouched");
    await current.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.originalDeletion)).toBeUndefined();
    await current.getByRole("button", { name: "Delete", exact: true }).click();
    await current.getByRole("button", { name: "Delete saved original", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.LyricBridge.current.lyrics?.hash)).toBe("demo-ready");
    await expect(saved(page).locator(".lb-version-row")).toHaveCount(1);
    expect(await page.evaluate(() => window.originalDeletion)).toEqual({ confirmed: true, revision: 0 });
    if ((await saved(page).locator(".lb-version-toggle").getAttribute("aria-expanded")) === "false")
        await saved(page).locator(".lb-version-toggle").click();
    await expect(saved(page).getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.LyricBridge.current.lyrics?.hash)).toBe("demo-ready");
    await saved(page).getByRole("button", { name: "Delete", exact: true }).click();
    await saved(page).getByRole("button", { name: "Delete saved original", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.LyricBridge.current.lyrics)).toBeNull();
    await expect(page.locator(".lyricsContainer .lyricsLine")).toHaveCount(0);
    await expect(page.locator(".lb-tools")).toContainText("No version selected");
    await expect(page.locator(".lb-song-panel")).toContainText("No version selected");
    await page.getByRole("tab", { name: "Song", exact: true }).click();
    await page.getByRole("button", { name: "Manage versions", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Versions", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-song-kind="original"]')).toBeFocused();
});

test("@workflow forced refresh clears deleted lyrics while song controls retain focus", async ({ page }) => {
    await demo(page, { transformHtml: fixture() });
    await versions(page);
    await page.getByRole("tab", { name: "Song", exact: true }).click();
    await page.locator(".lb-song-panel").getByRole("button", { name: "Adjust timing", exact: true }).focus();
    await page.evaluate(async () => {
        for (const hash of ["saved-import", "demo-ready"])
            await fetch("/LyricBridge/items/11111111111111111111111111111111/originals/" + hash, {
                method: "DELETE",
                body: JSON.stringify({ confirmed: true, revision: 0 }),
            });
        await window.LyricBridge.refreshSong(true);
    });
    await expect(page.locator(".lb-song-panel")).toContainText("No version selected");
    await expect(page.locator(".lyricsContainer .lyricsLine")).toHaveCount(0);
    await expect(page.locator(".lb-tools")).toContainText("No version selected");
});

test("@workflow non-administrators can preview without select or delete controls", async ({ page }) => {
    await demo(page, { transformHtml: fixture(false) });
    await versions(page);
    await expect(saved(page).getByRole("button", { name: "Preview", exact: true, includeHidden: true })).toHaveCount(2);
    await expect(saved(page).getByRole("button", { name: "Use", exact: true })).toHaveCount(0);
    await expect(saved(page).getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await saved(page).locator('[data-hash="saved-import"]').locator(".lb-version-toggle").click();
    await saved(page).locator('[data-hash="saved-import"]').getByRole("button", { name: "Preview", exact: true }).click();
    await expect(saved(page).locator(".lb-preview-block").first()).toContainText("Imported");
});

test("@workflow late saved preview cannot replace another track or a disposed installation", async ({ page }) => {
    await demo(page, { transformHtml: fixture(true, true) });
    await versions(page);
    await saved(page).locator('[data-hash="saved-import"]').locator(".lb-version-toggle").click();
    await saved(page).locator('[data-hash="saved-import"]').getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(() => window.savedPreviewStarted);
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await versions(page);
    await page.evaluate(() => window.releaseSavedPreview());
    await expect(page.locator(".lb-preview-playback-bar")).toHaveCount(0);
    expect(await page.evaluate(() => window.LyricBridge.rendererSnapshot().itemId)).toBe("22222222222222222222222222222222");
    await saved(page).locator('[data-hash="saved-import"]').locator(".lb-version-toggle").click();
    await saved(page).locator('[data-hash="saved-import"]').getByRole("button", { name: "Preview", exact: true }).click();
    await page.evaluate(() => {
        window.LyricBridge.dispose();
        window.releaseSavedPreview();
    });
    await expect(page.locator(".lb-preview-playback-bar")).toHaveCount(0);
});

test("@workflow deletion invalidates an already admitted saved preview", async ({ page }) => {
    await demo(page, { transformHtml: fixture(true, true) });
    await versions(page);
    const imported = saved(page).locator('[data-hash="saved-import"]');
    await imported.locator(".lb-version-toggle").click();
    await imported.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(() => window.savedPreviewStarted);
    await imported.getByRole("button", { name: "Delete", exact: true }).click();
    await imported.getByRole("button", { name: "Delete saved original", exact: true }).click();
    await expect(saved(page).locator(".lb-version-row")).toHaveCount(1);
    await page.evaluate(() => window.releaseSavedPreview());
    await expect(page.locator(".lb-preview-playback-bar")).toHaveCount(0);
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics?.hash)).toBe("demo-ready");
});

test("@layout saved originals share auxiliary typography, card spacing and accessible action sizes", async ({ page }, testInfo) => {
    await demo(page, { transformHtml: fixture() });
    await versions(page);
    const original = saved(page).locator('[data-active="true"]');
    const auxiliary = page.locator('[data-version-kind="translation"] .lb-version-row[data-active="true"]');
    const styles = async (row) =>
        row.evaluate((element) => {
            const read = (node, properties) => {
                const style = getComputedStyle(node);
                return Object.fromEntries(properties.map((property) => [property, style[property]]));
            };
            return {
                card: read(element, ["backgroundColor", "borderTopColor", "borderTopWidth", "borderRadius", "paddingTop", "paddingRight"]),
                title: read(element.querySelector(".lb-version-summary strong"), ["fontFamily", "fontSize", "fontWeight", "lineHeight"]),
                provenance: read(element.querySelector(".lb-provenance"), ["fontSize", "lineHeight", "color"]),
                content: read(element.querySelector(".lb-version-content"), ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]),
                actions: read(element.querySelector(".lb-song-actions"), ["gap", "marginTop", "marginBottom"]),
                preview: read(element.querySelector(".lb-song-actions button"), ["fontSize", "borderRadius", "minHeight"]),
            };
        });
    expect(await styles(original)).toEqual(await styles(auxiliary));
    expect(
        await original.evaluate((element) =>
            [".lb-version-toggle", ".lb-version-content"].map((selector) => {
                const style = getComputedStyle(element.querySelector(selector));
                return [style.borderTopWidth, style.borderBottomWidth];
            }),
        ),
    ).toEqual([
        ["0px", "0px"],
        ["0px", "0px"],
    ]);
    await expect(original.locator(".lb-status-badge")).toHaveText("In use");
    await saved(page).scrollIntoViewIfNeeded();
    const bounds = await original.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
    await page.locator(".lb-popup").screenshot({ path: testInfo.outputPath("saved-originals-styling.png") });
});

test("@layout version accordions preserve one open row, stable headers and browsing focus through refresh", async ({ page }) => {
    await demo(page, { transformHtml: fixture() });
    await versions(page);
    const original = saved(page);
    const current = original.locator('[data-hash="demo-ready"] .lb-version-toggle');
    const other = original.locator('[data-hash="saved-import"] .lb-version-toggle');
    await expect(current).toHaveAttribute("aria-expanded", "true");
    const geometry = () =>
        current.evaluate((n) => {
            const s = getComputedStyle(n),
                r = n.getBoundingClientRect(),
                p = getComputedStyle(n.parentElement);
            return { height: r.height, padding: s.padding, border: p.borderWidth, radius: p.borderRadius };
        });
    const before = await geometry();
    await current.click();
    await expect(current).toHaveAttribute("aria-expanded", "false");
    expect(await geometry()).toEqual(before);
    await other.click();
    await expect(other).toHaveAttribute("aria-expanded", "true");
    await expect(current).toHaveAttribute("aria-expanded", "false");
    await other.focus();
    await page.evaluate(() => fetch("/Audio/11111111111111111111111111111111/Lyrics"));
    await expect(other).toBeFocused();
    await other.click();
    await expect(other).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("tab", { name: "Song", exact: true }).click();
    await expect(page.locator('.lb-popup [data-section="timing"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Adjust timing", exact: true }).click();
    const timing = page.locator('#ak-lyrics-timing-popover [data-section="timing"]');
    const header = timing.locator("summary");
    const closed = await header.boundingBox();
    await header.click();
    const open = await header.boundingBox();
    expect(open.height).toBe(closed.height);
    expect(open.x).toBe(closed.x);
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Display", exact: true }).click();
    const layout = page.locator(".lb-display-panel .lb-disclosure").filter({ hasText: "Text sizes and layout" });
    await layout.locator("summary").click();
    const controls = await layout
        .locator("select,input[type=number]")
        .evaluateAll((nodes) => nodes.map((n) => ({ height: getComputedStyle(n).minHeight, font: getComputedStyle(n).fontSize })));
    expect(new Set(controls.map((x) => JSON.stringify(x))).size).toBe(1);
});

test("@workflow current-only originals disable redundant preview and use", async ({ page }) => {
    await demo(page);
    await versions(page);
    const current = saved(page).locator('[data-active="true"]');
    await expect(current).toContainText("Current version");
    await expect(current.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(current.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    await expect(current.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
});

test("@workflow search versions keeps auxiliary donor mapping contextual", async ({ page }) => {
    await demo(page);
    for (const kind of ["pronunciation", "translation"]) {
        await versions(page);
        await page
            .locator('[data-song-kind="' + kind + '"]')
            .getByRole("button", { name: "Search versions", exact: true })
            .click();
        await page.locator(".lb-result").first().click();
        await expect(page.locator(".lb-search .lb-version-preview")).toContainText("Use supplied " + kind);
        await expect(page.getByRole("button", { name: "Use mapped " + kind, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Use this version", exact: true })).toHaveCount(0);
        await page.locator(".lb-search-header, .lb-search .lb-popup-header").getByRole("button", { name: "Close", exact: true }).click();
    }
});
