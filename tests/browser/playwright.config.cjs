const { defineConfig } = require("playwright/test");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const groups = require("./groups.json");
const entries = Object.values(groups).flat();
const actual = readdirSync(__dirname, { recursive: true }).filter(
    (file) => file.endsWith(".spec.cjs") && !file.startsWith("node_modules/") && !file.startsWith("results"),
);
if (new Set(entries).size !== entries.length || actual.some((file) => !entries.includes(file)) || entries.some((file) => !actual.includes(file)))
    throw new Error("Every browser spec must belong to exactly one execution group");
const group = process.env.CI_BROWSER_GROUP || "all";
if (!["all", ...Object.keys(groups)].includes(group)) throw new Error("Unknown browser execution group");
const layoutWorkflows = groups.workflow;
const engines = [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "mobile-chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
];
if (group === "all" || group === "rendering") {
    for (const engine of engines) {
        for (const snapshot of ["multilingual-playback", "display-settings"]) {
            const file = join(__dirname, "baselines", `${snapshot}-${engine.name}-linux.png`);
            if (!existsSync(file))
                throw new Error(`Missing reviewed visual baseline: ${file}. Restore the committed baseline; do not regenerate it in CI.`);
        }
    }
}
const projects = [];
if (group === "all" || group === "workflow")
    projects.push({ ...engines[0], name: "workflow-chromium", testMatch: groups.workflow, grepInvert: /@layout/ });
if (group === "all" || group === "rendering")
    projects.push(...engines.map((engine) => ({ ...engine, testMatch: [...groups.rendering, ...layoutWorkflows], grepInvert: /@workflow/ })));
if (group === "all" || group === "performance")
    projects.push(
        ...engines
            .slice(0, 2)
            .map((engine) => ({ ...engine, name: "stress-" + engine.name, use: { ...engine.use, trace: "off" }, testMatch: groups.performance })),
    );
const outputRoot = process.env.CI_BROWSER_OUTPUT_DIR || "results";
module.exports = defineConfig({
    testDir: ".",
    snapshotPathTemplate: "{testDir}/baselines/{arg}-{projectName}-{platform}{ext}",
    outputDir: outputRoot + "/tests",
    reporter: [
        ["list"],
        ["html", { outputFolder: outputRoot + "/report", open: "never" }],
        ["json", { outputFile: outputRoot + "/report/results.json" }],
    ],
    use: { headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
    projects,
});
