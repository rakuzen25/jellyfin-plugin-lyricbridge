const { test, expect } = require("playwright/test");
const { mountAdmin } = require("../fixtures/admin-fixture.cjs");
const tab = (page, name) => page.getByRole("tablist", { name: "LyricBridge settings" }).getByRole("tab", { name, exact: true });

test("@workflow one settings draft preserves editors, credentials, saved-only tests and save failure recovery", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mountAdmin(page, { nativeControls: false });
    await expect(page.locator("#lb-reset-open")).toHaveCount(0);
    await page.locator("#lb-storage").fill("/unsaved");
    await tab(page, "Sources").click();
    await expect(page.locator('[data-source="QQ"]').getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Move down QQ", exact: true }).click();
    await expect(page.locator("#lb-sources [data-source]").first()).toHaveAttribute("data-source", "NetEase");
    const spotify = page.locator('[data-source="Spotify"]');
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(spotify).toContainText("Credential configured");
    await spotify.getByRole("button", { name: "Replace credential" }).click();
    await spotify.getByLabel("Replacement credential").fill("CANCELLED-SECRET");
    await tab(page, "Services").click();
    await page.locator('[data-connection-id="connection"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(tab(page, "Sources")).toHaveAttribute("aria-selected", "true");
    await spotify.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Discard changes", exact: true }).click();
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await spotify.getByRole("button", { name: "Replace credential" }).click();
    await expect(spotify.getByLabel("Replacement credential")).toHaveValue("");
    await spotify.getByLabel("Replacement credential").fill("NEW-SOURCE-SECRET");
    await spotify.getByRole("button", { name: "Apply", exact: true }).click();
    await tab(page, "Services").click();
    await page.locator('[data-capability="translation"] > summary').click();
    await page.locator('[data-option-id="translation"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Test saved settings" })).toBeEnabled();
    await expect(page.getByRole("combobox", { name: "Provider", exact: true })).toHaveValue("AI");
    await expect(page.getByRole("combobox", { name: "Connection", exact: true })).toHaveValue("connection");
    await page.getByLabel("Model ID").fill("draft-model");
    await expect(page.getByRole("button", { name: "Test saved settings" })).toBeDisabled();
    await page.locator(".lb-service-editor").getByRole("button", { name: "Apply", exact: true }).click();
    await tab(page, "General").click();
    await expect(page.locator("#lb-storage")).toHaveValue("/unsaved");
    await page.evaluate(() => {
        window.adminFixture.failSave = true;
    });
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.locator("#lb-config-status")).toContainText("Settings were not saved");
    await page.evaluate(() => {
        window.adminFixture.failSave = false;
    });
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.locator("#lb-config-status")).toContainText("Settings saved");
    const write = await page.evaluate(() => window.adminFixture.writes[0]);
    expect(write.configuration.StoragePath).toBe("/unsaved");
    expect(write.configuration.Sources.find((source) => source.Name === "Spotify").Credential).toBe("");
    expect(write.credentials).toContainEqual({ kind: "source", id: "Spotify", action: "replace", value: "NEW-SOURCE-SECRET" });
    expect(write.configuration.ServiceSetup.Options.find((option) => option.Id === "translation").Model).toBe("draft-model");
    expect(await page.locator("body").textContent()).not.toContain("SAVED-SOURCE-SECRET");
    expect(errors).toEqual([]);
});

test("@workflow conflict comparison keeps drafts and requires explicit resolution before saving again", async ({ page }) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/mine");
    await page.evaluate(() => {
        window.adminFixture.config.StoragePath = "/remote";
        window.adminFixture.config.MinimumMatch = 80;
        window.adminFixture.revision++;
    });
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    const conflict = page.getByRole("region", { name: "Settings conflict" });
    await expect(conflict).toContainText("StoragePath");
    await expect(conflict.getByRole("button", { name: "Rebase draft", exact: true })).toBeDisabled();
    await conflict.getByRole("button", { name: "Use draft", exact: true }).click();
    await conflict.getByRole("button", { name: "Rebase draft", exact: true }).click();
    expect(await page.evaluate(() => window.adminFixture.writes.length)).toBe(0);
    await expect(page.locator("#lb-storage")).toHaveValue("/mine");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.locator("#lb-config-status")).toContainText("Settings saved");
    const saved = await page.evaluate(() => window.adminFixture.writes[0].configuration);
    expect(saved.StoragePath).toBe("/mine");
    expect(saved.MinimumMatch).toBe(80);
});

