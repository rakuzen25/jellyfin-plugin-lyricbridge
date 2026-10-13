import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { build } from "esbuild";
const props = await readFile("../Directory.Build.props", "utf8");
const version = props.match(/<LyricBridgeVersion>([^<]+)<\/LyricBridgeVersion>/)?.[1];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid authoritative plugin version");
const define = { __LYRICBRIDGE_VERSION__: JSON.stringify(version) };
await rm("../dist/web", { recursive: true, force: true });
await mkdir("../dist/web", { recursive: true });
await cp("assets", "../dist/web", { recursive: true });
await cp("../NOTICE", "../dist/web/NOTICE.txt");
await cp("../vendor/LUCIDE-LICENSE", "../dist/web/LUCIDE-LICENSE.txt");
await build({
    entryPoints: ["bridge.ts"],
    outfile: "../dist/web/lyricbridge.js",
    bundle: true,
    define,
    format: "iife",
    target: ["es2022"],
    legalComments: "inline",
    banner: {
        js: "/* Generated from frontend/bridge.ts and typed modules. Run pnpm build from the repository root. */",
    },
});

await build({
    entryPoints: ["renderer.ts"],
    outfile: "../dist/web/jellyfin-lyric-motion.js",
    bundle: true,
    define,
    format: "iife",
    target: ["es2022"],
    legalComments: "inline",
    banner: {
        js: `/* Generated from frontend/renderer.ts and typed modules.
 * This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/ and the distributed editable source. */`,
    },
});

const config = await build({
    entryPoints: ["admin/config.ts"],
    bundle: true,
    define,
    write: false,
    format: "iife",
    target: ["es2022"],
    legalComments: "inline",
});
// Jellyfin localizes ${...} across the entire page, including inline JavaScript.
if (config.outputFiles[0].text.includes("${"))
    throw new Error("Inline administrator script contains Jellyfin localization tokens; use string concatenation.");
const template = await readFile("admin/config.html", "utf8");
await writeFile(
    "../dist/web/config.html",
    template.replace(
        "<!-- LYRICBRIDGE_CONFIG_SCRIPT -->",
        "<script>\n" + config.outputFiles[0].text.replaceAll("</script", "<\\/script") + "\n</script>",
    ),
);
