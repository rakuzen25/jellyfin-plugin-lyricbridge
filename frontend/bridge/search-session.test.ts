import { test } from "node:test";
import assert from "node:assert/strict";
import { SearchSession } from "./search-session.ts";
import type { SearchState } from "./search-session.ts";
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
interface Result {
    state: string;
    marker: string;
}
test("late admission is released without polling or publishing into a replacement search", async () => {
    const first = deferred<{ id: string }>();
    const released: string[] = [],
        read: string[] = [],
        states: SearchState<Result>[] = [];
    const session = new SearchSession<string, Result>(
        {
            start: async (query) => (query === "first" ? first.promise : { id: "second" }),
            read: async (id) => {
                read.push(id);
                return { state: "complete", marker: id };
            },
            release: async (id) => {
                released.push(id);
            },
        },
        (state) => states.push(state),
    );
    const pending = session.start("first");
    await session.start("second");
    first.resolve({ id: "first" });
    await pending;
    assert.deepEqual(read, ["second"]);
    assert.deepEqual(released, ["first"]);
    assert.deepEqual(
        states.filter((state) => state.kind === "results").map((state) => state.value.marker),
        ["second"],
    );
    session.dispose();
    assert.deepEqual(released, ["first", "second"]);
});
test("poll completion after disposal cannot publish or schedule another poll", async () => {
    const response = deferred<Result>();
    const states: SearchState<Result>[] = [];
    let reads = 0;
    const released: string[] = [];
    const session = new SearchSession<string, Result>(
        {
            start: async () => ({ id: "one" }),
            read: () => {
                reads++;
                return response.promise;
            },
            release: async (id) => {
                released.push(id);
            },
        },
        (state) => states.push(state),
        0,
    );
    const pending = session.start("query");
    await Promise.resolve();
    session.dispose();
    response.resolve({ state: "searching", marker: "stale" });
    await pending;
    assert.equal(reads, 1);
    assert.deepEqual(
        states.map((state) => state.kind),
        ["admitting", "disposed"],
    );
    assert.deepEqual(released, ["one"]);
});
test("admission failures retain their retryable error and permit explicit retry", async () => {
    const failure = { code: "search_limit", retryable: true };
    let attempts = 0;
    const states: SearchState<Result>[] = [];
    const session = new SearchSession<string, Result>(
        {
            start: async () => {
                if (++attempts === 1) throw failure;
                return { id: "retry" };
            },
            read: async () => ({ state: "complete", marker: "success" }),
            release: async () => {},
        },
        (state) => states.push(state),
    );
    await session.start("query");
    assert.deepEqual(states.at(-1), { kind: "failed", error: failure });
    await session.start("query");
    assert.deepEqual(states.at(-1), { kind: "results", value: { state: "complete", marker: "success" } });
    session.dispose();
});
