const { test, expect } = require("playwright/test");
const { mountAdmin } = require("../fixtures/admin-fixture.cjs");
const dataRoot = (page) => page.locator("#lb-data-manager");
const tab = (page, name) => page.getByRole("tablist", { name: "LyricBridge settings" }).getByRole("tab", { name, exact: true });

test("@workflow Data inspection preserves drafts and Back restores applied filters and page", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mountAdmin(page);
    expect(await page.evaluate(() => window.adminFixture.calls.filter((call) => call.path.includes("/data/")).length)).toBe(0);
    await page.locator("#lb-storage").fill("/unsaved/storage");
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await expect(page.locator(".lb-config-footer")).toBeHidden();
    await expect(data.getByRole("table", { name: "Stored content categories" })).toBeVisible();
    await data.getByRole("tab", { name: "Songs", exact: true }).click();
    await data.getByLabel("Search names or IDs").fill("Fixture");
    await data.locator(".lb-data-filter-actions .checkboxContainer").click();
    expect(await page.evaluate(() => window.adminFixture.calls.filter((call) => call.path.endsWith("data/songs")).length)).toBe(1);
    await data.getByRole("button", { name: "Search", exact: true }).click();
    await expect
        .poll(() => page.evaluate(() => window.adminFixture.calls.filter((call) => call.path.endsWith("data/songs")).at(-1).search))
        .toContain("missing=true");
    await data.getByRole("button", { name: "Next data page" }).click();
    await data.getByRole("button", { name: "Open Missing song", exact: true }).click();
    await data.getByRole("button", { name: "Inspect transcript", exact: true }).click();
    await expect(data).toContainText("Hello from stored lyrics");
    await data.getByRole("button", { name: "Back to previous view" }).click();
    await expect(data.getByRole("button", { name: "Delete transcript", exact: true })).toBeDisabled();
    await data.getByRole("button", { name: "Back to songs" }).click();
    await expect(data.getByLabel("Search names or IDs")).toHaveValue("Fixture");
    await expect(data).toContainText("51–51 of 51");
    await expect(data.getByRole("button", { name: "Open Missing song", exact: true })).toBeFocused();
    await tab(page, "General").click();
    await expect(page.locator("#lb-storage")).toHaveValue("/unsaved/storage");
    expect(await page.evaluate(() => window.adminFixture.writes.length)).toBe(0);
    expect(errors).toEqual([]);
});

test("@workflow cross-page selection is explicit, review is dedicated, partial failures retain unsuccessful selections", async ({ page }) => {
    await mountAdmin(page);
    await page.evaluate(() => {
        window.adminFixture.manyRecords = true;
        window.adminFixture.partial = true;
    });
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await data.getByRole("tab", { name: "Songs", exact: true }).click();
    await data.getByRole("button", { name: "Open Missing song", exact: true }).click();
    await data.getByRole("checkbox", { name: "Select saved-original:record0", exact: true }).locator("..").click();
    await data.getByRole("button", { name: "Next data page" }).click();
    await data.getByRole("checkbox", { name: "Select saved-original:record50", exact: true }).locator("..").click();
    await data.getByRole("button", { name: "Refresh data" }).click();
    await expect(data.locator(".lb-selection-bar")).toContainText("2 selected");
    await data.getByRole("button", { name: "Review selected", exact: true }).click();
    await expect(data.getByRole("region", { name: "Selected records" })).toContainText("record0");
    await data.getByRole("button", { name: "Preview selected deletion" }).click();
    await expect(data.getByRole("heading", { name: "Review deletion" })).toBeVisible();
    await expect(data.getByRole("button", { name: "Select removable on this page" })).toBeHidden();
    expect(await page.evaluate(() => window.adminFixture.preview.targets.map((target) => target.id))).toEqual(["record0", "record50"]);
    await data.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(data).toContainText("failed: 1");
    await data.getByRole("button", { name: "Return and refresh" }).click();
    await expect(data.locator(".lb-selection-bar")).toContainText("1 selected");
    await data.getByRole("button", { name: "Back to songs" }).click();
    await data.getByRole("button", { name: "Open Missing song", exact: true }).click();
    await expect(data.locator(".lb-selection-bar")).toContainText("0 selected");
});