test("@workflow requests use separate lists, confirmed cancellation and the shared history review", async ({ page }) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/draft");
    await tab(page, "Requests").click();
    await expect(page.getByRole("region", { name: "Active requests" })).toBeVisible();
    const active = page.getByRole("region", { name: "Active requests" });
    await active.locator('[data-job-id="job0"]').getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.adminFixture.calls.filter((call) => call.path.endsWith("/job0/cancel")).length)).toBe(0);
    await active.getByRole("button", { name: "Confirm cancel", exact: true }).click();
    const history = page.getByRole("region", { name: "Finished history" });
    await expect(history).toContainText("Fixture request 0");
    await history.locator('[data-job-id="job3"]').getByRole("button", { name: "Remove from history", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review deletion" })).toBeVisible();
    await expect(active).toBeHidden();
    await page.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await page.getByRole("button", { name: "Return and refresh" }).click();
    await expect(history.locator('[data-job-id="job3"]')).toHaveCount(0);
    await tab(page, "General").click();
    await expect(page.locator("#lb-storage")).toHaveValue("/draft");
    expect(await page.evaluate(() => window.adminFixture.writes.length)).toBe(0);
});

test("@layout all settings tabs use consistent panels, controls and scrolling navigation", async ({ page }, testInfo) => {
    await mountAdmin(page);
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const name of ["General", "Sources", "Services", "Display defaults", "Requests", "Data"]) {
            await tab(page, name).click();
            await expect(page.locator('[data-tab="' + name + '"] .lb-settings-surface').first()).toBeVisible();
            expect(
                await tab(page, name).evaluate((node) => {
                    const rect = node.getBoundingClientRect(),
                        parent = node.parentElement.getBoundingClientRect();
                    return rect.left >= parent.left - 1 && rect.right <= parent.right + 1;
                }),
            ).toBe(true);
            if (name === "Sources") {
                await expect(page.locator('[data-source="Musixmatch"] .lb-config-badge')).toHaveText("Token optional");
                await expect(page.locator('[data-source="AppleMusic"] .lb-settings-row-description')).toContainText("Choose Edit to configure");
                await expect(page.locator(".lb-source-row > p")).toHaveCount(0);
                for (const source of ["Musixmatch", "Spotify", "AppleMusic"]) {
                    expect(
                        await page.locator('[data-source="' + source + '"]').evaluate((row) => {
                            const title = row.querySelector(".lb-settings-row-title").getBoundingClientRect();
                            const description = row.querySelector(".lb-settings-row-description").getBoundingClientRect();
                            return Math.abs(title.left - description.left) < 1 && description.top >= title.bottom;
                        }),
                    ).toBe(true);
                }
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            const minHeight = await tab(page, name).evaluate((node) => parseFloat(getComputedStyle(node).minHeight));
            expect(minHeight).toBeGreaterThanOrEqual(44);
            await page.screenshot({
                path: testInfo.outputPath("admin-" + name.replaceAll(" ", "-") + "-" + width + ".png"),
                fullPage: true,
                style: ".lb-config-footer { visibility: hidden !important; }",
            });
        }
    }
    await tab(page, "Display defaults").click();
    const preview = page.locator(".lb-display-preview"),
        controls = page.locator(".lb-display-controls");
    expect((await preview.boundingBox()).y).toBeLessThan((await controls.boundingBox()).y);
    await page.setViewportSize({ width: 1280, height: 900 });
    expect((await preview.boundingBox()).x).toBeGreaterThan((await controls.boundingBox()).x);
});

