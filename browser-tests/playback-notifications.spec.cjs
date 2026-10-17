const { test, expect } = require("playwright/test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { feedbackFixture } = require("../frontend/feedback-fixture.mjs");
const { demo } = require("./demo-fixture.cjs");
const code = feedbackFixture(resolve(__dirname, "../frontend"));
async function fixture(page) {
    const css = readFileSync(resolve(__dirname, "../frontend/assets/lyricbridge.css"), "utf8");
    await page.setContent(
        "<style>" +
            css +
            '</style><main id="lyrics" style="position:relative;margin:50px 12px 0;height:380px;color:white;background:#302633">Lyrics</main><div class="lb-tools"></div>',
    );
    await page.addScriptTag({ content: code });
    await page.evaluate(() => {
        window.cards = new window.fixture.PlaybackNotifications(document.querySelector(".lb-tools"), document.getElementById("lyrics"));
        const set = (id, severity) =>
            window.cards.set(id, { message: id, severity, details: ["Reference " + id], actions: [{ label: "Action " + id, run: () => {} }] });
        set("action:progress-a", "progress");
        set("action:progress-b", "progress");
        set("improvement", "info");
        set("action:warning", "warning");
        set("action:error", "error");
    });
}
const visible = (page) => page.locator(".lb-notification-card:visible").evaluateAll((nodes) => nodes.map((n) => n.dataset.operation));

test("notification priority, deduplication and expanded state survive operation updates", async ({ page }) => {
    await fixture(page);
    await expect.poll(() => visible(page)).toEqual(["action:error", "action:warning"]);
    await expect
        .poll(() =>
            page.locator(".lb-tools").evaluate((node) => {
                const host = document.getElementById("lyrics").getBoundingClientRect();
                return node.getBoundingClientRect().width < Math.min(520, host.width - 24);
            }),
        )
        .toBe(true);
    await page.getByRole("button", { name: "3 more notifications" }).click();
    await expect(page.locator(".lb-notification-card:visible")).toHaveCount(5);
    await page.evaluate(() => {
        const list = document.querySelector(".lb-notification-list");
        list.scrollTop = 60;
        window.beforeScroll = list.scrollTop;
        window.cards.set("action:progress-a", {
            message: "Updated progress",
            severity: "progress",
            details: ["Reference action:progress-a"],
            actions: [{ label: "Action action:progress-a", run: () => {} }],
        });
    });
    await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();
    await expect(page.locator('[data-operation="action:progress-a"]')).toHaveCount(1);
    expect(await page.evaluate(() => document.querySelector(".lb-notification-list").scrollTop)).toBe(await page.evaluate(() => window.beforeScroll));
    await page.getByRole("button", { name: "Show fewer" }).click();
    await expect.poll(() => visible(page)).toEqual(["action:error", "action:warning"]);
});

test("dismissing notifications updates the summary and hides unnecessary collapse controls", async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
        for (const id of ["action:error", "action:warning", "action:progress-a", "action:progress-b", "improvement"])
            window.cards.set(id, {
                message: id,
                severity: id === "action:error" ? "error" : id === "action:warning" ? "warning" : "info",
                actions: [{ label: "Dismiss", run: () => window.cards.remove(id) }],
            });
    });
    await page.locator('.lb-notification-card[data-operation="action:error"]').getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("button", { name: "2 more notifications" })).toBeVisible();
    await page.getByRole("button", { name: "2 more notifications" }).click();
    await page.locator('.lb-notification-card[data-operation="action:warning"]').getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();
    await page.locator('.lb-notification-card[data-operation="action:progress-a"]').getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator(".lb-notification-summary")).toBeHidden();
    await expect(page.locator(".lb-notification-card:visible")).toHaveCount(2);
    await page.evaluate(() => window.cards.set("new-operation", { message: "Another notification" }));
    await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();
    await expect(page.locator(".lb-notification-card:visible")).toHaveCount(3);
});

