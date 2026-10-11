const { test, expect } = require("playwright/test");
const path = require("node:path");

test("typed configuration preserves unsaved edits and paginates history", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
        new URL(route.request().url()).pathname === "/config.html"
            ? route.fulfill({ path: path.resolve(__dirname, "../dist/web/config.html") })
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
            },
            ajax: async (options) => {
                window.calls.push(options.url);
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
                              state: "complete",
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
    await expect(page.locator("#lb-storage-warning")).toBeVisible();
    await expect(page.locator("#lb-effective-storage")).toContainText("/actual/fixture/storage");
    await page.getByRole("tab", { name: "Requests", exact: true }).click();
    await page.locator("#lb-refresh").click();
    await page.getByRole("button", { name: "Older requests", exact: true }).click();
    await expect(page.locator("#lb-queue")).toContainText("No requests");
    expect(await page.evaluate(() => window.calls)).toContain("/base/LyricBridge/jobs?offset=50&limit=50");
    expect(errors).toEqual([]);
});
