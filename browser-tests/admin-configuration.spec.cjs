const { test, expect } = require("playwright/test");
const path = require("node:path");
const { readFileSync } = require("node:fs");

test("@workflow typed configuration preserves unsaved edits and paginates history", async ({ page }) => {
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
                if (options.url.includes("jobs?"))
                    return options.url.includes("offset=0&")
                        ? Array.from({ length: 50 }, (_, i) => ({
                              id: String(i),
                              state: i === 0 ? "failed" : "complete",
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
    await expect(page.locator("#lb-web-status")).not.toContainText("rendererRuntime.");
    const sectionSpacing = await page.evaluate(() => {
        const renderer = document.querySelector("#lb-renderer-settings");
        const storage = renderer.nextElementSibling;
        return storage.getBoundingClientRect().top - renderer.getBoundingClientRect().bottom;
    });
    expect(Math.round(sectionSpacing)).toBeGreaterThanOrEqual(24);
    expect(await page.locator("#lb-web-status").evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("pre-line");
    await page.locator("#lb-web-repair").click();
    await expect.poll(() => page.evaluate(() => window.calls.includes("/base/LyricBridge/admin/web-renderer/repair"))).toBe(true);
    await page.locator("#lb-web-enabled").uncheck();
    await page.locator("#lb-storage").fill("/synthetic-unsaved");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.locator("#lb-config-status")).toContainText("Settings were not saved");
    await page.getByRole("tab", { name: "Sources", exact: true }).click();
    await expect(page.locator("[data-source=Spotify] input[type=checkbox]")).toBeDisabled();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(page.locator("#lb-storage")).toHaveValue("/synthetic-unsaved");
    await page.evaluate(() => (window.failSave = false));
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.saved.length)).toBe(1);
    await expect(page.locator("#lb-web-status")).toContainText("Renderer disabled");
    await expect(page.locator("#lb-storage-warning")).toBeVisible();
    await expect(page.locator("#lb-effective-storage")).toContainText("/actual/fixture/storage");
    await page.getByRole("tab", { name: "Requests", exact: true }).click();
    await page.locator("#lb-refresh").click();
    await expect(page.locator("#lb-queue")).toContainText("Output deleted");
    await expect(page.locator("#lb-queue").getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Older requests", exact: true }).click();
    await expect(page.locator("#lb-queue")).toContainText("No requests");
    expect(await page.evaluate(() => window.calls)).toContain("/base/LyricBridge/jobs?offset=50&limit=50");
    expect(errors).toEqual([]);
});
