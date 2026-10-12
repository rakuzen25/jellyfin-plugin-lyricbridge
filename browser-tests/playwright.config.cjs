const { defineConfig } = require("playwright/test");
const { readdirSync } = require("node:fs");
const groups = require("./groups.json");
const entries = Object.values(groups).flat();
const actual = readdirSync(__dirname).filter((file) => file.endsWith(".spec.cjs"));
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
    outputDir: outputRoot + "/tests",
    reporter: [
        ["list"],
        ["html", { outputFolder: outputRoot + "/report", open: "never" }],
        ["json", { outputFile: outputRoot + "/report/results.json" }],
    ],
    use: { headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
    projects,
});
