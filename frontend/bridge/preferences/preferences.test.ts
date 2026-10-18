import assert from "node:assert/strict";
import { test } from "node:test";
import { PreferenceQueue } from "./preferences.ts";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
function request(account = "a", song = "one") {
    return new Request(`https://fixture.invalid/jellyfin/Audio/${song}/Lyrics`, { headers: { "X-Emby-Token": account } });
}

test("coalesces queued edits and serializes writes during track changes", async () => {
    let current = request();
    const first = deferred<Response>();
    const bodies: string[] = [];
    const paths: string[] = [];
    const second = deferred<Response>();
    const queue = new PreferenceQueue({
        request: () => current,
        debounceMs: 60000,
        fetch: async (url, init) => {
            paths.push(String(url));
            bodies.push(String(init?.body));
            return bodies.length === 1 ? first.promise : second.promise;
        },
        saved: () => {},
        failed: () => assert.fail("unexpected failure"),
    });
    queue.enqueue("preferences", { size: 30 });
    const entry = queue.enqueue("preferences", { size: 40 });
    const sending = queue.flush(entry);
    queue.enqueue("preferences", { size: 50 });
    current = request("a", "two");
    queue.discardOtherAccounts();
    assert.equal(bodies.length, 1);
    first.resolve(new Response());
    await sending;
    assert.equal(bodies.length, 2);
    assert.deepEqual(
        bodies.map((s) => JSON.parse(s).size),
        [40, 50],
    );
    assert.ok(paths.every((p) => p === "https://fixture.invalid/jellyfin/LyricBridge/preferences"));
    second.resolve(new Response());
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(queue.pendingCount, 0);
});

test("keeps failed song writes for retry without redirecting to the current song", async () => {
    let current = request();
    let calls = 0;
    let saved = 0;
    let retry: (() => Promise<void>) | undefined;
    const paths: string[] = [];
    const queue = new PreferenceQueue({
        request: () => current,
        debounceMs: 60000,
        fetch: async (url) => {
            paths.push(String(url));
            return new Response(null, { status: ++calls === 1 ? 503 : 204 });
        },
        saved: () => {
            saved++;
        },
        failed: (error, action) => {
            assert.equal(error.details.retryable, true);
            retry = action;
        },
    });
    const entry = queue.enqueue("items/one/language-preferences", { sourceLanguage: "ja" });
    await queue.flush(entry);
    assert.equal(queue.pendingCount, 1);
    current = request("a", "two");
    await retry!();
    assert.equal(queue.pendingCount, 0);
    assert.equal(paths[0], paths[1]);
    assert.match(paths[1]!, /items\/one\/language-preferences$/);
    assert.equal(saved, 1);
});

test("discards unsent work when the authenticated account changes", async () => {
    let current = request();
    let calls = 0;
    const queue = new PreferenceQueue({
        request: () => current,
        debounceMs: 60000,
        fetch: async () => {
            calls++;
            return new Response();
        },
        saved: () => {},
        failed: () => {},
    });
    const entry = queue.enqueue("preferences", { size: 40 });
    current = request("b");
    queue.discardOtherAccounts();
    await queue.flush(entry);
    assert.equal(calls, 0);
    assert.equal(queue.pendingCount, 0);
});

test("a failed UI refresh does not retry an accepted write", async () => {
    const current = request();
    let writes = 0;
    let failures = 0;
    const queue = new PreferenceQueue({
        request: () => current,
        debounceMs: 60000,
        fetch: async () => {
            writes++;
            return new Response();
        },
        saved: () => {
            throw new Error("refresh");
        },
        failed: () => {
            failures++;
        },
    });
    await queue.flush(queue.enqueue("preferences", { size: 40 }));
    assert.equal(writes, 1);
    assert.equal(failures, 0);
    assert.equal(queue.pendingCount, 0);
});

test("completion from a discarded account session cannot delete a new save after signing back in", async () => {
    let current = request();
    const first = deferred<Response>();
    let calls = 0;
    const queue = new PreferenceQueue({
        request: () => current,
        debounceMs: 60000,
        fetch: async () => (++calls === 1 ? first.promise : new Response()),
        saved: () => {},
        failed: () => assert.fail("unexpected failure"),
    });
    const old = queue.enqueue("preferences", { size: 30 });
    const sending = queue.flush(old);
    current = request("b");
    queue.discardOtherAccounts();
    current = request("a");
    queue.discardOtherAccounts();
    const newer = queue.enqueue("preferences", { size: 50 });
    first.resolve(new Response());
    await sending;
    assert.equal(queue.pending("preferences"), newer);
    await queue.flush(newer);
    assert.equal(calls, 2);
    assert.equal(queue.pendingCount, 0);
});