test("focused cards remain visible and diagnostic focus survives changed details", async ({ page }) => {
    await fixture(page);
    const card = page.locator('[data-operation="action:warning"]');
    await card.locator("summary").click();
    await card.getByRole("button", { name: "Action action:warning" }).focus();
    await page.evaluate(() => {
        window.focused = document.activeElement;
        window.cards.set("action:warning", {
            message: "Warning recovered",
            severity: "info",
            details: ["New reference"],
            actions: [{ label: "Action action:warning", run: () => {} }],
        });
    });
    expect(await page.evaluate(() => document.activeElement === window.focused)).toBe(true);
    await expect(card).toBeVisible();
    await expect(card.locator("details")).toHaveAttribute("open", "");
    await card.locator("summary").focus();
    await page.evaluate(() =>
        window.cards.set("action:warning", {
            message: "Another update",
            severity: "info",
            details: ["Changed reference"],
            actions: [{ label: "Action action:warning", run: () => {} }],
        }),
    );
    await expect(card.locator("summary")).toBeFocused();
});

test("expanded notifications scroll within a small lyrics container and keep collapse reachable", async ({ page }, testInfo) => {
    await fixture(page);
    await page.getByRole("button", { name: "3 more notifications" }).click();
    await page.evaluate(() => {
        document.getElementById("lyrics").style.height = "160px";
        for (let index = 0; index < 8; index++)
            window.cards.set("action:long-" + index, {
                message: "A long warning about a source that could not finish. ".repeat(5),
                severity: "warning",
                details: ["Diagnostic details ".repeat(30)],
                actions: [
                    { label: "Retry source", run: () => {} },
                    { label: "Dismiss", run: () => {} },
                ],
            });
    });
    const inBounds = () =>
        page.evaluate(() => {
            const host = document.getElementById("lyrics").getBoundingClientRect(),
                root = document.querySelector(".lb-tools").getBoundingClientRect(),
                collapse = document.querySelector(".lb-notification-summary").getBoundingClientRect();
            return (
                root.top >= host.top &&
                root.bottom <= Math.min(host.bottom, innerHeight) + 1 &&
                root.left >= host.left &&
                root.right <= Math.min(host.right, innerWidth) + 1 &&
                collapse.top >= root.top &&
                collapse.bottom <= root.bottom + 1 &&
                document.documentElement.scrollWidth <= innerWidth
            );
        });
    await expect.poll(inBounds).toBe(true);
    const list = page.locator(".lb-notification-list");
    expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await page.getByRole("button", { name: "Show fewer" }).click();
    await page.locator(".lb-notification-summary").click();
    await page.setViewportSize({ width: 320, height: 440 });
    await expect.poll(inBounds).toBe(true);
    await page.locator(".lb-tools").screenshot({ path: testInfo.outputPath("bounded-notifications.png") });
    await page.setViewportSize({ width: 320, height: 180 });
    await expect.poll(inBounds).toBe(true);
    await expect(page.getByRole("button", { name: "Show fewer" })).toBeVisible();
    await page.evaluate(() => (document.getElementById("lyrics").hidden = true));
    await expect(page.locator(".lb-tools")).toBeHidden();
    await page.evaluate(() => {
        window.cards.dispose();
        document.querySelector(".lb-tools").remove();
    });
    await expect(page.locator(".lb-tools")).toHaveCount(0);
});

test("empty lyrics pages leave room for a complete transcription notification", async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
        window.cards.dispose();
        const host = document.getElementById("lyrics");
        host.classList.add("lyricPage");
        host.style.height = "80px";
        window.cards = new window.fixture.PlaybackNotifications(document.querySelector(".lb-tools"), host);
        window.cards.set("job:transcription", {
            message: "Audio transcription · running",
            secondary: "Preparing audio · 00:01:41",
            severity: "progress",
            actions: [
                { label: "Cancel request", run: () => {} },
                { label: "Dismiss", run: () => {} },
            ],
        });
    });
    await expect.poll(() => page.locator(".lb-notification-list").evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Cancel request", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeInViewport();
});

