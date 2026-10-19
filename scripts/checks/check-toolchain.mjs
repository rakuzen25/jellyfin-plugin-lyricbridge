export { verifyVersions } from "../../.build/toolkit/current/node/check-toolchain.mjs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
if (process.argv[1] === fileURLToPath(import.meta.url))
    execFileSync(process.execPath, [fileURLToPath(new URL("../../.build/toolkit/current/node/check-toolchain.mjs", import.meta.url))], {
        stdio: "inherit",
    });