test("@workflow request panels keep independent pagination through refresh", async ({ page }) => {
    await mountAdmin(page);
    await page.evaluate(() => {
        const fixture = window.adminFixture,
            active = fixture.jobs[0],
            finished = fixture.jobs[3];
        fixture.jobs = [
            ...Array.from({ length: 61 }, (_, i) => ({ ...active, id: "active" + i })),
            ...Array.from({ length: 61 }, (_, i) => ({ ...finished, id: "finished" + i })),
        ];
    });
    await tab(page, "Requests").click();
    await page.getByRole("region", { name: "Finished history" }).getByRole("button", { name: "Older finished requests" }).click();
    await expect(page.getByRole("region", { name: "Finished history" })).toContainText("51–61 of 61");
    await expect(page.getByRole("region", { name: "Active requests" })).toContainText("1–50 of 61");
    await page.getByRole("region", { name: "Active requests" }).getByRole("button", { name: "Older active requests" }).click();
    await page.getByRole("button", { name: "Refresh history", exact: true }).click();
    await expect(page.getByRole("region", { name: "Finished history" })).toContainText("51–61 of 61");
    await expect(page.getByRole("region", { name: "Active requests" })).toContainText("51–61 of 61");
});

test("@layout management rows share action styling, alignment and compact detail spacing", async ({ page }, testInfo) => {
    await mountAdmin(page);
    let reference;
    async function checkRows(root, width) {
        for (const row of await root.locator(".lb-settings-row > .lb-settings-row-heading").all()) {
            if (!(await row.isVisible())) continue;
            const controls = row.locator(":scope > .lb-settings-row-actions button");
            for (const control of await controls.all()) {
                await expect(control).toHaveClass(/lb-row-action/);
                const style = await control.evaluate((node) => {
                    const css = getComputedStyle(node);
                    return {
                        height: css.minHeight,
                        padding: css.padding,
                        weight: css.fontWeight,
                        size: css.fontSize,
                        radius: css.borderRadius,
                        shadow: css.boxShadow,
                    };
                });
                reference ||= style;
                expect(style).toEqual(reference);
            }
            if (await controls.count()) {
                expect(
                    await row.evaluate((node, width) => {
                        const main = node.querySelector(".lb-settings-row-main").getBoundingClientRect();
                        const actions = node.querySelector(".lb-settings-row-actions").getBoundingClientRect();
                        return width <= 600
                            ? actions.top >= main.bottom - 1 && Math.abs(actions.left - main.left) < 1
                            : actions.left >= main.right - 1;
                    }, width),
                ).toBe(true);
            }
            expect(
                await row
                    .locator(".lb-settings-row-body > details")
                    .evaluateAll((nodes) => nodes.every((node) => parseFloat(getComputedStyle(node).marginTop) <= 8)),
            ).toBe(true);
        }
    }
    for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await tab(page, "Sources").click();
        await checkRows(page.locator('[data-tab="Sources"]'), width);
        await tab(page, "Services").click();
        for (const summary of await page.locator("[data-capability] > summary").all()) {
            if (!(await summary.evaluate((node) => node.parentElement.open))) await summary.click();
        }
        await checkRows(page.locator('[data-tab="Services"]'), width);
        await tab(page, "Requests").click();
        const requests = page.locator('[data-tab="Requests"]');
        await expect(requests.getByRole("region", { name: "Finished history" })).toBeVisible();
        await checkRows(requests, width);
        await expect(requests.getByRole("button", { name: "Remove from history" }).first()).toHaveClass(/lb-material-destructive/);
        await page.screenshot({
            path: testInfo.outputPath("row-actions-history-" + width + ".png"),
            fullPage: true,
            style: ".lb-config-footer { visibility:hidden !important; }",
        });
        await tab(page, "Data").click();
        const data = page.locator("#lb-data-manager");
        await data.getByRole("tab", { name: "Overview", exact: true }).click();
        await expect(data.getByRole("table")).toBeVisible();
        const gap = await data.evaluate(
            (node) =>
                node.querySelector(".lb-admin-screen > .lb-settings-surface").getBoundingClientRect().top -
                node.querySelector(".lb-data-notice").getBoundingClientRect().bottom,
        );
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(16);
        await data.getByRole("tab", { name: "Maintenance", exact: true }).click();
        await expect(data.getByRole("region", { name: "Cleanup", exact: true })).toBeVisible();
        await checkRows(data, width);
        await data.getByRole("tab", { name: "Songs", exact: true }).click();
        await expect(data.getByRole("button", { name: "Open Missing song", exact: true })).toBeVisible();
        await checkRows(data, width);
        await data.getByRole("button", { name: "Open Missing song", exact: true }).click();
        await expect(data.getByRole("button", { name: "Inspect transcript", exact: true })).toBeVisible();
        await checkRows(data, width);
        await page.screenshot({ path: testInfo.outputPath("row-actions-data-" + width + ".png"), fullPage: true });
    }
});

