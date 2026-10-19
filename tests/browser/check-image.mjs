import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrowserImage, verifyBrowserImage } from "../../.build/toolkit/current/node/check-browser-image.mjs";
export { verifyBrowserImage };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    checkBrowserImage(fileURLToPath(new URL("../../", import.meta.url)), process.argv.includes("--inside"));
