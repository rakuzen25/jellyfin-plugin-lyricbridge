import assert from "node:assert/strict";
import { test } from "node:test";
import type { FeedbackOptions } from "../../shared/feedback.ts";
import { TranscriptionReviewController } from "./review-controller.ts";
function deferred<T>() {
    let resolve!: (value: T) => void;
    return {
        promise: new Promise<T>((yes) => {
            resolve = yes;
        }),
        resolve: (value: T) => resolve(value),
    };
}
function document(id = "source", saved = true) {
    const settings = { characters: null as number | null, seconds: 3, keepShortReplies: true };
    const version = { id: "initial", origin: "local", algorithm: "phrase-dp/1", endTokenIds: ["t2"], settings };
    return {
        transcript: {
            id,
            text: "Hello world!",
            language: "en",
            timing: "word",
            warnings: [],
            tokens: [
                { id: "t0", text: "Hello", separator: "", position: 0, endPosition: 5, start: 10, end: 20 },
                { id: "t1", text: "world", separator: " ", position: 6, endPosition: 11, start: 20, end: 30 },
                { id: "t2", text: "!", separator: "", position: 11, endPosition: 12, start: 30, end: 40 },
            ],
        },
        versions: saved ? [version] : [],
        savedEntries: saved
            ? [{ entry: { id: "initial", versionId: "initial", origin: "local", settings }, deletion: { allowed: true, reason: null } }]
            : [],
        deletion: { allowed: true, reason: null },
        canManage: true,
        boundaries: [],
        selection: "baseline",
        canUse: true,
        reviewResults: [],
    };
}
type Request = { path: string; method: string; body: unknown };
function fixture(intercept?: (request: Request) => unknown) {
    const doc = document(),
        requests: Request[] = [],
        errors: unknown[] = [],
        notices: FeedbackOptions[] = [],
        changes: string[] = [];
    let previews = 0,
        admitted = 0,
        used = 0;
    const option = {
        id: "review",
        name: "Fixture",
        provider: "AI",
        capability: "boundary-review",
        status: "Ready",
        model: "model",
        maxInputMb: 25,
        maxUploadMb: 25,
    };
    const controller = new TranscriptionReviewController({
        itemId: "track",
        live: () => true,
        api: async (path, method = "GET", body) => {
            const request = { path, method, body };
            requests.push(request);
            const value = intercept?.(request);
            if (value !== undefined) return await value;
            if (path === "transcription") return { reviewOptions: [option] };
            if (path.endsWith("/review-plan")) return { identity: "plan", requestCount: 1 };
            if (path.endsWith("/review")) return { id: "job", state: "pending", progress: 0, request: { service: "AI", kind: "boundary-review" } };
            if (path.endsWith("/break"))
                return { ...doc.versions[0], id: "automatic", origin: "local", algorithm: "phrase-dp/1", endTokenIds: ["t0", "t2"], settings: body };
            if (path.endsWith("/preview")) return { lines: [] };
            if (path.endsWith("/use")) return null;
            if (path.endsWith("/save")) {
                const input = body as { endTokenIds: string[] };
                const version = { ...doc.versions[0]!, id: "saved", endTokenIds: input.endTokenIds };
                doc.versions.push(version);
                doc.savedEntries.push({ ...doc.savedEntries[0]!, entry: { ...doc.savedEntries[0]!.entry, id: "saved", versionId: "saved" } });
                return { id: "saved", versionId: "saved" };
            }
            return structuredClone(doc);
        },
        changed: (reason) => changes.push(reason),
        failed: (cause) => errors.push(cause),
        notice: (options) => notices.push(options),
        preview: () => {
            previews++;
        },
        admitted: () => {
            admitted++;
        },
        used: async () => {
            used++;
        },
    });
    return { controller, doc, requests, errors, notices, changes, counts: () => ({ previews, admitted, used }) };
}

test("draft commands preserve source tokens and expose immutable snapshots", async () => {
    const f = fixture(),
        c = f.controller;
    await c.load("source");
    const before = c.snapshot;
    assert.equal(Reflect.set(before.settings, "seconds", 99), false);
    assert.equal(Reflect.set(before.review!.transcript.tokens[0]!, "text", "Changed"), false);
    c.split("t0");
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
    assert.equal(c.snapshot.dirty, true);
    c.merge("t0");
    assert.deepEqual(c.snapshot.ends, ["t2"]);
    c.undo();
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
    c.redo();
    assert.deepEqual(c.snapshot.ends, ["t2"]);
    c.updateSettings({ seconds: 4 });
    c.reset();
    assert.equal(c.snapshot.settings.seconds, 3);
    assert.equal(c.snapshot.dirty, false);
    assert.deepEqual(before.ends, ["t2"]);
    assert.deepEqual(c.snapshot.review!.transcript.tokens, before.review!.transcript.tokens);
});