const unloadBlocked = (page) => page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
const unsavedDialog = (page) => page.getByRole("dialog", { name: "Unsaved changes" });
async function departureLink(page) {
    await page.evaluate(() => {
        const link = document.createElement("a");
        link.id = "test-departure";
        link.href = "#/dashboard";
        link.textContent = "Leave settings";
        link.style.cssText = "position:fixed;top:0;right:0;z-index:10000;background:#222;padding:8px";
        document.body.append(link);
        window.departures = 0;
        document.addEventListener("click", (event) => {
            if (event.target.closest("#test-departure")) {
                event.preventDefault();
                window.departures++;
                document.querySelector("#LyricBridgeConfig").dispatchEvent(new Event("viewhide"));
            }
        });
    });
    return page.locator("#test-departure");
}

test("@workflow editor warnings track changed and reverted values across settings tabs", async ({ page }) => {
    await mountAdmin(page);
    expect(await unloadBlocked(page)).toBe(false);
    await tab(page, "Sources").click();
    const spotify = page.locator('[data-source="Spotify"]');
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    expect(await unloadBlocked(page)).toBe(false);
    await spotify.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await spotify.getByRole("button", { name: "Replace credential" }).click();
    await spotify.getByLabel("Replacement credential").fill("NEW-SECRET");
    expect(await unloadBlocked(page)).toBe(true);
    await expect(tab(page, "Sources")).toHaveAttribute("aria-description", "Unsaved changes");
    await tab(page, "General").click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    expect(await unloadBlocked(page)).toBe(true);
    await tab(page, "Sources").click();
    await spotify.getByRole("button", { name: "Cancel replacement" }).click();
    expect(await unloadBlocked(page)).toBe(false);
    await spotify.getByRole("button", { name: "Clear credential" }).click();
    expect(await unloadBlocked(page)).toBe(true);
    await spotify.getByRole("button", { name: "Undo clear" }).click();
    expect(await unloadBlocked(page)).toBe(false);
    await spotify.getByRole("button", { name: "Apply", exact: true }).click();
    expect(await unloadBlocked(page)).toBe(false);
    await tab(page, "Services").click();
    await page.locator('[data-capability="translation"] > summary').click();
    const row = page.locator('[data-option-id="translation"]');
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    expect(await unloadBlocked(page)).toBe(false);
    await page.getByLabel("Model ID", { exact: true }).fill("changed-model");
    expect(await unloadBlocked(page)).toBe(true);
    await page.getByLabel("Model ID", { exact: true }).fill("fixture-model");
    expect(await unloadBlocked(page)).toBe(false);
    await page.getByLabel("Model ID", { exact: true }).fill("changed-model");
    await page.locator(".lb-service-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(unsavedDialog(page).locator("p")).toBeFocused();
    await expect(unsavedDialog(page).locator("button")).toHaveClass([
        "emby-button button-flat lb-settings-action",
        "emby-button button-flat lb-settings-action",
    ]);
    const keepEditing = unsavedDialog(page).getByRole("button", { name: "Keep editing", exact: true });
    await keepEditing.hover();
    await expect(keepEditing).toHaveCSS("background-color", "rgba(128, 128, 128, 0.12)");
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    await expect(keepEditing).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Model ID", { exact: true })).toHaveValue("changed-model");
    await expect(page.locator(".lb-service-editor").getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.locator(".lb-service-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    await unsavedDialog(page).getByRole("button", { name: "Discard changes", exact: true }).click();
    expect(await unloadBlocked(page)).toBe(false);
});

test("@workflow departure confirms once, clears all drafts and reloads saved settings on return", async ({ page }) => {
    await mountAdmin(page);
    const leave = await departureLink(page);
    await page.locator("#lb-storage").fill("/draft");
    await tab(page, "Services").click();
    await page.locator('[data-connection-id="connection"]').getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Connection name", { exact: true }).fill("Changed connection");
    await leave.click();
    await expect(unsavedDialog(page)).toHaveCount(1);
    expect(await page.evaluate(() => window.departures)).toBe(0);
    await unsavedDialog(page).getByRole("button", { name: "Keep editing", exact: true }).click();
    expect(await unloadBlocked(page)).toBe(true);
    await leave.click();
    await unsavedDialog(page).getByRole("button", { name: "Discard changes and leave", exact: true }).click();
    expect(await page.evaluate(() => window.departures)).toBe(1);
    expect(await unloadBlocked(page)).toBe(false);
    await page.evaluate(() => {
        window.adminFixture.config.StoragePath = "/server-latest";
    });
    await page.locator("#LyricBridgeConfig").dispatchEvent("viewshow");
    await tab(page, "General").click();
    await expect(page.locator("#lb-storage")).toHaveValue("/server-latest");
    await expect(page.locator(".lb-service-editor")).toHaveCount(0);
    expect(await unloadBlocked(page)).toBe(false);
});

test("@workflow warning follows save outcomes, blocks pending saves and detaches on viewhide", async ({ page }) => {
    await mountAdmin(page);
    const leave = await departureLink(page);
    await page.locator("#lb-storage").fill("/saved");
    await page.evaluate(() => {
        const original = window.ApiClient.ajax;
        window.ApiClient.ajax = async function (options) {
            if (options.type === "PUT" && options.url.includes("admin/settings"))
                await new Promise((resolve) => {
                    window.releaseSave = resolve;
                });
            return original.call(this, options);
        };
    });
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.locator("#lb-config-status")).toContainText("Saving");
    await leave.click();
    await expect(page.locator("#lb-config-status")).toContainText("Wait for settings to finish saving");
    await expect(unsavedDialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.departures)).toBe(0);
    expect(await unloadBlocked(page)).toBe(true);
    await page.evaluate(() => window.releaseSave());
    await expect(page.locator("#lb-config-status")).toContainText("Settings saved");
    expect(await unloadBlocked(page)).toBe(false);
    await page.locator("#lb-storage").fill("/failed");
    await page.evaluate(() => {
        window.adminFixture.failSave = true;
    });
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.evaluate(() => window.releaseSave());
    await expect(page.locator("#lb-config-status")).toContainText("Settings were not saved");
    expect(await unloadBlocked(page)).toBe(true);
    await page.locator("#LyricBridgeConfig").dispatchEvent("viewhide");
    expect(await unloadBlocked(page)).toBe(false);
    await page.locator("#LyricBridgeConfig").dispatchEvent("viewshow");
    expect(await unloadBlocked(page)).toBe(true);
    await expect(page.locator("#lb-storage")).toHaveValue("/failed");
});

test("@workflow row switches confirm changed editors and untouched new editors close freely", async ({ page }) => {
    await mountAdmin(page);
    await tab(page, "Sources").click();
    const spotify = page.locator('[data-source="Spotify"]');
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await tab(page, "Services").click();
    const connection = page.locator('[data-connection-id="connection"]');
    await connection.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await page.getByLabel("Connection name", { exact: true }).fill("Applied connection");
    await tab(page, "Sources").click();
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await unsavedDialog(page).getByRole("button", { name: "Apply and switch", exact: true }).click();
    await expect(tab(page, "Sources")).toHaveAttribute("aria-selected", "true");
    await spotify.getByRole("button", { name: "Replace credential" }).click();
    await spotify.getByLabel("Replacement credential").fill("DISCARD-ME");
    await tab(page, "Services").click();
    await expect(connection).toContainText("Applied connection");
    await connection.getByRole("button", { name: "Edit", exact: true }).click();
    await unsavedDialog(page).getByRole("button", { name: "Discard and switch", exact: true }).click();
    await expect(page.getByLabel("Connection name", { exact: true })).toHaveValue("Applied connection");
    await page.locator(".lb-service-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await page.locator('[data-capability="translation"] > summary').click();
    await page.locator('[data-capability="translation"]').getByRole("button", { name: "Add option", exact: true }).click();
    await page.locator(".lb-service-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    expect(await unloadBlocked(page)).toBe(true);
    await tab(page, "Sources").click();
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await spotify.getByRole("button", { name: "Replace credential" }).click();
    await expect(spotify.getByLabel("Replacement credential")).toHaveValue("");
});

test("@workflow browser reload warns and canceling preserves the draft", async ({ page }) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/keep-me");
    const prompt = page.waitForEvent("dialog");
    await page.evaluate(() => {
        setTimeout(() => location.reload(), 0);
    });
    const dialog = await prompt;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await expect(page.locator("#lb-storage")).toHaveValue("/keep-me");
    expect(await unloadBlocked(page)).toBe(true);
});

test("@workflow navigation exemptions keep the draft without opening discard dialogs", async ({ page }) => {
    await mountAdmin(page);
    await page.locator("#lb-storage").fill("/draft");
    const seen = await page.evaluate(() => {
        const cases = [
            { href: "#/dashboard", target: "_blank" },
            { href: "/export", download: "settings" },
            { href: "#LyricBridgeConfig" },
            { href: "#" },
            { href: "#/dashboard", modified: true },
        ];
        const observed = [];
        for (const item of cases) {
            const link = document.createElement("a");
            link.href = item.href;
            if (item.target) link.target = item.target;
            if (item.download) link.download = item.download;
            link.onclick = (event) => {
                observed.push(event.defaultPrevented);
                event.preventDefault();
            };
            document.body.append(link);
            link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: !!item.modified }));
            link.remove();
        }
        return observed;
    });
    expect(seen).toEqual([false, false, false, false, false]);
    await expect(unsavedDialog(page)).toHaveCount(0);
    expect(await unloadBlocked(page)).toBe(true);
});

