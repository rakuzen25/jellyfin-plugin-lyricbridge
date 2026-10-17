const { test, expect } = require("playwright/test");
const { demo } = require("./demo-fixture.cjs");
function fixture(extra = "") {
    return (html) =>
        html.replace(
            "const path = new URL(request.url).pathname;",
            `const path = new URL(request.url).pathname;
        const source = {id:'source',text:'Hello world!出たね',language:'en',timing:'word',tokens:[
            {id:'t0',text:'Hello',separator:'',position:0,endPosition:5,start:10000000,end:16000000},
            {id:'t1',text:'world',separator:' ',position:6,endPosition:11,start:15000000,end:20000000},
            {id:'t2',text:'!',separator:'',position:11,endPosition:12,start:20000000,end:21000000},
            {id:'t3',text:'出たね',separator:'',position:12,endPosition:15,start:30000000,end:35000000}],warnings:[]};
        const version={id:'initial',origin:'local',algorithm:'phrase-dp/1',endTokenIds:['t2','t3'],settings:{characters:null,seconds:3,keepShortReplies:true}};
        const entry={id:'initial',transcriptId:'source',versionId:'initial',origin:'local',algorithm:'phrase-dp/1',settings:version.settings};
        const deletion={allowed:true,reason:null};
        const review={transcript:source,versions:[version],savedEntries:[{entry,deletion}],deletion,canManage:true,boundaries:[{afterId:'t0',message:'This may split a grammatical phrase.'}],selection:'baseline',canUse:true};
        const job={id:'audio-job',taskKind:'transcription',hash:'source',state:'running',progress:10,stage:'Transcribing chunk 1 of 1',request:{kind:'transcription',service:'Transcription'},audio:{chunkCount:1,allowChunking:false}};
        ${extra}
        if(path.endsWith('/transcription')) return new Response(JSON.stringify({configured:true,canTranscribe:true,maxInputMb:256,maxUploadMb:25,canUse:true,options:[{id:'audio-choice',name:'Audio fixture',provider:'AI',capability:'transcription',model:'fixture',status:'Ready',maxInputMb:256,maxUploadMb:25}],reviewOptions:[{id:'review-choice',name:'Review fixture',provider:'AI',capability:'boundary-review',model:'fixture',status:'Ready',maxInputMb:256,maxUploadMb:25}]}));
        if(path.endsWith('/transcriptions')) return new Response(JSON.stringify([{id:'source',language:'en',timing:'word',tokenCount:4,published:false,deletion,savedEntryCount:1}]));
        if(path.endsWith('/transcriptions/source')) return new Response(JSON.stringify(review));
        if(path.endsWith('/transcriptions/source/preview')) {
            const input=await request.json();window.previewBoundaries=input;
            let first=0;const lines=input.endTokenIds.map((id,i)=>{const last=source.tokens.findIndex(t=>t.id===id),tokens=source.tokens.slice(first,last+1),offset=tokens[0].position-tokens[0].separator.length;first=last+1;return{id:'l'+i,text:tokens.map(t=>t.separator+t.text).join(''),start:Math.min(...tokens.map(t=>t.start)),end:Math.max(...tokens.map(t=>t.end)),cues:tokens.map(t=>({position:t.position-offset,endPosition:t.endPosition-offset,start:t.start,end:t.end})),translations:{}}});
            return new Response(JSON.stringify({hash:'reviewed',source:'Transcription',providerId:'source',language:'en',lines}));
        }
        if(path.endsWith('/transcribe')) {window.audioRequest=await request.json();window.audioJob=job;return new Response(JSON.stringify(job));}
        if(path.endsWith('/review-plan')) return new Response(JSON.stringify({identity:'fixture-plan',requestCount:window.reviewBatchCount||1}));
        if(path.endsWith('/transcriptions/source/review')) {window.reviewRequest=await request.json();return new Response(JSON.stringify({...job,taskKind:'boundary-review'}));}
        if(path.endsWith('/jobs/audio-job')) return new Response(JSON.stringify(window.audioJob||job));
    `,
        );
}
async function open(page) {
    if (!(await page.getByRole("dialog", { name: "Lyrics settings", exact: true }).isVisible()))
        await page.getByRole("button", { name: "Lyrics settings", exact: true }).click();
    await page.getByRole("tab", { name: "Versions", exact: true }).click();
    await page.getByRole("button", { name: "Transcribe audio", exact: true }).click();
    return page.getByRole("dialog", { name: "Transcribe audio", exact: true });
}
async function review(page) {
    const panel = await open(page);
    await panel.getByRole("button", { name: "Review line breaks", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(2);
    return panel;
}
for (const scenario of [
    {
        reason: "transcription_disabled",
        message: "Transcription is turned off by your administrator.",
        admin: true,
        guidance: "administrator settings → Services",
    },
    {
        reason: "requests_disabled",
        message: "User requests are disabled by your administrator.",
        admin: false,
        guidance: "An administrator can enable new transcription requests.",
    },
    {
        reason: "service_not_configured",
        message: "No transcription service is configured.",
        admin: true,
        guidance: "administrator settings → Services",
    },
]) {
    test("@workflow unavailable transcription: " + scenario.reason, async ({ page }) => {
        await demo(page, {
            transformHtml: fixture(`
            if(path.endsWith('/transcription')) return new Response(JSON.stringify({configured:false,canTranscribe:false,canUse:${scenario.admin},unavailableReason:${JSON.stringify(scenario.reason)},options:[],reviewOptions:[]}));
            if(path.endsWith('/transcription-uploads')) return new Response(JSON.stringify([{id:'staged',bytes:1000}]));
        `),
        });
        const panel = await open(page);
        const notice = panel.getByRole("alert");
        await expect(notice).toContainText("New transcription is unavailable");
        await expect(notice).toContainText(scenario.message);
        await expect(notice).toContainText(scenario.guidance);
        await expect(panel.getByLabel("Transcription service", { exact: true })).toHaveCount(0);
        await expect(panel.getByLabel("Audio language", { exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Transcribe current track", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Upload audio", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Use staged audio", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Discard staged audio", exact: true })).toBeVisible();
        await expect(panel.getByRole("button", { name: "Refresh recordings", exact: true })).toBeVisible();
        await panel.getByRole("button", { name: "Review line breaks", exact: true }).click();
        await expect(panel.getByRole("button", { name: "Use reviewed lyrics", exact: true })).toBeVisible();
    });
}
test("@layout unavailable transcription keeps notice and retained results inside the dialog", async ({ page }, info) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcription')) return new Response(JSON.stringify({canTranscribe:false,canUse:false,unavailableReason:'requests_disabled',options:[],reviewOptions:[]}));
    `),
    });
    const panel = await open(page);
    const bounds = await panel.boundingBox();
    const notice = await panel.getByRole("alert").boundingBox();
    const heading = await panel.getByRole("heading", { name: "Saved transcription results", exact: true }).boundingBox();
    const message = await panel.getByRole("alert").locator(".lb-feedback-message").boundingBox();
    const explanation = await panel.getByRole("alert").locator(".lb-feedback-secondary").boundingBox();
    expect(explanation.y - message.y - message.height).toBeLessThanOrEqual(16);
    expect(notice.y).toBeGreaterThan(bounds.y);
    expect(heading.y).toBeGreaterThanOrEqual(notice.y + notice.height);
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await panel.screenshot({ path: info.outputPath("transcription-unavailable.png") });
});
test("@layout review notices, selector and tool sections use one spacing rhythm", async ({ page }, info) => {
    await demo(page, {
        transformHtml: fixture(
            `source.warnings=[{code:'text_mismatch',message:'Timed tokens differ from provider text.'},{code:'chunk_seam',message:'Review the chunk seam.'}];`,
        ),
    });
    const panel = await review(page);
    const spacing = await panel.evaluate((root) => {
        const bounds = (selector) => root.querySelector(selector).getBoundingClientRect();
        const notice = bounds(".lb-transcription-editor > .lb-feedback");
        const selector = bounds(".lb-transcription-editor > .lb-field");
        const management = bounds(".lb-transcription-management");
        const local = bounds(".lb-transcription-automatic");
        const ai = bounds(".lb-transcription-ai-review");
        return [selector.top - notice.bottom, management.top - selector.bottom, local.top - management.bottom, ai.top - local.bottom];
    });
    for (const gap of spacing) expect(gap).toBeCloseTo(12, 0);
    await expect(panel.getByRole("alert")).toContainText("2 transcription notices");
    await panel.screenshot({ path: info.outputPath("transcription-review-spacing.png") });
});
test("@layout discard confirmation stays fully visible above the editor", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await demo(page, { transformHtml: fixture() });
    const panel = await review(page);
    await panel.getByText("AI review", { exact: true }).click();
    await panel.getByLabel("AI review service", { exact: true }).selectOption("review-choice");
    await panel.getByRole("button", { name: "Request AI review", exact: true }).click();
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel.locator(".lb-transcription-status > .lb-feedback")).toBeHidden();
    const confirmation = panel.locator(".lb-confirmation");
    await expect(confirmation).toContainText("Save unfinished line-break edits before closing?");
    for (const name of ["Discard", "Keep editing"]) {
        const action = confirmation.getByRole("button", { name, exact: true });
        await expect(action).toBeVisible();
        expect(
            await action.evaluate((node) => {
                const box = node.getBoundingClientRect(),
                    panel = node.closest('[role="dialog"]').getBoundingClientRect();
                return (
                    box.top >= panel.top &&
                    box.bottom <= panel.bottom &&
                    node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
                );
            }),
        ).toBe(true);
    }
    await panel.screenshot({ path: info.outputPath("transcription-discard-confirmation.png") });
    await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(panel.locator(".lb-transcription-status > .lb-feedback")).toBeVisible();
});
test("@layout phrase review shares controls, preserves karaoke, and supports manual advice overrides", async ({ page }, info) => {
    await demo(page, { transformHtml: fixture() });
    // Jellyfin can give the lyric page its own stacking context.
    await page.addStyleTag({ content: ".lyricPage { isolation: isolate; }" });
    await page.locator(".ak-enhanced-line").nth(2).hover();
    await page.mouse.wheel(0, 500);
    const follow = page.getByRole("button", { name: "Resume following the playing lyric" });
    await expect(follow).toBeVisible();
    const panel = await review(page);
    expect(await panel.evaluate((dialog) => dialog.parentElement === document.body)).toBe(true);
    expect(
        await follow.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            return !!document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest(".lb-transcription-panel");
        }),
    ).toBe(true);
    const automatic = panel.locator(".lb-transcription-automatic");
    await automatic.locator("summary").click();
    const fieldSpacing = await automatic.evaluate((root) => {
        const fields = root.querySelectorAll(".lb-field");
        return fields[1].getBoundingClientRect().top - fields[0].getBoundingClientRect().bottom;
    });
    expect(fieldSpacing).toBe(12);
    await automatic.locator("summary").click();
    const baseline = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await expect(panel).toContainText("This may split a grammatical phrase");
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    await panel.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(2);
    await panel.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    await panel.getByRole("button", { name: "Playback preview", exact: true }).click();
    await expect(page.locator(".ak-enhanced-line").first()).toContainText("Hello");
    await expect.poll(() => page.evaluate(() => window.previewBoundaries?.endTokenIds)).toEqual(["t0", "t2", "t3"]);
    await page.getByRole("button", { name: "Return to line breaks", exact: true }).click();
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    const box = await panel.boundingBox(),
        viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await panel.screenshot({ path: info.outputPath("transcription-review.png") });
    await page.keyboard.press("Escape");
    await expect(panel).toContainText("Save unfinished");
    await panel.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(panel).toHaveCount(0);
});
test("@workflow save-and-use locks dismissal; conflicts retain edits and refresh only the selection baseline", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source/use')) {
            window.submittedReview=await request.json();await new Promise(resolve=>window.releaseUse=resolve);
            return new Response(JSON.stringify({error:{code:'lyric_version_changed',message:'The selected original changed.'}}),{status:409});
        }
    `),
    });
    const panel = await review(page);
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await panel.getByRole("button", { name: "Use reviewed lyrics", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.releaseUse)).toBe("function");
    await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await page.evaluate(() => window.releaseUse());
    await expect(panel.getByRole("alert")).toContainText("selected original changed");
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    expect(await page.evaluate(() => window.submittedReview.endTokenIds)).toEqual(["t0", "t2", "t3"]);
    await panel.getByRole("button", { name: "Refresh selection baseline", exact: true }).click();
    await expect(panel).toContainText("baseline refreshed");
    await expect(panel.getByRole("button", { name: "Use reviewed lyrics", exact: true })).toBeEnabled();
});
test("@workflow explicit chunking uses the existing approval job after the panel closes", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.includes('/transcription-jobs/audio-job/retry')) {window.chunkConsent=await request.json();window.audioJob={...job,state:'pending',audio:{chunkCount:2,allowChunking:true},failure:null};return new Response(JSON.stringify(window.audioJob));}
    `),
    });
    const panel = await open(page);
    await expect(panel.getByLabel("Transcription service", { exact: true })).toHaveValue("");
    await expect(panel.getByRole("button", { name: "Transcribe current track", exact: true })).toBeDisabled();
    await panel.getByLabel("Transcription service", { exact: true }).selectOption("audio-choice");
    await panel.getByRole("button", { name: "Transcribe current track", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.audioRequest?.source)).toBe("track");
    await page.evaluate(() => {
        window.audioJob = { ...window.audioJob, state: "failed", failure: { code: "audio_too_large", message: "Audio too large. Choose chunking." } };
    });
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Transcribe in chunks (2)", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Transcribe in chunks (2)", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.chunkConsent?.allowChunking)).toBe(true);
    await expect(page.getByText("Audio transcription · pending", { exact: true })).toBeVisible();
});
test("@workflow closed review reads cannot reopen the panel", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source')&&window.holdRead) {await new Promise(resolve=>window.releaseRead=resolve);return new Response(JSON.stringify(review));}
    `),
    });
    const panel = await review(page);
    await panel.getByRole("button", { name: "Back to recordings", exact: true }).click();
    await page.evaluate(() => (window.holdRead = true));
    await panel.getByRole("button", { name: "Review line breaks", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.releaseRead)).toBe("function");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.releaseRead());
    await expect(panel).toHaveCount(0);
});

