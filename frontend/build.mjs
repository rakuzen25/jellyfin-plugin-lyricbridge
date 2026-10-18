import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile, mkdir, rm, rename, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const bundleEntries = { "bridge.ts": "lyricbridge.js", "renderer.ts": "jellyfin-lyric-motion.js" };
export const rendererAssets = ["lyricbridge.css", "jellyfin-lyric-motion.css", "lyricbridge.js", "jellyfin-lyric-motion.js"];

/** Compile a complete generation before publishing any files. Also used by local dev. */
export async function compileWeb(sourceRoot = root) {
    const root = sourceRoot;
    const props = await readFile(path.join(root, "Directory.Build.props"), "utf8");
    const version = props.match(/<LyricBridgeVersion>([^<]+)<\/LyricBridgeVersion>/)?.[1];
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid authoritative plugin version");
    const options = {
        absWorkingDir: path.join(root, "frontend"),
        bundle: true,
        define: { __LYRICBRIDGE_VERSION__: JSON.stringify(version) },
        format: "iife",
        target: ["es2022"],
        legalComments: "inline",
        write: false,
        logLevel: "silent",
    };
    const files = new Map();
    for (const entry of await readdir(path.join(root, "frontend/assets"), { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) {
            const absolute = path.join(entry.parentPath, entry.name);
            files.set(path.relative(path.join(root, "frontend/assets"), absolute), await readFile(absolute));
        }
    }
    files.set("NOTICE.txt", await readFile(path.join(root, "NOTICE")));
    files.set("LUCIDE-LICENSE.txt", await readFile(path.join(root, "vendor/LUCIDE-LICENSE")));
    for (const [entry, output] of Object.entries(bundleEntries)) {
        const result = await build({
            ...options,
            entryPoints: [entry],
            banner: {
                js:
                    entry === "renderer.ts"
                        ? "/* Generated from frontend/renderer.ts and typed modules.\n * This Source Code Form is subject to the Mozilla Public License, v. 2.0.\n * See https://mozilla.org/MPL/2.0/ and the distributed editable source. */"
                        : "/* Generated from frontend/bridge.ts and typed modules. Run pnpm build frontend from the repository root. */",
            },
        });
        files.set(output, result.outputFiles[0].contents);
    }
    const config = await build({ ...options, entryPoints: ["admin/config.ts"] });
    const script = config.outputFiles[0].text;
    if (script.includes("${")) throw new Error("Inline administrator script contains Jellyfin localization tokens; use string concatenation.");
    const template = await readFile(path.join(root, "frontend/admin/config.html"), "utf8");
    if (!template.includes("<!-- LYRICBRIDGE_CONFIG_SCRIPT -->")) throw new Error("Missing administrator script marker");
    files.set(
        "config.html",
        Buffer.from(
            template.replace("<!-- LYRICBRIDGE_CONFIG_SCRIPT -->", "<script>\n" + script.replaceAll("</script", "<\\/script") + "\n</script>"),
        ),
    );
    return files;
}

export async function writeGeneration(files, directory) {
    await mkdir(directory, { recursive: true });
    for (const [name, contents] of files) {
        const target = path.join(directory, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
    }
}

export async function buildWeb(output = path.join(root, "dist/web"), sourceRoot = root) {
    const files = await compileWeb(sourceRoot);
    await mkdir(path.dirname(output), { recursive: true });
    const staged = await mkdtemp(output + "-");
    try {
        await writeGeneration(files, staged);
        await rm(output, { recursive: true, force: true });
        await rename(staged, output);
    } finally {
        await rm(staged, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    execFileSync(process.execPath, ["frontend/check-boundaries.mjs"], { cwd: root, stdio: "inherit" });
    execFileSync(process.env.LYRICBRIDGE_PNPM || "pnpm", ["--dir", "frontend", "exec", "tsc", "--noEmit"], { cwd: root, stdio: "inherit" });
    await buildWeb();
}
