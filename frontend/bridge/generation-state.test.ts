import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerationMonitor, parseGenerationJob } from "./generation-state.ts";
import type { GenerationJob } from "./generation-state.ts";
function deferred<T>() {
    let resolve!: (value: T) => void;
    return {
        promise: new Promise<T>((yes) => {
            resolve = yes;
        }),
        resolve: (value: T) => resolve(value),
    };
}
const job = (state: string): GenerationJob => ({ id: "job", state, progress: 0, request: { service: "fixture", kind: "translation" } });
test("a late running result cannot update a different track or restart polling", async () => {
    const track = new AbortController(),
        response = deferred<GenerationJob>();
    const published: string[] = [];
    const monitor = new GenerationMonitor({
        signal: track.signal,
        read: () => response.promise,
        changed: (value) => {
            published.push(value.state);
        },
        failed: () => assert.fail("stale failure published"),
    });
    const pending = monitor.poll();
    track.abort();
    response.resolve(job("running"));
    await pending;
    assert.deepEqual(published, []);
    await monitor.poll();
});
test("a newer poll wins over an older delayed result", async () => {
    const response = deferred<GenerationJob>(),
        published: string[] = [];
    let calls = 0;
    const monitor = new GenerationMonitor({
        signal: new AbortController().signal,
        read: () => (++calls === 1 ? response.promise : Promise.resolve(job("complete"))),
        changed: (value) => {
            published.push(value.state);
        },
        failed: () => assert.fail("unexpected failure"),
    });
    const old = monitor.poll();
    await monitor.poll();
    response.resolve(job("running"));
    await old;
    assert.deepEqual(published, ["complete"]);
    monitor.dispose();
});
test("settings changes and provider failures remain terminal until explicit retry", async () => {
    for (const state of ["settings_changed", "failed", "cancelled", "rejected", "complete"]) {
        const published: string[] = [];
        let calls = 0;
        const monitor = new GenerationMonitor({
            signal: new AbortController().signal,
            read: async () => {
                calls++;
                return job(state);
            },
            changed: (value) => {
                published.push(value.state);
            },
            failed: () => assert.fail("unexpected failure"),
            pollMs: 0,
        });
        await monitor.poll();
        assert.equal(calls, 1);
        assert.deepEqual(published, [state]);
        monitor.dispose();
    }
});
test("malformed generation output produces a controlled error", () => {
    assert.throws(() => parseGenerationJob({ ...job("running"), progress: "90" }), /invalid generation status/);
    assert.throws(() => parseGenerationJob({ ...job("failed"), failure: { message: { nested: true } } }), /invalid generation error/);
    assert.deepEqual(parseGenerationJob({ ...job("pending"), failure: null }), {
        ...job("pending"),
        request: { ...job("pending").request, language: undefined },
        error: undefined,
        failure: null,
    });
});
