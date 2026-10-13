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
    await page.locator('[data-song-kind="original"]').getByRole("button", { name: "Search versions", exact: true }).click();
}

test("@workflow late search admission is released without replacing a reopened search", async ({ page }) => {
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

test("@workflow a delayed selection response cannot close controls on a different track", async ({ page }) => {
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

test("@workflow generation approval, settings change and explicit retry remain visible", async ({ page }) => {
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
    await page.locator('[data-song-kind="translation"]').getByRole("button", { name: "Generate translation", exact: true }).click();
    await panel.getByRole("button", { name: "Start generation", exact: true }).click();
    await expect(page.locator(".lb-job-progress")).toContainText("pending");
    await page.locator(".lb-popup").getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".lb-job-banner").getByRole("button", { name: "Details", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-job-detail="controlled-job"]')).toBeFocused();
    await page.evaluate(() => (window.jobState = "settings_changed"));
    await expect(page.locator(".lb-job-progress")).toContainText("settings_changed");
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await page.waitForFunction(() => window.jobRetried);
    await expect(page.locator(".lb-job-progress")).toHaveText("Language rows ready");
});

test("@workflow running generation restores on route return without accumulating polling or DOM work", async ({ page }) => {
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

test("@workflow cached lyrics view exit closes settings and search without a hash change", async ({ page }) => {
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

test("@layout generation banner keeps status above a single action row without nested borders", async ({ page }, testInfo) => {
    await demo(page, {
        transformHtml: intercept(`
      const job={id:'layout-job',state:'running',progress:12,request:{service:'Google',kind:'translation',language:'zh-Hans'}};
      if(path.endsWith('/jobs'))return new Response(JSON.stringify([job]));
      if(path.endsWith('/jobs/layout-job'))return new Response(JSON.stringify(job));
    `),
    });
    await expect(page.locator(".lb-job-progress")).toContainText("Google · running · 12%");
    const banner = page.locator(".lb-job-banner");
    const status = await banner.locator(".lb-job-progress").boundingBox();
    const details = await banner.getByRole("button", { name: "Details", exact: true }).boundingBox();
    const cancel = await banner.getByRole("button", { name: "Cancel request", exact: true }).boundingBox();
    const dismiss = await banner.getByRole("button", { name: "Dismiss", exact: true }).boundingBox();
    expect(details.y).toBeGreaterThanOrEqual(status.y + status.height);
    expect(Math.abs(details.y - cancel.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(details.y - dismiss.y)).toBeLessThanOrEqual(1);
    expect(details.height).toBeGreaterThanOrEqual(44);
    expect(dismiss.x + dismiss.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(await banner.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
    await page.locator(".lb-tools").screenshot({ path: testInfo.outputPath("generation-two-lines.png") });
});

test("@workflow repeated search status retains one icon", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if (/\\/LyricBridge\\/items\\/[^/]+\\/lyrics$/.test(path)) return new Response(JSON.stringify({...payload(),state:'searching',finished:3,total:6}));
 `),
    });
    const status = page.locator(".lb-status");
    await expect(status).toContainText("Searching");
    await expect(status.locator(".lb-icon")).toHaveCount(1);
    await page.waitForTimeout(1600);
    await expect(status.locator(".lb-icon")).toHaveCount(1);
});

test("@layout stopped search keeps source failures compact and expandable", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if (path.includes('/LyricBridge/search/') && request.method==='GET') return new Response(JSON.stringify({state:'cancelled',finished:6,total:6,candidates:[],errors:[{code:'provider_timeout',message:'Fixture provider timed out',retryable:true}],recommended:null}));
 `),
    });
    await search(page);
    await expect(page.locator(".lb-search-status")).toContainText("search stopped");
    const failures = page.locator(".lb-search-failures");
    await expect(failures.locator("summary")).toContainText("1 source unavailable");
    expect(await failures.evaluate((element) => getComputedStyle(element).marginBlockStart)).toBe("0px");
    expect(await failures.evaluate((element) => getComputedStyle(element).flexBasis)).toBe("auto");
    await failures.locator("summary").click();
    await expect(failures).toHaveAttribute("open", "");
    await expect(failures).toContainText("Fixture provider timed out");
});

test("@workflow auxiliary version metadata uses labelled rows and one generation disclosure", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if (path.endsWith('/lyrics')) {
    const data=payload();
    data.variants=[
      {key:'local-pronunciation',hash:data.lyrics.hash,kind:'pronunciation',language:'ja',service:'Kawazu',model:'1.1.4/Hepburn',originType:'local'},
      {key:'generated-translation',hash:data.lyrics.hash,kind:'translation',language:'zh',service:'Google',model:'fixture-model',originType:'generated'}
    ].map(v=>({...v,text:{l0:'fixture'},contextBefore:0,contextAfter:0,reasoningEffort:'',promptVersion:1,createdAt:'2026-10-13T12:00:00Z'}));
    return new Response(JSON.stringify(data));
  }
 `),
    });
    await versions(page);
    for (const [key, model] of [
        ["local-pronunciation", "1.1.4/Hepburn"],
        ["generated-translation", "fixture-model"],
    ]) {
        const row = page.locator(`.lb-version-row[data-key="${key}"]`);
        await row.locator(".lb-version-toggle").click();
        await expect(row.locator(".lb-version-metadata")).toHaveText([`Model: ${model}`, "Saved: 10/13/2026"]);
        await expect(row.locator(".lb-provenance")).not.toContainText(model);
    }
    await expect(page.locator(".lb-generation-trigger")).toHaveCount(2);
    await expect(page.locator(".lb-generation > summary")).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "Generate translation", exact: true });
    const setup = page.locator('.lb-generation[data-kind="translation"]');
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const method = setup.getByLabel("Generation method");
    await method.selectOption("Google");
    await setup.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(setup).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(method).toHaveValue("Google");
    await expect(setup.getByRole("button", { name: "Start generation", exact: true })).toBeVisible();
});

test("@layout final ranking preserves preview and exposes the upgrade in search", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  const searchCandidate=(id,score)=>({source:'QQ',id,title:id,artist:'Artist',score,verification:'verified',assessment:{...demoAssessment(),score}});
  if(path.includes('/LyricBridge/search/') && request.method==='GET') {
    window.searchReads=(window.searchReads||0)+1;
    return new Response(JSON.stringify({state:window.finishSearch?'complete':'searching',finished:window.finishSearch?2:1,total:2,
      candidates:[searchCandidate('weak',90),...(window.secondResult?[searchCandidate('best',100)]:[])],errors:[],
      recommended:window.finishSearch?'QQ:best':null,
      improvement:window.finishSearch?{key:'QQ:best',hash:'improved',baselineHash:payload().lyrics.hash,reason:'auxiliary-completeness',description:'Translation: 90% → 100%; pronunciation: 0% → 100%.'}:null}));
  }
  if(path.endsWith('/upgrade')) {window.upgradeRequest=new URL(request.url).search;return new Response(null,{status:204});}
  if(window.finishSearch && path.includes('/LyricBridge/items/') && request.method==='GET') {
    const value=payload();value.better={...value.lyrics,hash:'improved',source:'QQ',providerId:'best'};
    value.improvement={baselineHash:value.lyrics.hash,reason:'auxiliary-completeness',description:'More complete supplied rows'};
    return new Response(JSON.stringify(value));
  }
 `),
    });
    await search(page);
    const rows = page.locator(".lb-result");
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Sort by best match", exact: true })).toHaveCount(0);
    await rows.first().click();
    await expect(page.getByRole("button", { name: "Preview with playback", exact: true })).toBeVisible();
    const firstLine = await page.locator(".lb-preview-line").first().textContent();
    await page.evaluate(() => {
        window.secondResult = true;
    });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-key", "QQ:weak");
    await page.getByRole("button", { name: "Preview with playback", exact: true }).focus();
    await page.evaluate(() => {
        window.finishSearch = true;
    });
    await expect(rows.first()).toHaveAttribute("data-key", "QQ:best");
    await expect(page.getByRole("button", { name: "Preview with playback", exact: true })).toBeFocused();
    await expect(page.locator(".lb-preview-line").first()).toHaveText(firstLine);
    await expect(rows.first().locator(".lb-recommended")).toHaveText("Better than current");
    await expect(rows.first().locator(".lb-improvement-reason")).toContainText("Why it’s better:");
    const back = page.getByRole("button", { name: "Back to results", exact: true });
    if (await back.isVisible()) await back.click();
    await expect(rows.first().locator(".lb-improvement-reason")).toBeVisible();
    await expect(page.locator(".lb-upgrade")).toHaveCount(0);
    await rows.first().click();
    await page.getByRole("button", { name: "Use improved version", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.upgradeRequest)).toContain("hash=improved");
    await expect.poll(() => page.evaluate(() => window.upgradeRequest)).toContain("baselineHash=demo-ready");
});

test("@layout playback warning has compact actions and settings identifies the song", async ({ page }) => {
    await demo(page);
    await page.getByLabel("Demo scenario").selectOption("partial");
    const notice = page.locator(".lb-tools > .lb-feedback");
    await expect(notice).toContainText("Some sources unavailable. Showing available lyrics.");
    const summary = notice.locator("summary");
    const retry = notice.getByRole("button", { name: "Retry", exact: true });
    const a = await summary.boundingBox();
    const b = await retry.boundingBox();
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(await notice.evaluate((n) => getComputedStyle(n).borderTopWidth)).toBe("0px");
    await summary.click();
    await expect(notice).toContainText("Demo source could not retrieve lyrics.");
    await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await expect(page.locator(".lb-settings-heading h2")).toHaveText("Morning light");
    await expect(page.locator(".lb-settings-artist")).toHaveText("Synthetic timings");
});

test("@workflow Versions owns original actions and Search keeps only top-level advanced options", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/reject-matches')){window.rejectedMatch=true;return new Response(null,{status:204});}
  if(path.endsWith('/instrumental')){window.instrumentalRequest=await request.json();return new Response(null,{status:204});}
 `),
    });
    await versions(page);
    await expect(page.locator('.lb-tabs [role="tab"]')).toHaveText(["Song", "Versions", "Display"]);
    const original = page.locator('[data-song-kind="original"]');
    for (const name of ["Search versions", "Use Jellyfin lyrics", "Import lyrics", "Remove lyrics", "Mark instrumental"])
        await expect(original.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revert previous selection", exact: true })).toHaveCount(0);
    await original.getByRole("button", { name: "Remove lyrics", exact: true }).click();
    await page.locator(".lb-confirmation").getByRole("button", { name: "Remove lyrics", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.rejectedMatch)).toBe(true);
    await original.getByRole("button", { name: "Mark instrumental", exact: true }).click();
    await page.getByRole("button", { name: "Confirm classification", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.instrumentalRequest)).toEqual({ clear: false });
    await original.getByRole("button", { name: "Search versions", exact: true }).click();
    await expect(page.locator(".lb-search-footer")).toHaveCount(0);
    await expect(page.locator(".lb-search-form > .lb-advanced > summary")).toHaveText("Advanced: provider track ID");
});

test("@workflow ordinary accounts cannot change classification", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/lyrics'))return new Response(JSON.stringify({...payload(),canSelect:false}));
 `),
    });
    await versions(page);
    await expect(page.locator(".lb-version-classification")).toHaveCount(0);
});

