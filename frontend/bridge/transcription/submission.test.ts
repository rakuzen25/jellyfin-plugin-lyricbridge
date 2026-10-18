import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioUploadBody } from "../transport/api.ts";
import { TranscriptionSubmission } from "./submission.ts";
function deferred<T>() {
    let resolve!: (value: T) => void;
    return {
        promise: new Promise<T>((yes) => {
            resolve = yes;
        }),
        resolve: (value: T) => resolve(value),
    };
}
function fixture(api: (path: string, method?: string, body?: unknown) => Promise<unknown>) {
    const jobs: string[] = [],
        errors: unknown[] = [],
        messages: string[] = [],
        busy: boolean[] = [];
    let live = true;
    const submission = new TranscriptionSubmission({
        itemId: "captured-track",
        api,
        live: () => live,
        options: [
            {
                id: "audio",
                name: "Audio",
                provider: "AI",
                capability: "transcription",
                model: "model",
                status: "Ready",
                maxInputMb: 1,
                maxUploadMb: 1,
            },
        ],
        changed: () => {},
        busy: (state) => busy.push(state),
        notice: (message) => messages.push(message),
        failed: (cause) => errors.push(cause),
        admitted: (job) => jobs.push(job.id),
    });
    submission.selectOption("audio");
    return {
        submission,
        jobs,
        errors,
        messages,
        busy,
        close: () => {
            live = false;
        },
    };
}
const job = () => ({ id: "admitted", state: "queued", progress: 0, request: { service: "AI", kind: "transcription" } });
test("failed uploads never admit a transcription and release submission locking", async () => {
    const paths: string[] = [];
    const f = fixture(async (path) => {
        paths.push(path);
        throw new Error("Upload failed");
    });
    await f.submission.submit(new File(["audio"], "audio.wav"));
    assert.equal(paths.length, 1);
    assert.match(paths[0]!, /transcription-upload/);
    assert.deepEqual(f.jobs, []);
    assert.equal(f.submission.snapshot.submitting, false);
    assert.deepEqual(f.busy, [true, false]);
});
test("uploads preserve binary input and captured request identity before admission", async () => {
    const file = new File(["binary audio"], "audio.wav");
    const calls: { path: string; body: unknown }[] = [];
    const f = fixture(async (path, _method, body) => {
        calls.push({ path, body });
        if (body instanceof AudioUploadBody) {
            assert.equal(body.file, file);
            body.progress(5, 10);
            return { id: "upload" };
        }
        return job();
    });
    f.submission.setLanguage(" ja ");
    await f.submission.submit(file);
    assert.match(calls[1]!.path, /items\/captured-track\/transcribe$/);
    assert.deepEqual(calls[1]!.body, { source: "upload", uploadId: "upload", language: "ja", optionId: "audio" });
    assert.deepEqual(f.jobs, ["admitted"]);
    assert.equal(f.submission.snapshot.optionId, "");
    assert.ok(f.messages.includes("Uploading audio · 50%"));
});
test("closing during upload rejects late admission and suppresses late progress", async () => {
    const response = deferred<unknown>();
    let body: AudioUploadBody | undefined;
    const paths: string[] = [];
    const f = fixture(async (path, _method, value) => {
        paths.push(path);
        body = value as AudioUploadBody;
        return response.promise;
    });
    const pending = f.submission.submit(new File(["audio"], "audio.wav"));
    f.close();
    const count = f.messages.length;
    body!.progress(1, 1);
    response.resolve({ id: "late" });
    await pending;
    assert.equal(paths.length, 1);
    assert.equal(f.messages.length, count);
    assert.deepEqual(f.jobs, []);
});
test("concurrent submission is serialized and staged audio skips upload", async () => {
    const response = deferred<unknown>();
    const bodies: unknown[] = [];
    const f = fixture(async (_path, _method, body) => {
        bodies.push(body);
        return response.promise;
    });
    const pending = f.submission.submit(undefined, "staged");
    await f.submission.submit();
    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0], { source: "upload", uploadId: "staged", language: "auto", optionId: "audio" });
    response.resolve(job());
    await pending;
    assert.deepEqual(f.jobs, ["admitted"]);
});
test("oversized audio fails locally and keeps the selected service for retry", async () => {
    let calls = 0;
    const f = fixture(async () => {
        calls++;
        return job();
    });
    await f.submission.submit(new File([new Uint8Array(1_000_001)], "large.wav"));
    assert.equal(calls, 0);
    assert.equal(f.submission.snapshot.optionId, "audio");
    assert.equal(f.errors.length, 1);
});
