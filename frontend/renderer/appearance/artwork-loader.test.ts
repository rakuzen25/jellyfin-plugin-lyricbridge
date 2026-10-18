import assert from "node:assert/strict";
import { test } from "node:test";
import { ArtworkLoader } from "./artwork-loader.ts";
class ImageFixture extends EventTarget {
    src = "";
    decoding = "";
    complete = false;
    naturalWidth = 0;
}
test("track changes settle pending loads and late load events cannot revive old artwork", async () => {
    const images: ImageFixture[] = [];
    const loader = new ArtworkLoader(
        () => {
            const image = new ImageFixture();
            images.push(image);
            return image;
        },
        () => assert.fail("unexpected timeout"),
    );
    const old = loader.load("old", 1000);
    const rejected = assert.rejects(old, { name: "AbortError" });
    loader.invalidate();
    await rejected;
    assert.equal(loader.pendingCount, 0);
    assert.equal(images[0]!.src, "");
    const fresh = loader.load("new", 1000);
    images[0]!.dispatchEvent(new Event("load"));
    assert.equal(loader.pendingCount, 1);
    images[1]!.dispatchEvent(new Event("load"));
    assert.equal(await fresh, images[1]);
    assert.equal(loader.pendingCount, 0);
    loader.dispose();
});
test("disposal rejects work instead of leaving a promise pending after clearing its timer", async () => {
    const loader = new ArtworkLoader(
        () => new ImageFixture(),
        () => assert.fail("unexpected timeout"),
    );
    const pending = loader.load("pending", 1000);
    const rejected = assert.rejects(pending, { name: "AbortError" });
    loader.dispose();
    loader.dispose();
    await rejected;
    assert.equal(loader.pendingCount, 0);
    await assert.rejects(loader.load("late", 1000), { name: "AbortError" });
});
test("load failures and timeouts release all owned resources and permit fallback", async () => {
    let timedOut = 0;
    const image = new ImageFixture();
    const loader = new ArtworkLoader(
        () => image,
        () => {
            timedOut++;
        },
    );
    const failed = loader.load("bad", 1000);
    image.dispatchEvent(new Event("error"));
    await assert.rejects(failed, /load failed/);
    assert.equal(loader.pendingCount, 0);
    await assert.rejects(loader.load("timeout", 1), /timed out/);
    assert.equal(timedOut, 1);
    assert.equal(loader.pendingCount, 0);
    loader.dispose();
});