test("@workflow binary audio upload preserves bytes and admits only after success", async ({ page }) => {
    await demo(page, { transformHtml: fixture() });
    const bytes = Buffer.from("RIFF synthetic audio fixture");
    let received;
    await page.route("**/LyricBridge/items/*/transcription-upload?*", async (route) => {
        received = route.request().postDataBuffer();
        expect(route.request().headers()["content-type"]).toBe("application/octet-stream");
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) });
    });
    const panel = await open(page);
    const chooser = page.waitForEvent("filechooser");
    await expect(panel.getByLabel("Transcription service", { exact: true })).toHaveValue("");
    await expect(panel.getByRole("button", { name: "Transcribe current track", exact: true })).toBeDisabled();
    await panel.getByLabel("Transcription service", { exact: true }).selectOption("audio-choice");
    await panel.getByRole("button", { name: "Upload audio", exact: true }).click();
    await (await chooser).setFiles({ name: "recording.wav", mimeType: "audio/wav", buffer: bytes });
    await expect.poll(() => page.evaluate(() => window.audioRequest?.uploadId)).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(received).toEqual(bytes);
    expect(await page.evaluate(() => window.audioRequest.source)).toBe("upload");
});

test("@workflow local breaking settings and AI review have separate controls", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source/break')) {window.localBreakSettings=await request.json();return new Response(JSON.stringify({...version,id:'local-rebreak',settings:window.localBreakSettings}));}
        if(path.endsWith('/transcriptions/source/review')) {window.reviewRequest=await request.json();window.audioJob={...job,taskKind:'boundary-review'};return new Response(JSON.stringify(window.audioJob));}
    `),
    });
    const panel = await review(page);
    const local = panel.locator(".lb-transcription-automatic");
    const ai = panel.locator(".lb-transcription-ai-review");
    await local.locator("summary").click();
    await expect(local.getByLabel("Character target", { exact: true })).toBeVisible();
    await expect(local.getByLabel("AI review service", { exact: true })).toHaveCount(0);
    await local.getByLabel("Character target", { exact: true }).fill("24");
    await local.getByLabel("Character target", { exact: true }).blur();
    await local.getByRole("button", { name: "Apply automatic line breaks", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.localBreakSettings?.characters)).toBe(24);
    expect(await page.evaluate(() => window.reviewRequest)).toBeUndefined();
    await ai.locator("summary").click();
    await expect(ai.getByLabel("Character target", { exact: true })).toHaveCount(0);
    await ai.getByLabel("AI review service", { exact: true }).selectOption("review-choice");
    await ai.getByRole("button", { name: "Request AI review", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.reviewRequest?.settings.characters)).toBe(24);
    await page.evaluate(() => {
        window.audioJob = {
            ...window.audioJob,
            taskKind: "boundary-review",
            state: "failed",
            failure: { code: "invalid_boundary_response", message: "Invalid boundary response." },
        };
    });
    await expect(page.getByRole("button", { name: /^Retry AI review/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry transcription", exact: true })).toHaveCount(0);
});

test("@workflow dismissed review failures stay dismissed when the pane reopens; new jobs still appear", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source/review')) {window.audioJob={...job,taskKind:'boundary-review'};return new Response(JSON.stringify(window.audioJob));}
        if(path.endsWith('/jobs')) return new Response(JSON.stringify([window.audioJob,window.freshReview].filter(Boolean)));
        if(path.endsWith('/jobs/fresh-review')) return new Response(JSON.stringify(window.freshReview));
    `),
    });
    const panel = await review(page);
    await panel.getByText("AI review", { exact: true }).click();
    await panel.getByLabel("AI review service", { exact: true }).selectOption("review-choice");
    await panel.getByRole("button", { name: "Request AI review", exact: true }).click();
    await page.evaluate(() => {
        window.audioJob = { ...window.audioJob, state: "failed", failure: { code: "service_timeout", message: "Boundary review timed out." } };
    });
    const oldNotice = page.locator('[data-operation="job:audio-job"]');
    await expect(oldNotice).toContainText("Boundary review timed out");
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await oldNotice.getByRole("button", { name: "Dismiss", exact: true }).click();
    const reopened = await open(page);
    await expect(reopened.getByRole("heading", { name: "Saved transcription results", exact: true })).toBeVisible();
    await expect(oldNotice).toHaveCount(0);
    await reopened.getByRole("button", { name: "Refresh recordings", exact: true }).click();
    await expect(reopened.getByRole("heading", { name: "Saved transcription results", exact: true })).toBeVisible();
    await expect(oldNotice).toHaveCount(0);
    await page.evaluate(() => {
        window.freshReview = { ...window.audioJob, id: "fresh-review", state: "running", failure: null, progress: 25 };
    });
    await reopened.getByRole("button", { name: "Refresh recordings", exact: true }).click();
    const freshNotice = page.locator('[data-operation="job:fresh-review"]');
    await expect(freshNotice).toContainText("Line-break review · running");
    await expect(oldNotice).toHaveCount(0);
    await reopened.getByRole("button", { name: "Refresh recordings", exact: true }).click();
    await expect(freshNotice).toHaveCount(1);
    await reopened.getByRole("button", { name: "Close", exact: true }).click();
    await freshNotice.getByRole("button", { name: "Dismiss", exact: true }).click();
    const again = await open(page);
    await again.getByRole("button", { name: "Refresh recordings", exact: true }).click();
    await expect(freshNotice).toHaveCount(0);
    await page.evaluate(() => {
        window.freshReview = { ...window.freshReview, state: "complete", resultId: "source" };
    });
    await reopened.getByRole("button", { name: "Refresh recordings", exact: true }).click();
    await expect(freshNotice).toHaveCount(0);
});

