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