test("@workflow preview failures, expiration and factory reset never silently reuse confirmation or discard settings", async ({ page }) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/unsaved");
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await data.getByRole("tab", { name: "Maintenance", exact: true }).click();
    await data.getByLabel("Maintenance category").selectOption("originals");
    await data.getByRole("button", { name: "Clear this category" }).click();
    await data.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.evaluate(() => {
        window.adminFixture.failExecute = true;
    });
    await data.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(data).toContainText("Confirmation is no longer usable");
    await data.getByRole("button", { name: "Return and refresh" }).click();
    await data.getByRole("button", { name: "Factory reset plugin" }).click();
    await expect(data).toContainText("Discard unsaved settings before factory reset?");
    await data.getByRole("button", { name: "Keep editing settings" }).click();
    await tab(page, "General").click();
    await expect(page.locator("#lb-storage")).toHaveValue("/unsaved");
    await tab(page, "Data").click();
    await data.getByRole("button", { name: "Factory reset plugin" }).click();
    await data.getByRole("button", { name: "Discard edits and preview factory reset" }).click();
    await expect(data.getByRole("button", { name: "Confirm deletion", exact: true })).toBeDisabled();
    await data.getByLabel("Type FACTORY RESET to confirm").fill("FACTORY RESET");
    await page.evaluate(() => {
        window.adminFixture.failExecute = false;
    });
    await data.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(data).toContainText("Data action finished");
    await data.getByRole("button", { name: "Return and refresh" }).click();
    await page.evaluate(() => {
        window.adminFixture.expirePreview = true;
    });
    await data.getByRole("button", { name: "Clear this category" }).click();
    await data.getByLabel("Type DELETE to confirm").fill("DELETE");
    await expect(data.getByRole("button", { name: "Confirm deletion", exact: true })).toBeDisabled();
});