test("@workflow late AI completion retains newer manual breaks until explicitly opened", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source') && window.audioJob?.state==='complete') return new Response(JSON.stringify({...review,savedEntries:[{entry,deletion},{entry:{...entry,id:'review:audio-job',origin:'AI',optionName:'Review fixture',profile:{model:'fixture'}},deletion}],reviewResults:[{id:'audio-job',transcriptId:'source',versionId:'initial',created:'2026-10-17T12:00:00Z',optionName:'Review fixture',profile:{model:'fixture'},seamTokenIds:[]}]}));
        if(path.endsWith('/transcriptions/source/review')) {window.audioJob={...job,taskKind:'boundary-review'};return new Response(JSON.stringify(window.audioJob));}
    `),
    });
    const panel = await review(page);
    await panel.getByText("AI review", { exact: true }).click();
    await expect(panel.getByRole("button", { name: "Request AI review", exact: true })).toBeDisabled();
    await panel.getByLabel("AI review service", { exact: true }).selectOption("review-choice");
    await panel.getByRole("button", { name: "Request AI review", exact: true }).click();
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await page.evaluate(() => (window.audioJob = { ...window.audioJob, state: "complete", resultId: "source" }));
    await expect(page.getByRole("button", { name: "Review result", exact: true })).toBeVisible();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
    await expect(panel.getByLabel("Saved line breaks", { exact: true }).locator("option").filter({ hasText: "AI review" })).toHaveCount(1);
    await expect(panel.getByLabel("Saved line breaks", { exact: true }).locator("option").filter({ hasText: "Automatic" })).toHaveCount(1);
    await panel.getByLabel("Saved line breaks", { exact: true }).selectOption("review:audio-job");
    await panel.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(2);
    await expect(panel.getByLabel("Saved line breaks", { exact: true })).toHaveValue("review:audio-job");
});

test("@workflow AI request planning rejects stale counts and sends the displayed plan identity", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source/review-plan')) {
            const input=await request.json();window.plannedInputs??=[];window.plannedInputs.push(input);
            if(window.plannedInputs.length===1) await new Promise(resolve=>setTimeout(resolve,300));
            return new Response(JSON.stringify({identity:'plan-'+input.settings.characters,requestCount:input.settings.characters===24?2:1}));
        }
    `),
    });
    const panel = await review(page),
        local = panel.locator(".lb-transcription-automatic"),
        ai = panel.locator(".lb-transcription-ai-review");
    await local.locator("summary").click();
    await ai.locator("summary").click();
    await ai.getByLabel("AI review service", { exact: true }).selectOption("review-choice");
    await local.getByLabel("Character target", { exact: true }).fill("24");
    await local.getByLabel("Character target", { exact: true }).blur();
    await expect(ai).toContainText("2 AI requests");
    await page.waitForTimeout(350);
    await expect(ai).toContainText("2 AI requests");
    expect(await page.evaluate(() => window.reviewRequest)).toBeUndefined();
    await ai.getByRole("button", { name: "Request AI review", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.reviewRequest?.planIdentity)).toBe("plan-24");
});

