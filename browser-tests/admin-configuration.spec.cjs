const { test, expect } = require("playwright/test");
const path = require("node:path");
const { readFileSync } = require("node:fs");

test("@workflow typed configuration preserves unsaved edits and paginates history", async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
        new URL(route.request().url()).pathname === "/config.html"
            ? route.fulfill({
                  contentType: "text/html",
                  // Jellyfin translates the entire configuration HTML before mounting it.
                  // Missing translation keys become their unwrapped names, even inside scripts.
                  body: readFileSync(path.resolve(__dirname, "../dist/web/config.html"), "utf8").replace(/\$\{([^}]+)\}/g, "$1"),
              })
            : route.fulfill({ status: 204, body: "" }),
    );
    await page.addInitScript(() => {
        const defaults = {
            TranslationLanguage: "zh-Hans",
            SourceLanguage: "auto",
            OriginalChineseScript: "Simplified",
            RomanizationSystem: "Hepburn",
            RowOrder: "pronunciation-first",
            OriginalSize: 40,
            PronunciationSize: 24,
            TranslationSize: 24,
            RowSpacing: 6,
            ShowTranslation: true,
            ShowPronunciation: true,
            JapaneseRomaji: true,
        };
        const config = {
            EnableWebRenderer: true,
            StoragePath: "",
            MinimumMatch: 70,
            ScheduledRetrieval: false,
            AllowUserRequests: false,
            AutoApproveUserRequests: false,
            UserRequestDailyQuota: 5,
            UserRequestActiveCap: 3,
            Defaults: defaults,
            Sources: ["QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "Spotify", "AppleMusic", "LRCLIB"].map((Name) => ({
                Name,
                Enabled: true,
                Credential: "",
            })),
            Services: ["Google", "DeepL", "AI", "LibreTranslate"].map((Name) => ({
                Name,
                Enabled: true,
                Endpoint: "",
                ApiKey: "",
                Model: "",
                ContextBefore: 1,
                ContextAfter: 1,
                ReasoningEffort: "",
                TimeoutSeconds: 15,
            })),
        };
        const option = (Id, Capability, Provider, Name, ConnectionId = null, Enabled = true) => ({
            Id,
            Capability,
            Provider,
            Name,
            ConnectionId,
            Enabled,
            Model: "",
            TimeoutSeconds: 60,
            ReasoningEffort: "",
            ContextBefore: 0,
            ContextAfter: 0,
            UploadFormat: "flac",
            MaxUploadMb: 25,
            MaxInputMb: 256,
        });
        config.ServiceSetup = {
            Version: 1,
            Connections: [{ Id: "audio", Name: "Groq", Provider: "AI", Endpoint: "https://api.groq.com/openai/v1", ApiKey: "" }],
            Options: [
                {
                    ...option("audio-option", "transcription", "AI", "Groq · Whisper", "audio", false),
                    Model: "whisper-large-v3",
                    TimeoutSeconds: 600,
                },
                option("review-option", "boundary-review", "AI", "Groq · Review", "audio"),
                option("google-t", "translation", "Google", "Google"),
                option("google-p", "pronunciation", "Google", "Google"),
                option("local", "pronunciation", "Kawazu", "Japanese romaji"),
            ],
        };
        window.saved = [];
        window.calls = [];
        window.failSave = true;
        window.ApiClient = {
            getPluginConfiguration: async () => structuredClone(config),
            getUrl: (p) => "/base/" + p,
            updatePluginConfiguration: async (id, value) => {
                if (window.failSave) throw new Error("synthetic");
                window.saved.push(structuredClone(value));
                config.StoragePath = value.StoragePath;
                config.EnableWebRenderer = value.EnableWebRenderer;
            },
            ajax: async (options) => {
                window.calls.push(options.url);
                if (options.url.includes("admin/web-renderer"))
                    return {
                        enabled: config.EnableWebRenderer,
                        mechanism: config.EnableWebRenderer ? "direct" : "none",
                        webRoot: "/fixture/web",
                        result: config.EnableWebRenderer ? "Direct injection installed" : "Renderer disabled",
                    };
                if (options.url.includes("admin/runtime"))
                    return {
                        activeStoragePath: "/actual/fixture/storage",
                        configuredStoragePath: config.StoragePath || "/actual/fixture/storage",
                        restartRequired: !!config.StoragePath,
                    };
                if (options.url.includes("service-options/model-limits")) {
                    if (window.failModelLookup) throw new Error("synthetic unavailable metadata");
                    return { available: true, contextWindow: 64000, completionLimit: 4096 };
                }
                if (options.url.includes("jobs/history/finished")) return { ids: ["0", "2"] };
                if (options.url.includes("jobs/history/remove")) {
                    window.removedHistory = JSON.parse(options.data).ids;
                    return { removedIds: window.removedHistory };
                }
                if (options.url.includes("jobs?"))
                    return window.emptyHistory
                        ? []
                        : options.url.includes("offset=0&")
                          ? Array.from({ length: 50 }, (_, i) => ({
                                id: String(i),
                                state: i === 0 ? "failed" : i === 1 ? "pending" : "complete",
                                outputDeleted: i === 0,
                                outputDeletedAt: i === 0 ? "2026-10-11T00:00:00Z" : null,
                                progress: 100,
                                request: { kind: "translation", language: "en" },
                            }))
                          : [];
                return {};
            },
        };
    });
    await page.goto("http://fixture.invalid/config.html");
    await page.locator("#LyricBridgeConfig").dispatchEvent("viewshow");
    await expect(page.locator("[data-source]")).toHaveCount(8);
    await expect(page.getByRole("tab")).toHaveCount(5);
    await expect(page.locator("#lb-effective-storage")).toContainText("/actual/fixture/storage");
    await expect(page.locator("#lb-web-enabled")).toBeChecked();
    await expect(page.locator("#lb-web-status")).toContainText("Direct injection installed");
    await expect(page.locator("#lb-web-status")).toContainText("/fixture/web");
    const sectionSpacing = await page.evaluate(() => {
        const renderer = document.querySelector("#lb-renderer-settings");
        const storage = renderer.nextElementSibling;
        return storage.getBoundingClientRect().top - renderer.getBoundingClientRect().bottom;
    });
    expect(Math.round(sectionSpacing)).toBeGreaterThanOrEqual(24);
    const statusLines = page.locator("#lb-web-status .lb-material-message > div");
    await expect(statusLines).toHaveCount(3);
    await expect(statusLines.nth(1)).toHaveText("Mechanism: direct");
    await expect(statusLines.nth(2)).toHaveText("Web root: /fixture/web");
    expect(
        await statusLines.evaluateAll((lines) =>
            lines.slice(1).every((line, index) => line.getBoundingClientRect().top >= lines[index].getBoundingClientRect().bottom),
        ),
    ).toBe(true);
    await page.locator("#lb-web-repair").click();
    await expect.poll(() => page.evaluate(() => window.calls.includes("/base/LyricBridge/admin/web-renderer/repair"))).toBe(true);
    const saveState = await page.locator("#lb-config-status").textContent();
    await page.locator(".lb-maintenance > summary").click();
    await page.locator("#lb-reset-open").click();
    await page.locator("#lb-reset-word").fill("RESET");
    await expect(page.locator("#lb-reset-submit")).toBeEnabled();
    await expect(page.locator("#lb-config-status")).toHaveText(saveState || "");
    await expect(page.locator("#lb-reset-cancel")).toHaveClass(/raised/);
    await page.locator("#lb-reset-cancel").click();
    await expect(page.locator("#lb-reset-confirm")).toBeHidden();
    await expect(page.locator("#lb-config-status")).toHaveText(saveState || "");
    await page.locator("#lb-web-enabled").uncheck();
    await page.locator("#lb-storage").fill("/synthetic-unsaved");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.locator("#lb-config-status")).toContainText("Settings were not saved");
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    await expect(page.locator("[data-source=Spotify] input[type=checkbox]")).toBeDisabled();
    await expect(page.locator("[data-source=Spotify] input[type=checkbox]")).not.toBeChecked();
    const up = page.getByRole("button", { name: "Move up QQ", exact: true });
    await expect(up).toBeDisabled();
    const down = page.getByRole("button", { name: "Move down QQ", exact: true });
    await expect(down.locator("svg.lb-icon")).toHaveAttribute("aria-hidden", "true");
    expect(
        await down.locator("svg").evaluate((node) => {
            const css = getComputedStyle(node);
            return [css.width, css.height, parseFloat(css.strokeWidth)];
        }),
    ).toEqual(["20px", "20px", 2]);
    await down.locator("svg path").click();
    await expect(page.locator("#lb-sources [data-source]").first()).toHaveAttribute("data-source", "NetEase");
    await page.getByRole("button", { name: "Move up QQ", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#lb-sources [data-source]").first()).toHaveAttribute("data-source", "QQ");
    await expect(page.getByRole("group", { name: "Reorder QQ", exact: true }).getByRole("button")).toHaveCount(2);
    const rowActionStyle = (node) => {
        const css = getComputedStyle(node);
        return { height: css.minHeight, weight: css.fontWeight, radius: css.borderRadius, shadow: css.boxShadow, lineHeight: css.lineHeight };
    };
    const rowActionReference = await page
        .locator('[data-source="Musixmatch"]')
        .getByRole("button", { name: "Edit", exact: true })
        .evaluate(rowActionStyle);
    expect(rowActionReference).toMatchObject({ height: "44px", weight: "400", radius: "3.2px", shadow: "none" });
    expect(await down.evaluate(rowActionStyle)).toEqual({ ...rowActionReference, radius: "50%" });
    const orderIsLeft = (row) => {
        const ordering = row.querySelector(".lb-settings-row-ordering").getBoundingClientRect();
        const main = row.querySelector(".lb-settings-row-main").getBoundingClientRect();
        return ordering.right <= main.left;
    };
    for (const row of await page.locator("#lb-sources .lb-settings-row").all()) {
        expect(await row.evaluate(orderIsLeft)).toBe(true);
        await expect(row.getByRole("button", { name: "Edit", exact: true })).toHaveCount(1);
    }
    await expect(page.locator('[data-source="QQ"]').getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    expect(await down.evaluate((node) => node.getBoundingClientRect().width)).toBe(44);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileActionsBelowText = (row) => {
        const main = row.querySelector(".lb-settings-row-main").getBoundingClientRect();
        const actions = row.querySelector(".lb-settings-row-actions").getBoundingClientRect();
        return actions.top >= main.bottom && actions.left >= row.getBoundingClientRect().left;
    };
    expect(await page.locator('[data-source="Musixmatch"]').evaluate(mobileActionsBelowText)).toBe(true);
    expect(await page.locator('[data-source="Musixmatch"]').evaluate(orderIsLeft)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("admin-source-actions-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    const spotify = page.locator('[data-source="Spotify"]');
    await expect(spotify.locator(".lb-config-badge")).toHaveText("Needs setup");
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    const sourceEditor = spotify.locator("[data-config-transient]");
    await sourceEditor.locator('input[label="Credential"]').fill("synthetic-cancelled");
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
    await page.getByRole("tab", { name: "Services", exact: true }).click();
    const footerHeight = await page.locator(".lb-config-footer").evaluate((node) => node.getBoundingClientRect().height);
    await page.locator('[data-connection-id="audio"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("#lb-services [data-config-transient]")).toHaveCount(0);
    await expect(sourceEditor.locator(".lb-editor-switch")).toBeVisible();
    await expect(page.locator(".lb-config-footer").getByRole("button", { name: /and switch|Keep editing/ })).toHaveCount(0);
    expect(await page.locator(".lb-config-footer").evaluate((node) => node.getBoundingClientRect().height)).toBe(footerHeight);
    await page.screenshot({ path: testInfo.outputPath("admin-switch-editor.png"), fullPage: true });
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Sources", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(sourceEditor.locator('input[label="Credential"]')).toHaveValue("synthetic-cancelled");
    await sourceEditor.getByRole("button", { name: "Cancel", exact: true }).click();
    await spotify.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(sourceEditor.locator('input[label="Credential"]')).toHaveValue("");
    await sourceEditor.locator('input[label="Credential"]').fill("synthetic-credential");
    await sourceEditor.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(spotify.locator(".lb-config-badge")).toHaveText("Configured");
    await spotify.getByRole("checkbox", { name: "Enable Spotify", exact: true }).uncheck();
    await expect(spotify.locator(".lb-config-badge")).toHaveText("Configured");
    const rowAppearance = (row) => {
        const heading = getComputedStyle(row.querySelector(".lb-settings-row-heading"));
        const title = getComputedStyle(row.querySelector(".lb-settings-row-title"));
        const description = getComputedStyle(row.querySelector(".lb-settings-row-description"));
        const actions = getComputedStyle(row.querySelector(".lb-settings-row-actions"));
        return {
            headingGap: heading.gap,
            titleWeight: title.fontWeight,
            descriptionWeight: description.fontWeight,
            descriptionHeight: description.lineHeight,
            actionGap: actions.gap,
        };
    };
    const rowTextAligned = (row) => {
        if (!row.checkVisibility()) return true;
        const description = row.querySelector(".lb-settings-row-description");
        if (description.hidden) return true;
        const name = row.querySelector(".lb-settings-row-title > span");
        const nameRange = document.createRange();
        nameRange.selectNodeContents(name);
        const descriptionRange = document.createRange();
        descriptionRange.selectNodeContents(description);
        return Math.abs(nameRange.getBoundingClientRect().left - descriptionRange.getBoundingClientRect().left) < 1;
    };
    const referenceRow = await page.locator("#lb-sources .lb-settings-row").first().evaluate(rowAppearance);
    const checkRows = async (rows) => {
        for (const row of await rows.all()) {
            expect(await row.evaluate(rowAppearance)).toEqual(referenceRow);
            expect(await row.evaluate(rowTextAligned)).toBe(true);
        }
    };
    await checkRows(page.locator("#lb-sources .lb-settings-row"));
    await page.screenshot({ path: testInfo.outputPath("admin-source-icons.png"), fullPage: true });

    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(page.locator("#lb-storage")).toHaveValue("/synthetic-unsaved");
    await page.getByRole("tab", { name: "Services", exact: true }).click();
    const transcription = page.locator('[data-capability="transcription"]');
    const review = page.locator('[data-capability="boundary-review"]');
    await expect(transcription.locator(":scope > summary .lb-config-badge")).toHaveText("Configured");
    await expect(review.locator(":scope > summary .lb-config-badge")).toHaveText("Built in");
    const nativeActionStyle = (button) => {
        const style = getComputedStyle(button);
        return {
            font: style.font,
            color: style.color,
            background: style.backgroundColor,
            minHeight: style.minHeight,
            borderRadius: style.borderRadius,
        };
    };
    const referenceAction = await page.locator("#lb-web-repair").evaluate(nativeActionStyle);
    const checkServiceActions = async () => {
        for (const button of await page.locator("#lb-services button:enabled").all()) {
            const quiet = await button.evaluate((node) => node.classList.contains("lb-settings-action"));
            if (!quiet) await expect(button).toHaveClass(/raised/);
            await expect(button).toHaveClass(/emby-button/);
            await expect(button.locator(":scope > span")).toHaveCount(1);
            if (!quiet) expect(await button.evaluate(nativeActionStyle)).toEqual(referenceAction);
            else {
                expect(await button.evaluate((node) => getComputedStyle(node).boxShadow)).toBe("none");
                await expect(button).toHaveText("Edit");
                expect(await button.evaluate(rowActionStyle)).toEqual(rowActionReference);
            }
        }
    };
    await checkServiceActions();
    await checkRows(page.locator("#lb-services .lb-settings-row"));
    await page.screenshot({ path: testInfo.outputPath("admin-services.png"), fullPage: true });
    await expect(transcription).toHaveClass(/lb-settings-surface/);
    const surface = await transcription.evaluate((node) => {
        const css = getComputedStyle(node);
        return { padding: css.padding, radius: css.borderRadius, border: css.borderTopWidth, background: css.backgroundColor };
    });
    expect(surface).toMatchObject({ padding: "16px", radius: "8px", border: "1px" });
    expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(await transcription.locator(":scope > summary .lb-settings-row-title").evaluate((node) => getComputedStyle(node).fontWeight)).toBe("600");
    await expect(transcription.locator(":scope > summary")).not.toContainText("Options");
    await transcription.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(transcription).toHaveAttribute("open", "");
    await transcription.locator('[data-option-id="audio-option"] .lb-settings-row-title').click();
    await expect(transcription.locator(".lb-service-editor")).toHaveCount(0);
    await expect(transcription.locator('[data-option-id="audio-option"] .lb-config-badge')).toHaveText("Configured");
    await transcription.getByRole("checkbox", { name: "Enable Groq · Whisper", exact: true }).check();
    await expect(transcription.locator(":scope > summary")).toContainText("1 of 1 options enabled.");
    await transcription.locator('[data-option-id="audio-option"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
    const editor = transcription.locator("[data-config-transient]");
    await expect(editor.getByRole("heading", { name: "Edit Groq · Whisper" })).toBeVisible();
    expect(await editor.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(surface.background);
    await checkServiceActions();
    await checkRows(page.locator("#lb-services .lb-settings-row"));

    await editor.locator('input[label="Model ID"]').fill("fixture-model");
    await editor.getByText("Advanced audio settings", { exact: true }).click();
    await expect(editor.locator('select[label="Upload format"]')).toHaveValue("flac");
    await editor.locator('input[label="Endpoint upload limit (MB)"]').fill("30");
    await editor.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(transcription.locator(":scope > summary .lb-config-badge")).toHaveText("Configured");
    await page.locator('[data-connection-id="audio"]').getByRole("button", { name: "Edit", exact: true }).click();
    const connection = page.locator("#lb-services .lb-connections > [data-config-transient]");
    await checkServiceActions();
    await connection.locator('input[label="Connection name"]').fill("Shared account");
    await connection.locator('input[label="API base URL"]').fill("https://audio.example/v1");
    await connection.getByRole("button", { name: "Delete connection", exact: true }).click();
    await expect(connection).toContainText("Cannot delete this connection");
    await expect(connection).toContainText("Groq · Whisper");
    await expect(page.locator('[data-connection-id="audio"]')).toHaveCount(1);
    await connection.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(transcription.locator('[data-option-id="audio-option"]')).toContainText("Shared account");
    await review.locator(":scope > summary").click();
    const reviewEnabled = review.getByRole("checkbox", { name: "Enable Groq · Review", exact: true });
    await expect(reviewEnabled).toBeDisabled();
    await expect(reviewEnabled).not.toBeChecked();
    await expect(reviewEnabled).toHaveAttribute("aria-description", "Model ID required");
    expect(await reviewEnabled.evaluate((node) => getComputedStyle(node.closest("label")).opacity)).toBe("0.5");
    expect(await reviewEnabled.evaluate((node) => getComputedStyle(node.closest("label"), "::after").content)).not.toBe('"Setup required"');
    await expect(review.locator(":scope > summary")).toContainText("0 of 1 options enabled.");
    await expect(review.locator(":scope > summary")).not.toContainText("enabled and configured");
    await expect(review.locator('[data-option-id="review-option"]')).toContainText("Shared account");
    await review.locator('[data-option-id="review-option"]').getByRole("button", { name: "Edit", exact: true }).click();
    await review.locator('input[label="Model ID"]').fill("review-model");
    await transcription.locator('[data-option-id="audio-option"]').getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Discard and switch", exact: true }).click();
    await expect(transcription.locator('[data-config-transient] input[label="Model ID"]')).toHaveValue("fixture-model");
    await transcription.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review.locator('[data-option-id="review-option"]')).not.toContainText("review-model");
    await review.locator('[data-option-id="review-option"]').getByRole("button", { name: "Edit", exact: true }).click();
    await review.locator('input[label="Model ID"]').fill("review-model");
    await review.locator("summary").filter({ hasText: "Advanced generation settings" }).click();
    await expect(review.locator('input[label="Model context window (tokens)"]')).toHaveValue("64000");
    await expect(review).toContainText("Model limits detected in this draft");
    await page.evaluate(() => {
        window.failModelLookup = true;
    });
    await review.locator('input[label="Model ID"]').fill("unavailable-model");
    await expect(review.locator('input[label="Model context window (tokens)"]')).toHaveValue("32768");
    await expect(review).toContainText("Using the 32,768-token fallback");
    await review.getByRole("checkbox", { name: "Detect model limits automatically", exact: true }).uncheck();
    await review.locator('input[label="Model context window (tokens)"]').fill("48000");
    await review.locator('input[label="Model ID"]').fill("review-model");
    await expect(review.locator('input[label="Model context window (tokens)"]')).toHaveValue("48000");
    await page.evaluate(() => {
        window.failModelLookup = false;
    });
    await review.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(reviewEnabled).toBeEnabled();
    await expect(review.locator('[data-option-id="review-option"] .lb-config-badge')).toHaveText("Configured");
    await reviewEnabled.check();
    await expect(review.locator(":scope > summary")).toContainText("1 of 1 options enabled.");
    await transcription.getByRole("button", { name: "Add option", exact: true }).click();
    const newOption = transcription.locator("[data-config-transient]");
    await newOption.locator('input[label="Option name"]').fill("Second transcription");
    await newOption.locator('input[label="Model ID"]').fill("second-model");
    await newOption.getByText("Advanced audio settings", { exact: true }).click();
    await expect(newOption.locator('select[label="Upload format"]')).toHaveValue("opus");
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await page.getByRole("tab", { name: "Services", exact: true }).click();
    await expect(newOption.locator('input[label="Option name"]')).toHaveValue("Second transcription");
    await page.locator('[data-connection-id="audio"]').getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apply and switch", exact: true })).toBeVisible();
    await expect(newOption.locator(".lb-editor-switch")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator(".lb-config-footer .lb-material-actions button")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("admin-switch-editor-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await newOption.locator('input[label="Option name"]').fill("");
    await page.getByRole("button", { name: "Apply and switch", exact: true }).click();
    await expect(newOption).toContainText("Enter a unique option name");
    await expect(page.locator(".lb-connections [data-config-transient]")).toHaveCount(0);
    await newOption.locator('input[label="Option name"]').fill("Second transcription");
    await page.getByRole("button", { name: "Apply and switch", exact: true }).click();
    await expect(page.locator('.lb-connections [data-config-transient] input[label="Connection name"]')).toHaveValue("Shared account");
    await page.locator(".lb-connections [data-config-transient]").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(transcription.locator("[data-option-id]")).toHaveCount(2);
    await page.getByRole("button", { name: "Add connection", exact: true }).click();
    const extraConnection = page.locator("#lb-services .lb-connections > [data-config-transient]");
    await extraConnection.locator('input[label="Connection name"]').fill("Office endpoint");
    await extraConnection.locator('input[label="API base URL"]').fill("https://office.example/v1");
    await extraConnection.getByRole("button", { name: "Apply", exact: true }).click();
    const office = page.locator("[data-connection-id]").filter({ hasText: "Office endpoint" });
    await office.getByRole("button", { name: "Edit", exact: true }).click();
    await page
        .locator("#lb-services .lb-connections > [data-config-transient]")
        .getByRole("button", { name: "Delete connection", exact: true })
        .click();
    await expect(office).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const row of await page.locator("#lb-services .lb-settings-row:visible").all()) {
        expect(await row.evaluate(mobileActionsBelowText)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("admin-services-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('[data-capability="pronunciation"] > summary').click();
    await expect(page.getByRole("checkbox", { name: "Automatically generate missing pronunciation", exact: true })).toBeChecked();
    await expect(page.locator("#lb-local-pronunciation")).toContainText("Remote services require a manual request");
    await page.locator("#lb-auto-pronunciation").uncheck();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.saved.length)).toBe(1);
    expect(await page.evaluate(() => window.saved[0].AutoGeneratePronunciation)).toBe(false);
    expect(await page.evaluate(() => window.saved[0].ServiceSetup.Connections[0])).toMatchObject({
        Name: "Shared account",
        Endpoint: "https://audio.example/v1",
    });
    expect(await page.evaluate(() => window.saved[0].ServiceSetup.Options.find((o) => o.Id === "audio-option"))).toMatchObject({
        Enabled: true,
        Model: "fixture-model",
        MaxUploadMb: 30,
    });
    await expect(page.locator("#lb-web-status")).toContainText("Renderer disabled");
    await expect(page.locator("#lb-storage-warning")).toBeVisible();
    await expect(page.locator("#lb-effective-storage")).toContainText("/actual/fixture/storage");
    await page.getByRole("tab", { name: "Requests", exact: true }).click();
    // Opening Requests loads history without pressing Refresh.
    await expect(page.locator("#lb-queue")).toContainText("Output deleted");
    await checkRows(page.locator("#lb-queue .lb-settings-row").filter({ hasText: "Output deleted" }));
    await expect(page.locator("#lb-queue").getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    for (const row of await page.locator("#lb-queue .lb-settings-row").all()) {
        await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    }
    const approve = page.locator("#lb-queue").getByRole("button", { name: "Approve", exact: true });
    expect(await approve.evaluate(rowActionStyle)).toEqual(rowActionReference);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await approve.locator("xpath=ancestor::div[contains(@class,'lb-settings-row')][1]").evaluate(mobileActionsBelowText)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Older requests", exact: true }).click();
    await expect(page.locator("#lb-queue")).toContainText("No more requests");
    await expect(page.getByRole("button", { name: "Clear finished history", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Newer requests", exact: true }).click();
    expect(await page.evaluate(() => window.calls)).toContain("/base/LyricBridge/jobs?offset=50&limit=50");
    await page.getByRole("button", { name: "Clear finished history", exact: true }).click();
    await expect(page.locator("#lb-queue")).toContainText("These requests will no longer be retryable");
    await page.locator("#lb-queue").getByRole("alert").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.removedHistory)).toBeUndefined();
    await page.getByRole("button", { name: "Clear finished history", exact: true }).click();
    await page.locator("#lb-queue").getByRole("alert").getByRole("button", { name: "Remove from history", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.removedHistory)).toEqual(["0", "2"]);
    await expect(page.locator("#lb-queue")).toContainText("Finished requests are kept for 30 days");
    await page.evaluate(() => {
        window.emptyHistory = true;
    });
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await page.getByRole("tab", { name: "Requests", exact: true }).click();
    await expect(page.locator("#lb-queue")).toHaveText("No requests yet");
    await expect(page.getByRole("button", { name: "Clear finished history", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveClass(/button-flat/);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("requests-empty-mobile.png"), fullPage: true });
    expect(errors).toEqual([]);
});
