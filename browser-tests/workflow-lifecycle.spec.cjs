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
    await page.evaluate(() => (window.jobState = "settings_changed"));
    await expect(page.locator(".lb-job-progress")).toContainText("settings_changed");
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => window.jobRetried);
    await expect(page.locator(".lb-job-progress")).toHaveText("Language rows ready");
});