const savedWorkspace = `
    window.savedDoc??=review;
    if(path.endsWith('/transcriptions/source') && request.method==='GET') return new Response(JSON.stringify(window.savedDoc));
    if(path.endsWith('/transcriptions/source/break')) { window.localBreakCalls=(window.localBreakCalls||0)+1; return new Response(JSON.stringify({...version,id:'generated',endTokenIds:['t2','t3']})); }
    if(path.endsWith('/transcriptions/source/save')) {
        const input=await request.json(); window.savedDraft=input;
        if(window.failSave) return new Response(JSON.stringify({error:{code:'save_failed',message:'Save failed. Try again.'}}),{status:500});
        const savedVersion={...version,id:'saved',endTokenIds:input.endTokenIds,settings:input.settings};
        const savedEntry={...entry,id:'saved-entry',versionId:'saved',origin:input.origin,settings:input.settings};
        window.savedDoc.versions=window.savedDoc.versions.filter(v=>v.id!=='saved').concat(savedVersion);
        window.savedDoc.savedEntries=window.savedDoc.savedEntries.filter(v=>v.entry.id!=='saved-entry').concat({entry:savedEntry,deletion});
        return new Response(JSON.stringify(savedEntry));
    }
    if(path.includes('/transcriptions/source/entries/') && request.method==='DELETE') {
        const id=decodeURIComponent(path.split('/').at(-1));window.deletedEntry=id;
        window.savedDoc.savedEntries=window.savedDoc.savedEntries.filter(v=>v.entry.id!==id);
        return new Response(null,{status:204});
    }
`;
test("@workflow explicit Save preserves playback and undo across the saved baseline", async ({ page }) => {
    await demo(page, { transformHtml: fixture(savedWorkspace) });
    const panel = await review(page),
        save = panel.getByRole("button", { name: "Save line breaks", exact: true });
    const baseline = await page.evaluate(() => window.LyricBridge.current.lyrics.hash);
    await expect(save).toBeDisabled();
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    expect(await page.evaluate(() => window.LyricBridge.current.lyrics.hash)).toBe(baseline);
    await panel.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(2);
    await expect(save).toBeEnabled();
    await panel.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(save).toBeDisabled();
    await panel.getByRole("button", { name: "Undo", exact: true }).click();
    await panel.getByRole("button", { name: "Reset edits", exact: true }).click();
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    await expect(save).toBeDisabled();
});
test("@workflow local generation creates only a draft and deleting the last entry preserves it", async ({ page }) => {
    await demo(page, { transformHtml: fixture(savedWorkspace) });
    const panel = await review(page);
    await panel.getByText("Manage saved line breaks", { exact: true }).click();
    await panel.locator(".lb-transcription-management").getByRole("button", { name: "Delete", exact: true }).click();
    await panel.locator(".lb-confirmation").getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.savedDoc.savedEntries.length)).toBe(0);
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(2);
    await expect(panel.getByRole("button", { name: "Save line breaks", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await panel.locator(".lb-confirmation").getByRole("button", { name: "Discard", exact: true }).click();
    const reopened = await open(page);
    await reopened.getByRole("button", { name: "Review line breaks", exact: true }).click();
    await expect(reopened.getByRole("button", { name: "Generate automatic line breaks", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.localBreakCalls || 0)).toBe(0);
    await expect(reopened.getByRole("button", { name: "Use reviewed lyrics", exact: true })).toHaveCount(0);
    await reopened.getByRole("button", { name: "Generate automatic line breaks", exact: true }).click();
    await expect(reopened.locator(".lb-transcription-phrase")).toHaveCount(2);
    expect(await page.evaluate(() => window.savedDoc.savedEntries.length)).toBe(0);
    await expect(reopened.getByRole("button", { name: "Save line breaks", exact: true })).toBeEnabled();
});
test("@workflow failed Save and continue retains the draft and allows another decision", async ({ page }) => {
    await demo(page, { transformHtml: fixture(savedWorkspace) });
    const panel = await review(page);
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await page.evaluate(() => (window.failSave = true));
    await panel.getByRole("button", { name: "Back to recordings", exact: true }).click();
    await panel.getByRole("button", { name: "Save and continue", exact: true }).click();
    await expect(panel).toContainText("Save failed. Try again.");
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Keep editing", exact: true })).toBeEnabled();
    await page.evaluate(() => (window.failSave = false));
    await panel.getByRole("button", { name: "Save and continue", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Saved transcription results", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.savedDraft.endTokenIds)).toEqual(["t0", "t2", "t3"]);
});
test("@layout saved-entry management exposes blockers without hover", async ({ page }, info) => {
    await demo(page, {
        transformHtml: fixture(`
        const blocked={allowed:false,reason:'Used by saved original song / original-hash. Delete that original first.'};
        review.deletion=blocked;review.savedEntries[0].deletion=blocked;
    `),
    });
    const panel = await review(page);
    await panel.getByText("Manage saved line breaks", { exact: true }).click();
    const management = panel.locator(".lb-transcription-management");
    await expect(management.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await expect(management.getByRole("button", { name: "Delete transcription", exact: true })).toBeDisabled();
    await expect(
        management.getByText("Used by saved original song / original-hash. Delete that original first.", { exact: true }).first(),
    ).toBeVisible();
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await panel.screenshot({ path: info.outputPath("saved-entry-management.png") });
});

test("@workflow stale saved-entry deletion can refresh without losing the draft", async ({ page }) => {
    await demo(page, {
        transformHtml: fixture(`
        if(path.endsWith('/transcriptions/source/save') && !window.deletedElsewhere) {
            window.deletedElsewhere=true;window.savedDoc={...review,savedEntries:[]};
            return new Response(JSON.stringify({error:{code:'line_breaks_deleted',message:'These saved line breaks were deleted.'}}),{status:409});
        }
        ${savedWorkspace}
    `),
    });
    const panel = await review(page);
    await panel.getByText("Split phrase 1", { exact: true }).click();
    await panel.getByRole("button", { name: "Split after “Hello”", exact: true }).click();
    await panel.getByRole("button", { name: "Save line breaks", exact: true }).click();
    await panel.getByRole("button", { name: "Refresh saved line breaks", exact: true }).click();
    await expect(panel).toContainText("Saved list refreshed.");
    await expect(panel.locator(".lb-transcription-phrase")).toHaveCount(3);
    await expect(panel.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Save line breaks", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Save line breaks", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.savedDraft.entryId)).toBeUndefined();
});
