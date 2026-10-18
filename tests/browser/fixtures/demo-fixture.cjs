const fs = require("node:fs");
const path = require("node:path");
function silence() {
    const data = Buffer.alloc(44 + 8000 * 2 * 40);
    data.write("RIFF");
    data.writeUInt32LE(data.length - 8, 4);
    data.write("WAVEfmt ", 8);
    data.writeUInt32LE(16, 16);
    data.writeUInt16LE(1, 20);
    data.writeUInt16LE(1, 22);
    data.writeUInt32LE(8000, 24);
    data.writeUInt32LE(16000, 28);
    data.writeUInt16LE(2, 32);
    data.writeUInt16LE(16, 34);
    data.write("data", 36);
    data.writeUInt32LE(data.length - 44, 40);
    return data;
}
async function demo(page, options = {}) {
    const root = options.root || path.resolve(__dirname, "../../../dist/web");
    await page.route("**/*", (route) => {
        const name = new URL(route.request().url()).pathname.split("/").at(-1);
        if ((name === "demo.html" || (name === "index.html" && options.url)) && options.transformHtml)
            return route.fulfill({ contentType: "text/html", body: options.transformHtml(fs.readFileSync(path.join(root, "demo.html"), "utf8")) });
        if (name === "demo.wav") {
            const body = silence(),
                range = route
                    .request()
                    .headers()
                    .range?.match(/^bytes=(\d+)-(\d*)$/);
            if (range) {
                const start = Number(range[1]),
                    end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
                return route.fulfill({
                    status: 206,
                    contentType: "audio/wav",
                    headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` },
                    body: body.subarray(start, end + 1),
                });
            }
            return route.fulfill({ contentType: "audio/wav", headers: { "Accept-Ranges": "bytes" }, body });
        }
        if (["demo.html", "lyricbridge.js", "lyricbridge.css", "jellyfin-lyric-motion.js", "jellyfin-lyric-motion.css"].includes(name))
            return route.fulfill({ path: path.join(root, name) });
        return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(options.url || "http://fixture.invalid/base/web/lyricbridge/demo.html");
}
module.exports = { demo };
