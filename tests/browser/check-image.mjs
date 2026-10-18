import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export function verifyBrowserImage(declared, installed, image) {
    const version = image.match(/^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[a-f0-9]{64}$/)?.[1];
    if (!version || version !== declared || version !== installed)
        throw new Error("Playwright manifest, installed package and digest-pinned noble image must have identical versions.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const manifestPath = path.join(root, "tests/browser/package.json");
    const require = createRequire(manifestPath);
    const declared = JSON.parse(readFileSync(manifestPath, "utf8")).dependencies.playwright;
    const installed = require("playwright/package.json").version;
    const image = JSON.parse(readFileSync(path.join(root, "scripts/common/images.json"), "utf8")).playwright;
    verifyBrowserImage(declared, installed, image);
    if (process.argv.includes("--inside")) {
        const browsers = require("playwright");
        for (const name of ["chromium", "firefox", "webkit"]) {
            if (!existsSync(browsers[name].executablePath())) throw new Error(`Pinned image is missing ${name}'s required executable.`);
        }
    }
    console.log(`Verified Playwright ${declared}${process.argv.includes("--inside") ? " browser executables" : " image identity"}.`);
}