test("success expires while errors persist and focused success waits until focus leaves", async ({ page }) => {
    await fixture(page);
    await page.clock.install({ time: new Date("2026-10-13T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-13T00:00:10Z"));
    await page.evaluate(() => {
        for (const id of ["action:progress-a", "action:progress-b", "improvement", "action:warning"]) window.cards.remove(id);
        window.cards.set("action:success", { message: "Saved", severity: "success", actions: [{ label: "Saved action", run: () => {} }] });
    });
    await page.getByRole("button", { name: "Saved action" }).focus();
    await page.clock.runFor(4000);
    await expect(page.getByRole("button", { name: "Saved action" })).toBeFocused();
    await page.locator('[data-operation="action:error"] summary').focus();
    await expect(page.locator('[data-operation="action:success"]')).toHaveCount(0);
    await page.clock.runFor(10000);
    await expect(page.locator('[data-operation="action:error"]')).toBeVisible();
});

test("job monitoring errors stay in the operation card and unchanged successful checks recover", async ({ page }) => {
    await demo(page, {
        transformHtml: (html) =>
            html.replace(
                "const path = new URL(request.url).pathname;",
                `const path = new URL(request.url).pathname;
const job={id:'monitor-fixture',state:'running',progress:18,request:{service:'Google',kind:'pronunciation',language:'ja'}};
if(path.endsWith('/jobs'))return new Response(JSON.stringify([job]));
if(path.endsWith('/jobs/monitor-fixture')){if(!window.checkRecovered)return new Response(JSON.stringify({error:{code:'bad_status',message:'Status check failed',diagnosticId:'status-ref'}}),{status:400});return new Response(JSON.stringify(job));}
`,
            ),
    });
    const card = page.locator('[data-operation="job:monitor-fixture"]');
    await expect(card).toContainText("Could not check pronunciation progress");
    await expect(card).toContainText("Last known state: Pronunciation · Google · running · 18%");
    await expect(card.getByRole("button", { name: "Cancel request", exact: true })).toBeVisible();
    await card.locator("summary").click();
    await expect(card).toContainText("status-ref");
    await page.evaluate(() => (window.checkRecovered = true));
    await card.getByRole("button", { name: "Retry status check" }).click();
    await expect(card).toHaveAttribute("data-severity", "progress");
    await expect(card).toContainText("Google · running · 18%");
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(card).toHaveCount(0);
});

test("preview controls remain above expanded scrolling notifications on a short viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 360 });
    await fixture(page);
    await page.evaluate(() => {
        const bar = document.createElement("div");
        bar.className = "lb-preview-playback-bar";
        const label = document.createElement("span");
        label.textContent = "Previewing a long recording and its translated lyrics";
        const back = document.createElement("button");
        back.textContent = "Return to results";
        back.className = "lb-button";
        back.onclick = () => (window.returnClicked = true);
        bar.append(label, back);
        window.cards.setPreview(bar);
    });
    const bar = page.locator(".lb-preview-playback-bar");
    await expect(bar.getByRole("button", { name: "Return to results" })).toBeVisible();
    const before = await bar.boundingBox();
    await page.getByRole("button", { name: "3 more notifications" }).click();
    await page.evaluate(() => (document.querySelector(".lb-notification-list").scrollTop = 300));
    await expect.poll(async () => Math.abs((await bar.boundingBox()).y - before.y)).toBeLessThan(1);
    await bar.getByRole("button", { name: "Return to results" }).click();
    expect(await page.evaluate(() => window.returnClicked)).toBe(true);
});