test("Save advances the baseline without selecting playback or discarding undo", async () => {
    const f = fixture(),
        c = f.controller;
    await c.load("source");
    c.split("t0");
    assert.equal(await c.save(), true);
    assert.equal(c.snapshot.dirty, false);
    assert.equal(c.snapshot.canUndo, true);
    assert.deepEqual(f.counts(), { previews: 0, admitted: 0, used: 0 });
    c.undo();
    assert.equal(c.snapshot.dirty, true);
    c.redo();
    assert.equal(c.snapshot.dirty, false);
    c.undo();
    c.reset();
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
    assert.equal(c.snapshot.dirty, false);
});

test("a failed Save retains its draft and releases the save lock", async () => {
    const f = fixture((r) => (r.path.endsWith("/save") ? Promise.reject(new Error("Save failed")) : undefined)),
        c = f.controller;
    await c.load("source");
    c.split("t0");
    assert.equal(await c.save(), false);
    assert.equal(c.snapshot.saving, false);
    assert.equal(c.snapshot.dirty, true);
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
    assert.match(String(f.errors[0]), /Save failed/);
});

test("selection conflicts refresh only the selection baseline", async () => {
    const f = fixture((r) => (r.path.endsWith("/use") ? Promise.reject(new Error("Selection changed")) : undefined)),
        c = f.controller;
    await c.load("source");
    c.split("t0");
    await c.use();
    f.doc.selection = "new-selection";
    await c.refreshSelection();
    assert.equal(c.snapshot.review!.selection, "new-selection");
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
    assert.equal(c.snapshot.canUndo, true);
    assert.equal(c.snapshot.dirty, true);
    assert.equal(f.counts().used, 0);
});

test("empty saved workspaces retain the source and local breaking creates only a draft", async () => {
    const empty = document("source", false);
    const f = fixture((r) => (r.path.endsWith("/transcriptions/source") ? structuredClone(empty) : undefined)),
        c = f.controller;
    await c.load("source");
    assert.equal(c.snapshot.hasHistory, false);
    await c.automatic();
    assert.equal(c.snapshot.hasHistory, true);
    assert.equal(c.snapshot.dirty, true);
    assert.equal(c.snapshot.review!.savedEntries.length, 0);
    assert.equal(
        f.requests.some((r) => r.path.endsWith("/save") || r.path.endsWith("/use")),
        false,
    );
});

test("saved-entry deletion and refresh retain the current draft and undo history", async () => {
    const f = fixture((r) => {
            if (r.method === "DELETE") {
                f.doc.savedEntries = [];
                f.doc.versions = [];
                return null;
            }
            return undefined;
        }),
        c = f.controller;
    await c.load("source");
    c.split("t0");
    await c.deleteEntry("initial");
    assert.equal(c.snapshot.selectedEntryId, "");
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
    assert.equal(c.snapshot.canUndo, true);
    assert.equal(c.snapshot.dirty, true);
    await c.refreshEntries();
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
});

test("AI completion refreshes saved metadata without replacing manual edits", async () => {
    const f = fixture(),
        c = f.controller;
    await c.load("source");
    c.split("t0");
    const previous = c.snapshot;
    f.doc.savedEntries.push({ ...f.doc.savedEntries[0]!, entry: { ...f.doc.savedEntries[0]!.entry, id: "review:job" } });
    await c.refreshSaved("source");
    assert.equal(f.changes.at(-1), "choices");
    assert.deepEqual(c.snapshot.ends, previous.ends);
    assert.equal(c.snapshot.selectedEntryId, previous.selectedEntryId);
    assert.equal(c.snapshot.canUndo, true);
    assert.equal(c.snapshot.review!.savedEntries.length, 2);
});

test("a late transcript read cannot replace a newer transcript or revive a disposed session", async () => {
    const old = deferred<unknown>();
    const f = fixture((r) =>
            r.path.endsWith("/transcriptions/old") ? old.promise : r.path.endsWith("/transcriptions/new") ? document("new") : undefined,
        ),
        c = f.controller;
    const pending = c.load("old");
    await c.load("new");
    old.resolve(document("old"));
    await pending;
    assert.equal(c.snapshot.review!.transcript.id, "new");
    const held = deferred<unknown>();
    const g = fixture((r) => (r.path.endsWith("/transcriptions/source") ? held.promise : undefined));
    const loading = g.controller.load("source");
    await Promise.resolve();
    g.controller.dispose();
    held.resolve(document());
    await loading;
    assert.equal(g.controller.snapshot.review, null);
    assert.deepEqual(g.changes, []);
});