test("@layout improvement offer has concise distinct actions and dismisses without changing selection", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/lyrics')){const data=payload();data.better={...data.lyrics,hash:'better'};data.improvement={baselineHash:data.lyrics.hash,reason:'auxiliary-completeness',description:'More supplied rows'};return new Response(JSON.stringify(data));}
 `),
    });
    const offer = page.locator(".lb-upgrade-offer");
    await expect(offer).toContainText("Lyric update available");
    const preview = offer.getByRole("button", { name: "Preview", exact: true });
    const dismiss = offer.getByRole("button", { name: "Dismiss", exact: true });
    expect(await preview.locator("svg.lb-icon").innerHTML()).not.toBe(await dismiss.locator("svg.lb-icon").innerHTML());
    await dismiss.click();
    await expect(offer).toHaveCount(0);
    await page.evaluate(() => fetch("/Audio/11111111111111111111111111111111/Lyrics"));
    await expect(offer).toHaveCount(0);
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe("demo-ready");
});

test("@layout upgrade preview uses the full panel and banner actions have their own row", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/lyrics')){const data=payload();data.better={...data.lyrics,hash:'better'};data.improvement={baselineHash:data.lyrics.hash,reason:'auxiliary-completeness',description:'Translation: 70% → 100%; pronunciation: 80% → 70%.'};return new Response(JSON.stringify(data));}
 `),
    });
    const offer = page.locator(".lb-upgrade-offer");
    await expect(offer.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
    const message = await offer.locator(".lb-upgrade-description").boundingBox();
    const actions = await offer.locator(".lb-upgrade-actions").boundingBox();
    expect(actions.y).toBeGreaterThanOrEqual(message.y + message.height);
    await offer.getByRole("button", { name: "Preview", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Preview lyric update", exact: true });
    await expect(panel.locator(".lb-search-form")).toBeHidden();
    await expect(panel.locator(".lb-search-toolbar")).toBeHidden();
    await expect(panel.locator(".lb-results")).toBeHidden();
    await expect(panel.getByRole("button", { name: "Back to results", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Search other versions", exact: true })).toBeVisible();
    const body = await panel.locator(".lb-search-body").boundingBox();
    const preview = await panel.locator(".lb-version-preview").boundingBox();
    expect(preview.width).toBeGreaterThan(body.width * 0.9);
    await expect(panel).toContainText("pronunciation: 80% → 70%");
});

test("@workflow upgrade banners are administrator-only", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/lyrics')){const data=payload();data.canSelect=false;data.better={...data.lyrics,hash:'better'};return new Response(JSON.stringify(data));}
 `),
    });
    await expect(page.locator(".ak-enhanced-line").first()).toBeVisible();
    await expect(page.locator(".lb-upgrade")).toHaveCount(0);
});

test("@workflow Edit search restores Advanced and its entered values", async ({ page }) => {
    await demo(page);
    await search(page);
    const panel = page.locator(".lb-search");
    await expect(panel.locator(".lb-search-form")).toBeHidden();
    await panel.getByRole("button", { name: "Edit search", exact: true }).click();
    const advanced = panel.locator(".lb-advanced");
    await advanced.locator("summary").click();
    await advanced.getByLabel("Provider track ID", { exact: true }).fill("540483153");
    await panel.getByRole("button", { name: "Search", exact: true }).click();
    await expect(panel.locator(".lb-search-form")).toBeHidden();
    await expect(panel.locator(".lb-search-query")).toContainText("Morning light");
    await panel.getByRole("button", { name: "Edit search", exact: true }).click();
    await expect(advanced.getByLabel("Provider track ID", { exact: true })).toHaveValue("540483153");
});

test("@workflow Stop search retains candidates and releases outstanding work", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.includes('/LyricBridge/search/') && request.method==='DELETE'){window.stoppedSearch=true;return new Response(null,{status:204});}
  if(path.includes('/LyricBridge/search/') && request.method==='GET')return new Response(JSON.stringify({state:'searching',finished:1,total:6,candidates:[{source:'QQ',id:'weak',title:'Received result',artist:'Fixture',album:'',score:75},{source:'QQ',id:'best',title:'Better result',artist:'Fixture',album:'',score:100}],errors:[],recommended:null}));
 `),
    });
    await search(page);
    await expect(page.locator(".lb-result")).toHaveCount(2);
    await expect(page.locator(".lb-result").first()).toHaveAttribute("data-key", "QQ:weak");
    await page.getByRole("button", { name: "Stop search", exact: true }).click();
    await expect(page.locator(".lb-result").first()).toHaveAttribute("data-key", "QQ:best");
    await expect.poll(() => page.evaluate(() => window.stoppedSearch)).toBe(true);
    await expect(page.locator(".lb-search-status")).toContainText("Search stopped");
    await expect(page.locator(".lb-result")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Stop search", exact: true })).toBeHidden();
});

test("@workflow missing Jellyfin lyrics is an inline informational notice", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/import'))return new Response(JSON.stringify({error:{code:'local_lyrics_missing',message:'No existing Jellyfin lyrics were found. Import a file instead.',retryable:false}}),{status:422});
 `),
    });
    await versions(page);
    const original = page.locator('[data-song-kind="original"]');
    await original.getByRole("button", { name: "Use Jellyfin lyrics", exact: true }).click();
    const notice = original.locator(".lb-original-feedback > .lb-feedback.lb-notice");
    await expect(notice).toContainText("Jellyfin has no lyrics for this song. Try importing a file.");
    await expect(notice.locator("details")).toHaveCount(0);
    await expect(notice.getByRole("button", { name: "Dismiss", exact: true })).toHaveText("Dismiss");
    await notice.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(notice).toHaveCount(0);
});

test("@workflow versions used by Automatic explain disabled deletion", async ({ page }) => {
    await demo(page, {
        transformHtml: intercept(`
  if(path.endsWith('/lyrics')){const data=payload();data.lyrics.lines.forEach(l=>l.pronunciation=null);data.variants=[{key:'local-used',hash:data.lyrics.hash,kind:'pronunciation',language:'ja',service:'Kawazu',model:'Hepburn',originType:'local',text:Object.fromEntries(data.lyrics.lines.map(l=>[l.id,'fixture romaji'])),contextBefore:0,contextAfter:0,reasoningEffort:'',promptVersion:1,createdAt:'2026-10-13T12:00:00Z'}];return new Response(JSON.stringify(data));}
 `),
    });
    await versions(page);
    const row = page.locator('.lb-version-row[data-key="local-used"]');
    await expect(row.locator(".lb-active-label")).toHaveText("In use · Automatic");
    await row.locator(".lb-version-toggle").click();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await expect(row).toContainText("Managed locally by Kawazu");
    await expect(row.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
});