test("shared preview controller restores its source and newest deferred response, and abort never restores another owner", async ({ page }) => {
    await fixture(page);
    await page.evaluate(() => {
        const panel = document.createElement("section");
        panel.id = "source-panel";
        panel.style.cssText = "height:100px;overflow:auto";
        const spacer = document.createElement("div");
        spacer.style.height = "500px";
        const trigger = document.createElement("button");
        trigger.id = "source-trigger";
        trigger.textContent = "Preview with playback";
        panel.append(trigger, spacer);
        document.body.append(panel);
        panel.scrollTop = 80;
        window.owner = { controller: new AbortController() };
        window.previewDoc = { id: "baseline" };
        window.previewTime = 7;
        window.renders = [];
        window.preview = new window.fixture.PlaybackPreview({
            scope: () => window.owner,
            current: () => window.previewDoc,
            time: () => window.previewTime,
            render: (doc, time) => {
                window.previewDoc = doc;
                if (time != null) window.previewTime = time;
                window.renders.push(doc.id);
            },
            mount: (bar) => window.cards.setPreview(bar),
            pending: (doc) => {
                window.previewDoc = doc;
                window.renders.push(doc.id);
            },
        });
        window.beginPreview = () =>
            window.preview.start({ document: { id: "preview" }, description: "Fixture preview", returnLabel: "Return to source", panel, trigger });
        window.beginPreview();
        window.previewTime = 19;
        window.beginPreview();
        window.preview.session.defer(window.owner, { data: { id: "fresh" }, renderNow: true, order: 2 });
        window.preview.session.defer(window.owner, { data: { id: "old" }, renderNow: true, order: 1 });
    });
    await page.getByRole("button", { name: "Return to source" }).click();
    expect(
        await page.evaluate(() => ({
            doc: window.previewDoc.id,
            time: window.previewTime,
            scroll: document.getElementById("source-panel").scrollTop,
        })),
    ).toEqual({ doc: "fresh", time: 19, scroll: 80 });
    await expect(page.locator("#source-trigger")).toBeFocused();
    await expect(page.locator("#source-panel")).toBeVisible();
    await page.evaluate(() => {
        window.beginPreview();
        window.previewTime = 23;
        const previous = window.owner;
        window.owner = { controller: new AbortController() };
        window.previewDoc = { id: "other-track" };
        previous.controller.abort();
        window.preview.end();
    });
    await expect(page.locator(".lb-preview-playback-bar")).toHaveCount(0);
    expect(await page.evaluate(() => ({ doc: window.previewDoc.id, time: window.previewTime }))).toEqual({ doc: "other-track", time: 23 });
    await expect(page.locator("#source-panel")).toBeHidden();
});

test("preview overlay respects the lyric view origin and width below a Jellyfin header", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await fixture(page);
    await page.evaluate(() => {
        document.body.style.minHeight = "2000px";
        const header = document.createElement("header");
        header.className = "skinHeader";
        header.style.cssText = "position:fixed;inset:0 0 auto;height:110px;background:#333";
        header.textContent = "Jellyfin navigation";
        document.body.append(header);
        const host = document.getElementById("lyrics");
        host.className = "lyricPage";
        host.style.cssText = "position:relative;margin:140px 0 0 60px;width:280px;height:380px";
        const bar = document.createElement("div");
        bar.className = "lb-preview-playback-bar";
        bar.textContent = "Previewing original";
        const back = document.createElement("button");
        back.textContent = "Return";
        bar.append(back);
        window.cards.setPreview(bar);
    });
    const root = page.locator(".lb-tools");
    await expect
        .poll(() =>
            root.evaluate((node) => {
                const box = node.getBoundingClientRect(),
                    host = document.getElementById("lyrics").getBoundingClientRect(),
                    header = document.querySelector(".skinHeader").getBoundingClientRect();
                return box.top >= host.top && box.top >= header.bottom && box.left >= host.left && box.right <= host.right;
            }),
        )
        .toBe(true);
    const before = await root.boundingBox();
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(async () => Math.abs((await root.boundingBox()).y - before.y)).toBeLessThan(1);
});