test("@layout shared admin rows, compact summaries, secondary navigation and detail views fit mobile", async ({ page }, testInfo) => {
    await mountAdmin(page);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await expect(data.getByRole("table").getByRole("columnheader")).toHaveText(["Category", "Records", "Content size"]);
    await page.screenshot({ path: testInfo.outputPath("admin-data-overview-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
        .poll(() =>
            tab(page, "Data").evaluate((node) => {
                const rect = node.getBoundingClientRect(),
                    strip = node.parentElement.getBoundingClientRect();
                return rect.left >= strip.left - 1 && rect.right <= strip.right + 1;
            }),
        )
        .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(data.getByRole("table").getByRole("columnheader")).toHaveCount(3);
    await data.getByRole("tab", { name: "Songs", exact: true }).click();
    await data.getByRole("button", { name: "Open Missing song", exact: true }).click();
    await expect(data.locator(".lb-data-record")).toHaveCount(2);
    await expect(data.getByRole("checkbox", { name: "Select transcript:transcript", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const alignment = await data
        .locator(".lb-data-record")
        .first()
        .evaluate((row) => {
            const checkbox = row.querySelector(".lb-selection-checkbox").getBoundingClientRect();
            const main = row.querySelector(".lb-settings-row-main").getBoundingClientRect();
            return checkbox.top < main.bottom && checkbox.bottom > main.top;
        });
    expect(alignment).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("admin-data-records-mobile.png"), fullPage: true });
    await data.getByRole("button", { name: "Inspect saved-original", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(data).toContainText("Hello from stored lyrics");
    await data.getByRole("tab", { name: "Songs", exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(data.getByRole("tab", { name: "Overview", exact: true })).toBeFocused();
    await tab(page, "Data").focus();
    await page.keyboard.press("Home");
    await expect(tab(page, "General")).toBeFocused();
});

test("@workflow account resets and saved configuration stay separate from settings drafts", async ({ page }, testInfo) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/draft");
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await data.getByRole("tab", { name: "Accounts", exact: true }).click();
    await data.getByRole("button", { name: "Open Missing account", exact: true }).click();
    await data.getByRole("button", { name: "Reset this account’s stored preferences", exact: true }).click();
    await expect(data.getByLabel("Type RESET to confirm")).toBeVisible();
    expect(await page.evaluate(() => window.adminFixture.preview.userId)).toBe("22222222-2222-2222-2222-222222222222");
    await data.getByRole("button", { name: "Cancel deletion", exact: true }).click();
    await data.getByRole("tab", { name: "Configuration", exact: true }).click();
    await expect(data.getByRole("heading", { name: "Saved plugin configuration", exact: true })).toBeVisible();
    await expect(data.getByRole("region", { name: "Sources", exact: true })).toContainText("Configured");
    expect(await data.textContent()).not.toContain("SAVED-SOURCE-SECRET");
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const general = data.getByRole("region", { name: "General", exact: true });
        const title = general.getByRole("heading", { name: "General", exact: true });
        const edit = general.getByRole("button", { name: "Edit general", exact: true });
        await expect(title).toHaveText("General");
        await expect(edit).toHaveText("Edit");
        const a = await title.boundingBox(),
            b = await edit.boundingBox();
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
        expect(Math.abs(b.y + b.height / 2 - (a.y + a.height / 2))).toBeLessThan(2);
        await page.screenshot({ path: testInfo.outputPath("saved-configuration-" + width + ".png"), fullPage: true });
    }
    await data.getByRole("button", { name: "Edit general", exact: true }).click();
    await expect(page.locator("#lb-storage")).toHaveValue("/draft");
    expect(await page.evaluate(() => window.adminFixture.writes.length)).toBe(0);
});

test("@layout inspection uses readable boundary content, one heading and nested Back on desktop and mobile", async ({ page }, testInfo) => {
    await mountAdmin(page);
    await page.evaluate(() => {
        const base = window.adminFixture.records[0];
        window.adminFixture.records = [
            {
                ...base,
                target: { kind: "boundary-version", id: "untitled-boundary" },
                title: "boundary-version",
                displayType: "Line-break version",
                canDelete: false,
                inspection: {
                    lines: [
                        { text: "君の声が聞こえる", startSeconds: 65 },
                        { text: "Hello world", startSeconds: 68 },
                    ],
                    fields: [],
                    metadata: [],
                    restriction: "Managed through its transcript.",
                    canCancel: false,
                    relationships: [{ role: "owner", target: { kind: "transcript", id: "transcript" }, label: "Transcript", missing: false }],
                },
            },
            window.adminFixture.records[1],
        ];
    });
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await data.getByRole("tab", { name: "Songs", exact: true }).click();
    await data.getByRole("button", { name: "Open Missing song", exact: true }).click();
    await data.getByRole("button", { name: "Inspect boundary-version", exact: true }).click();
    const screen = data.locator(".lb-admin-screen:visible");
    await expect(screen.getByRole("heading", { level: 3 })).toHaveText(["Line-break version"]);
    await expect(screen).toContainText("1:05");
    await expect(screen).toContainText("君の声が聞こえる");
    await expect(screen.locator(".lb-settings-row")).toHaveCount(0);
    await expect(data.locator(".lb-data-notice")).toBeHidden();
    await expect(screen.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("boundary-inspection-" + width + ".png"), fullPage: true });
    }
    await screen.getByRole("button", { name: "Transcript", exact: true }).first().click();
    await expect(data.locator(".lb-admin-screen:visible").getByRole("heading", { level: 3 })).toHaveText(["Transcript"]);
    await data.getByRole("button", { name: "Back to previous view", exact: true }).click();
    await expect(screen.getByRole("heading", { level: 3 })).toHaveText(["Line-break version"]);
});

test("@workflow dependency inspection preserves snapshot confirmation and is read-only through relationships", async ({ page }) => {
    await mountAdmin(page);
    await page.clock.install();
    await page.evaluate(() => {
        window.adminFixture.records[0].inspection.relationships = [
            { role: "source", target: { kind: "transcript", id: "transcript" }, label: "Transcript", missing: false },
        ];
    });
    await tab(page, "Data").click();
    const data = dataRoot(page);
    await data.getByRole("tab", { name: "Maintenance", exact: true }).click();
    await data.getByLabel("Maintenance category").selectOption("originals");
    await data.getByRole("button", { name: "Clear this category" }).click();
    await data.getByLabel("Type DELETE to confirm").fill("DELETE");
    const token = await page.evaluate(() => window.adminFixture.preview);
    await data.getByRole("button", { name: "Inspect Original lyrics", exact: true }).click();
    const inspector = data.locator(".lb-inspection:visible");
    await expect(inspector.getByRole("heading", { name: "Original lyrics", exact: true })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Cancel request", exact: true })).toHaveCount(0);
    await inspector.getByRole("button", { name: "Transcript", exact: true }).click();
    const nested = data.locator(".lb-inspection:visible");
    await expect(nested.getByRole("heading", { name: "Transcript", exact: true })).toBeVisible();
    await expect(nested.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.clock.fastForward(600001);
    await nested.getByRole("button", { name: "Back to previous record" }).click();
    await inspector.getByRole("button", { name: "Back to previous view" }).click();
    await expect(data.getByRole("button", { name: "Confirm deletion", exact: true })).toBeDisabled();
    await expect(data.getByLabel("Type DELETE to confirm")).toHaveValue("DELETE");
    expect(await page.evaluate(() => window.adminFixture.preview)).toEqual(token);
    await expect(data.getByRole("button", { name: "Inspect Original lyrics", exact: true })).toBeFocused();
});

test("@workflow stored request inspection restores its list and settings draft", async ({ page }) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/inspection-draft");
    await tab(page, "Requests").click();
    const row = page.locator('[data-job-id="job1"]');
    await row.getByRole("button", { name: "Inspect stored request" }).click();
    const inspector = page.locator(".lb-inspection:visible");
    await expect(inspector.getByRole("heading", { name: "Generation request", exact: true })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Cancel request", exact: true })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await inspector.getByRole("button", { name: "Back to previous view", exact: true }).click();
    await expect(row.getByRole("button", { name: "Inspect stored request" })).toBeFocused();
    await tab(page, "General").click();
    await expect(page.locator("#lb-storage")).toHaveValue("/inspection-draft");
});
