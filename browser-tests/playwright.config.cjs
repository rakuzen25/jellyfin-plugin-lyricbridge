const { defineConfig } = require("playwright/test");
module.exports = defineConfig({
    testDir: ".",
    testMatch: "*.spec.cjs",
    outputDir: "results",
    use: { headless: true },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
        { name: "mobile-chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
        { name: "firefox", use: { browserName: "firefox" } },
        { name: "webkit", use: { browserName: "webkit" } },
    ],
});
