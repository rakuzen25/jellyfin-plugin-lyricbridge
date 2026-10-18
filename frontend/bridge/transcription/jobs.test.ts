import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationJob } from "../../contracts/generation.ts";
import type { FeedbackOptions } from "../../shared/feedback.ts";
import type { TrackScope } from "../session/contracts.ts";
import { BridgeRequestError } from "../transport/api.ts";
import { createTranscriptionJobs } from "./jobs.ts";
function deferred<T>() {
    let resolve!: (value: T) => void;
    return {
        promise: new Promise<T>((yes) => {
            resolve = yes;
        }),
        resolve: (value: T) => resolve(value),
    };
}
const track = (): TrackScope => ({ id: 1, itemId: "track", controller: new AbortController(), issued: 0, accepted: 0 });
const job = (id = "job", state = "complete"): GenerationJob => ({
    id,
    state,
    taskKind: "transcription",
    progress: 100,
    request: { service: "AI", kind: "transcription" },
});
const settle = async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
};
function fixture(api: (path: string, method?: string, body?: unknown, signal?: AbortSignal | null) => Promise<unknown>) {
    const target = track(),
        notices = new Map<string, FeedbackOptions>(),
        removed: string[] = [],
        completed: string[] = [],
        opened: string[] = [];
    let updates = 0;
    const jobs = createTranscriptionJobs({
        scope: () => target,
        api,
        notifications: () => ({
            set: (id, value) => {
                notices.set(id, value);
                updates++;
            },
            remove: (id) => {
                notices.delete(id);
                removed.push(id);
            },
        }),
        reviewCompleted: (id) => {
            completed.push(id);
        },
        open: (id) => opened.push(id),
    });
    return { jobs, target, notices, removed, completed, opened, updates: () => updates };
}
test("repeated watches share one monitor and track cancellation rejects late status", async () => {
    const response = deferred<unknown>();
    let reads = 0;
    let signal: AbortSignal | null | undefined;
    const f = fixture(async (_path, _method, _body, token) => {
        reads++;
        signal = token;
        return response.promise;
    });
    f.jobs.watch(job("job", "running"), f.target);
    f.jobs.watch(job("job", "running"), f.target);
    assert.equal(reads, 1);
    const updates = f.updates();
    f.target.controller.abort();
    assert.equal(signal!.aborted, true);
    response.resolve(job());
    await settle();
    assert.equal(f.updates(), updates);
    assert.deepEqual(f.completed, []);
});
test("dismissed failures stay dismissed on restoration while newly admitted jobs remain visible", async () => {
    const f = fixture(async (path) => (path.startsWith("jobs?") ? [job("job", "running")] : job(path.split("/")[1], "failed")));
    f.jobs.watch(job("job", "failed"), f.target);
    await settle();
    f.notices
        .get("job:job")!
        .actions!.find((a) => a.label === "Dismiss")!
        .run();
    await f.jobs.restore(f.target);
    assert.equal(f.notices.has("job:job"), false);
    f.jobs.watch(job("new", "failed"), f.target, true);
    await settle();
    assert.equal(f.notices.has("job:new"), true);
    f.target.controller.abort();
});
test("admitted review jobs finish independently of a panel and offer explicit result navigation", async () => {
    const response = deferred<unknown>(),
        f = fixture(async () => response.promise);
    f.jobs.watch({ ...job("review", "running"), taskKind: "boundary-review" }, f.target);
    response.resolve({ ...job("review"), taskKind: "boundary-review", resultId: "source" });
    await settle();
    assert.deepEqual(f.completed, ["source"]);
    f.notices
        .get("job:review")!
        .actions!.find((a) => a.label === "Review result")!
        .run();
    assert.deepEqual(f.opened, ["source"]);
    f.target.controller.abort();
});
test("a superseded retry-plan failure cannot remove a newer monitor", async () => {
    const old = deferred<unknown>();
    const f = fixture(async (path) => {
        if (path.endsWith("/review-plan")) {
            await old.promise;
            throw new BridgeRequestError({ code: "gone", message: "Removed" }, null, 404);
        }
        return job();
    });
    f.jobs.watch({ ...job("job", "failed"), taskKind: "boundary-review" }, f.target);
    f.jobs.watch(job(), f.target, true);
    old.resolve(null);
    await settle();
    assert.deepEqual(f.removed, []);
    assert.equal(f.notices.has("job:job"), true);
    f.target.controller.abort();
});
