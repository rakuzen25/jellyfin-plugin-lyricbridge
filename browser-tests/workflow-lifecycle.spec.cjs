const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");
function intercept(code) {
    return (html) => html.replace("const path = new URL(request.url).pathname;", "const path = new URL(request.url).pathname;\n" + code);
}
async function versions(page) {
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
}
async function search(page) {
    await versions(page);
    await page.getByRole("button", { name: "Find versions", exact: true }).click();
}

test("late search admission is released without replacing a reopened search", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/search') && request.method==='POST'){
   window.searchAdmissions=(window.searchAdmissions||0)+1;
   if(window.searchAdmissions===1){window.firstAdmissionStarted=true;await new Promise(resolve=>window.releaseFirstAdmission=resolve);return new Response(JSON.stringify({id:'old-session'}));}
   return new Response(JSON.stringify({id:'new-session'}));
  }
  if(path.includes('/search/') && request.method==='DELETE'){(window.releasedSearches??=[]).push(path.split('/').at(-1));return new Response(null,{status:204});}
 `),
    });
    await search(page);
    await page.waitForFunction(() => window.firstAdmissionStarted);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await search(page);
    await expect(page.locator(".lb-result")).toHaveCount(1);
    await page.evaluate(() => window.releaseFirstAdmission());
    await expect.poll(() => page.evaluate(() => window.releasedSearches || [])).toContain("old-session");
    await expect(page.locator(".lb-search")).toBeVisible();
    await expect(page.locator(".lb-result")).toHaveCount(1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.releasedSearches || [])).toContain("new-session");
});

test("a delayed selection response cannot close controls on a different track", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/select')){window.selectionStarted=true;await new Promise(resolve=>window.releaseSelection=resolve);return new Response(null,{status:204});}
 `),
    });
    await search(page);
    await page.locator(".lb-result").first().click();
    await page.getByRole("button", { name: "Use this version", exact: true }).click();
    await page.waitForFunction(() => window.selectionStarted);
    await page.evaluate(() => fetch("/Audio/22222222222222222222222222222222/Lyrics"));
    await versions(page);
    await page.evaluate(() => window.releaseSelection());
    await expect(page.locator(".lb-popup")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.LyricBridge.rendererSnapshot().itemId)).toBe("22222222222222222222222222222222");
    await expect(page.locator(".lb-status")).not.toHaveText("Lyric version saved");
});

test("generation approval, settings change and explicit retry remain visible", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  const syntheticJob=()=>({id:'controlled-job',state:window.jobState||'pending',progress:0,request:{service:'Google',kind:'translation',language:'zh-Hans'},error:window.jobState==='settings_changed'?'Settings changed. Retry with current settings.':null});
  if(path.endsWith('/generate'))return new Response(JSON.stringify(syntheticJob()));
  if(path.endsWith('/jobs/controlled-job'))return new Response(JSON.stringify(syntheticJob()));
  if(path.endsWith('/jobs/controlled-job/retry')){window.jobState='complete';window.jobRetried=true;return new Response(null,{status:204});}
 `),
    });
    await versions(page);
    const panel = page.locator('.lb-generation[data-kind="translation"]');
    await panel.locator("summary").first().click();
    await panel.getByRole("button", { name: "Generate translation", exact: true }).click();
    await expect(page.locator(".lb-job-progress")).toContainText("pending");
    await page.locator(".lb-popup").getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".lb-job-banner").getByRole("button", { name: "Details", exact: true }).click();
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel.locator('[data-job-detail="controlled-job"]')).toBeFocused();
    await page.evaluate(() => (window.jobState = "settings_changed"));
    await expect(page.locator(".lb-job-progress")).toContainText("settings_changed");
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => window.jobRetried);
    await expect(page.locator(".lb-job-progress")).toHaveText("Language rows ready");
});

test("running generation restores on route return without accumulating polling or DOM work", async ({ page }) => {
    await demo(page, {
        url: "http://fixture.invalid/web/index.html#/lyrics",
        transformHtml: intercept(`
  const job={id:'persistent-job',state:window.persistentState||'running',progress:12,request:{service:'Google',kind:'translation',language:'zh-Hans'},error:window.persistentState==='failed'?'Synthetic failure':null};
  if(path.endsWith('/jobs/persistent-job/retry')){window.persistentState='running';return new Response(null,{status:204});}
  if(path.endsWith('/jobs'))return new Response(JSON.stringify([job]));
  if(path.endsWith('/jobs/persistent-job')){window.jobPolls=(window.jobPolls||0)+1;return new Response(JSON.stringify(job));}
 `),
    });
    await expect(page.locator(".lb-job-progress")).toContainText("running");
    await page.evaluate(() => {
        window.persistentState = "failed";
    });
    await expect(page.locator(".lb-job-progress")).toContainText("failed");
    await page.locator(".lb-job-banner").getByRole("button", { name: "Details", exact: true }).click();
    await page.locator('[data-job-detail="persistent-job"]').getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".lb-job-progress")).toContainText("running");
    await page.locator(".lb-popup").getByRole("button", { name: "Close", exact: true }).click();
    const counts = [];
    for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
            location.hash = "/home";
        });
        await expect(page.locator(".lb-job-banner")).toHaveCount(0);
        await page.evaluate(async () => {
            location.hash = "/lyrics";
            await new Promise(requestAnimationFrame);
            await fetch("/Audio/11111111111111111111111111111111/Lyrics");
        });
        await expect(page.locator(".lb-job-progress")).toContainText("running");
        await expect(page.locator(".lb-job-banner")).toHaveCount(1);
        counts.push(await page.evaluate(() => window.LyricBridge.lifecycleDiagnostics().cleanups));
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const before = await page.evaluate(() => ({
        polls: window.jobPolls,
        decorations: window.LyricBridge.metrics.decorations,
        nodes: document.querySelectorAll(".lb-tools *").length,
    }));
    await page.waitForTimeout(3200);
    const after = await page.evaluate(() => ({
        polls: window.jobPolls,
        decorations: window.LyricBridge.metrics.decorations,
        nodes: document.querySelectorAll(".lb-tools *").length,
    }));
    expect(after.polls - before.polls).toBeGreaterThanOrEqual(2);
    expect(after.polls - before.polls).toBeLessThanOrEqual(4);
    expect(after.decorations - before.decorations).toBeLessThanOrEqual(1);
    expect(after.nodes - before.nodes).toBeLessThanOrEqual(5);
});

test("cached lyrics view exit closes settings and search without a hash change", async ({ page }) => {
    await demo(page);
    await versions(page);
    await expect(page.locator(".lb-popup")).toBeVisible();
    await page.evaluate(() => document.querySelector(".lyricPage").dispatchEvent(new Event("viewbeforehide")));
    await expect(page.locator(".lb-popup")).toHaveCount(0);
    await expect(page.locator(".lb-tools")).toHaveCount(0);
    await page.evaluate(async () => {
        document.querySelector(".lyricPage").dispatchEvent(new Event("viewshow"));
        await fetch("/Audio/11111111111111111111111111111111/Lyrics");
    });
    await search(page);
    await expect(page.locator(".lb-search")).toBeVisible();
    await page.evaluate(() => document.querySelector(".lyricPage").dispatchEvent(new Event("viewbeforehide")));
    await expect(page.locator(".lb-search")).toHaveCount(0);
    await expect(page.locator(".lb-popup")).toHaveCount(0);
    await expect(page.locator(".lb-tools")).toHaveCount(0);
});
