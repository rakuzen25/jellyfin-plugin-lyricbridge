import { fileURLToPath } from "node:url";
import path from "node:path";
import { createBuilder } from "../.build/toolkit/current/node/build.mjs";
const builder = await createBuilder(fileURLToPath(new URL("../", import.meta.url)));
export const { root, bundleEntries, rendererAssets, compileWeb, writeGeneration, buildWeb } = builder;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await builder.main();