test("navigation invalidates delayed previews and automatic break responses", async () => {
    const held = deferred<unknown>();
    const f = fixture((r) => (r.path.endsWith("/preview") ? held.promise : undefined)),
        c = f.controller;
    await c.load("source");
    const preview = c.preview();
    c.split("t0");
    held.resolve({ lines: [] });
    await preview;
    assert.equal(f.counts().previews, 0);
    const breaking = deferred<unknown>(),
        g = fixture((r) => (r.path.endsWith("/break") ? breaking.promise : undefined));
    await g.controller.load("source");
    const pending = g.controller.automatic();
    g.controller.leave();
    breaking.resolve({ ...document().versions[0], endTokenIds: ["t0", "t2"] });
    await pending;
    assert.equal(g.controller.snapshot.review, null);
});

test("newer saved refreshes win without invalidating draft edits", async () => {
    const first = deferred<unknown>(),
        second = deferred<unknown>();
    let held = false,
        reads = 0;
    const f = fixture((r) => (held && r.path.endsWith("/transcriptions/source") ? (++reads === 1 ? first.promise : second.promise) : undefined)),
        c = f.controller;
    await c.load("source");
    held = true;
    const old = c.refreshSaved("source"),
        fresh = c.refreshSaved("source");
    c.split("t0");
    const newer = document();
    newer.savedEntries.push({ ...newer.savedEntries[0]!, entry: { ...newer.savedEntries[0]!.entry, id: "new" } });
    second.resolve(newer);
    await fresh;
    first.resolve(document());
    await old;
    assert.equal(c.snapshot.review!.savedEntries.length, 2);
    assert.deepEqual(c.snapshot.ends, ["t0", "t2"]);
});

test("AI plan identity follows the latest draft and stale counts cannot submit", async () => {
    const old = deferred<unknown>(),
        latest = deferred<unknown>();
    let plans = 0;
    const f = fixture((r) => (r.path.endsWith("/review-plan") ? (++plans === 1 ? old.promise : latest.promise) : undefined)),
        c = f.controller;
    await c.load("source");
    c.selectReviewOption("review");
    c.updateSettings({ seconds: 4 });
    latest.resolve({ identity: "new", requestCount: 3 });
    await latest.promise;
    await Promise.resolve();
    old.resolve({ identity: "old", requestCount: 99 });
    await old.promise;
    await Promise.resolve();
    assert.equal(c.snapshot.plan!.identity, "new");
    await c.requestReview();
    const submitted = f.requests.find((r) => r.path.endsWith("/review"))!.body as { planIdentity: string; settings: { seconds: number } };
    assert.equal(submitted.planIdentity, "new");
    assert.equal(submitted.settings.seconds, 4);
    assert.equal(f.counts().admitted, 1);
});

test("late review admission keeps monitoring without clearing a newer plan or draft", async () => {
    const admission = deferred<unknown>();
    const f = fixture((r) => (r.path.endsWith("/review") ? admission.promise : undefined)),
        c = f.controller;
    await c.load("source");
    c.selectReviewOption("review");
    await c.refreshPlan();
    const pending = c.requestReview();
    c.updateSettings({ seconds: 4 });
    await c.refreshPlan();
    admission.resolve({ id: "job", state: "queued", progress: 0, request: { service: "AI", kind: "boundary-review" } });
    await pending;
    assert.equal(f.counts().admitted, 1);
    assert.equal(c.snapshot.selectedReviewOption, "review");
    assert.equal(c.snapshot.settings.seconds, 4);
    assert.equal(c.snapshot.planStatus, "ready");
});

test("disposed sessions reject commands without mutating their last snapshot", async () => {
    const f = fixture(),
        c = f.controller;
    await c.load("source");
    const before = c.snapshot;
    c.dispose();
    c.split("t0");
    c.updateSettings({ seconds: 4 });
    c.leave();
    await c.load("other");
    await c.save();
    await c.preview();
    assert.equal(c.snapshot, before);
    assert.equal(f.requests.length, 2);
    assert.deepEqual(c.snapshot.ends, ["t2"]);
});
