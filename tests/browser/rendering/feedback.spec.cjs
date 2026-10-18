const { test, expect } = require("playwright/test");
const { feedbackFixture } = require("../../../frontend/feedback-fixture.mjs");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const code = feedbackFixture(resolve(__dirname, "../../../frontend"));

for (const family of ["glass", "material"]) {
    test(family + " feedback preserves focus and details, replaces expiry and disposes", async ({ page }) => {
        // Both stylesheets are present in Jellyfin; the adapters must stay isolated.
        const css =
            readFileSync(resolve(__dirname, "../../../frontend/assets/lyricbridge.css"), "utf8") +
            readFileSync(resolve(__dirname, "../../../frontend/admin/config.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
        await page.setContent(
            "<style>" +
                css +
                '</style><div id="LyricBridgeConfig"><div id="notice" class="' +
                (family === "glass" ? "lb-feedback" : "fieldDescription") +
                '"></div><div id="other"></div></div>',
        );
        await page.addScriptTag({ content: code });
        await page.evaluate((family) => {
            const scope = new window.fixture.FeedbackScope(family === "glass" ? window.fixture.glassFeedback : window.fixture.materialFeedback);
            const root = document.getElementById("notice");
            window.scope = scope;
            window.clicks = 0;
            window.options = {
                message: "A long actionable warning. ".repeat(8),
                severity: "warning",
                details: ["Diagnostic reference"],
                actions: [{ label: "Retry", run: () => window.clicks++ }],
            };
            scope.update(root, window.options);
        }, family);
        await expect(page.locator("#notice")).toHaveAttribute("role", "alert");
        await expect(page.locator("#notice")).not.toHaveClass(family === "glass" ? /lb-material-feedback/ : /lb-feedback-element/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByText("Details", { exact: true }).click();
        const retry = page.getByRole("button", { name: "Retry", exact: true });
        await retry.focus();
        await page.evaluate(() => window.scope.update(document.getElementById("notice"), { ...window.options, message: "Updated warning" }));
        await expect(retry).toBeFocused();
        await expect(page.locator("details")).toHaveAttribute("open", "");
        await retry.click();
        expect(await page.evaluate(() => window.clicks)).toBe(1);
        await page.locator("summary").focus();
        await page.evaluate(() =>
            window.scope.update(document.getElementById("notice"), { ...window.options, details: ["Updated diagnostic reference"] }),
        );
        await expect(page.locator("summary")).toBeFocused();
        await expect(page.locator("details")).toHaveAttribute("open", "");
        await page.evaluate(() =>
            window.scope.update(document.getElementById("notice"), {
                ...window.options,
                actions: [{ label: "Retry", run: () => window.clicks++, busy: true }],
            }),
        );
        await expect(retry).toBeDisabled();
        await expect(retry).toHaveAttribute("aria-busy", "true");
        await page.evaluate(() => window.scope.update(document.getElementById("notice"), window.options));
        await expect(retry).toBeEnabled();
        const message = await page.locator(family === "glass" ? ".lb-feedback-message" : ".lb-material-message").boundingBox();
        const action = await retry.boundingBox();
        expect(action.y).toBeGreaterThanOrEqual(message.y + message.height);
        if (family === "glass") {
            const glyph = await page.locator("#notice .lb-feedback-icon svg").boundingBox();
            expect(Math.abs(glyph.y + glyph.height / 2 - (message.y + 21 / 2))).toBeLessThanOrEqual(1);
        }
        await page.evaluate(() => {
            window.scope.update(document.getElementById("notice"), { message: "Saved", severity: "success", ttl: 30 });
            window.scope.update(document.getElementById("notice"), { message: "Still running", severity: "progress" });
        });
        await page.waitForTimeout(60);
        await expect(page.locator("#notice")).toBeVisible();
        await expect(page.locator("#notice")).toContainText("Still running");
        await expect(page.locator("#notice button")).toHaveCount(0);
        await page.evaluate(() => {
            window.scope.update(document.getElementById("other"), { message: "Independent", severity: "error" });
            window.scope.update(document.getElementById("notice"), { message: "Saved", severity: "success", ttl: 30 });
            window.scope.dispose();
        });
        await page.waitForTimeout(60);
        await expect(page.locator("#notice")).toBeHidden();
        await expect(page.locator("#other")).toBeHidden();
        await page.clock.install({ time: new Date("2026-10-13T00:00:00Z") });
        await page.clock.pauseAt(new Date("2026-10-13T00:00:10Z"));
        await page.evaluate(() =>
            window.scope.update(document.getElementById("notice"), { message: "Failure requires dismissal", severity: "error" }),
        );
        await page.clock.runFor(10000);
        await expect(page.locator("#notice")).toBeVisible();
        await page.evaluate(() => window.scope.update(document.getElementById("notice"), { message: "Saved", severity: "success" }));
        await page.clock.runFor(3999);
        await expect(page.locator("#notice")).toBeVisible();
        await page.clock.runFor(1);
        await expect(page.locator("#notice")).toBeHidden();
        if (family === "material") {
            for (const color of ["rgb(20, 20, 20)", "rgb(240, 240, 240)"]) {
                const actual = await page.evaluate((color) => {
                    document.getElementById("LyricBridgeConfig").style.color = color;
                    window.scope.update(document.getElementById("notice"), { message: "Theme inheritance", severity: "info" });
                    return getComputedStyle(document.querySelector(".lb-material-message")).color;
                }, color);
                expect(actual).toBe(color);
            }
        }
    });
}