test("@workflow late model metadata cannot restore a discarded editor", async ({ page }) => {
    await mountAdmin(page);
    await page.evaluate(() => {
        const original = window.ApiClient.ajax;
        window.ApiClient.ajax = async function (options) {
            if (options.url.includes("service-options/model-limits"))
                await new Promise((resolve) => {
                    window.releaseLimits = resolve;
                });
            return original.call(this, options);
        };
    });
    await tab(page, "Services").click();
    await page.locator('[data-capability="boundary-review"] > summary').click();
    await page.locator('[data-option-id="review"]').getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByText("Advanced generation settings", { exact: true }).click();
    expect(await unloadBlocked(page)).toBe(false);
    await page.getByLabel("Detect model limits automatically", { exact: true }).locator("..").click();
    await expect.poll(() => page.evaluate(() => typeof window.releaseLimits)).toBe("function");
    await page.locator(".lb-service-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    await unsavedDialog(page).getByRole("button", { name: "Discard changes", exact: true }).click();
    await page.evaluate(() => window.releaseLimits());
    await expect
        .poll(() => page.evaluate(() => window.adminFixture.calls.filter((call) => call.path.includes("service-options/model-limits")).length))
        .toBe(1);
    await expect(page.locator(".lb-service-editor")).toHaveCount(0);
    expect(await unloadBlocked(page)).toBe(false);
    await page.locator('[data-option-id="review"]').getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByText("Advanced generation settings", { exact: true }).click();
    await expect(page.getByLabel("Detect model limits automatically", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Model context window (tokens)", { exact: true })).toHaveValue("32768");
});

test("@workflow factory reset ignores an untouched editor and clears it when settings reload", async ({ page }) => {
    await mountAdmin(page);
    await tab(page, "Sources").click();
    await page.locator('[data-source="Spotify"]').getByRole("button", { name: "Edit", exact: true }).click();
    await tab(page, "Data").click();
    const data = page.locator("#lb-data-manager");
    await data.getByRole("tab", { name: "Maintenance", exact: true }).click();
    await data.getByRole("button", { name: "Factory reset plugin", exact: true }).click();
    await expect(data.getByLabel("Type FACTORY RESET to confirm")).toBeVisible();
    await data.getByLabel("Type FACTORY RESET to confirm").fill("FACTORY RESET");
    await data.getByRole("button", { name: "Confirm deletion", exact: true }).click();
    await expect(data).toContainText("Data action finished");
    await data.getByRole("button", { name: "Return and refresh", exact: true }).click();
    await tab(page, "Sources").click();
    await expect(page.locator(".lb-service-editor")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
    expect(await unloadBlocked(page)).toBe(false);
});
