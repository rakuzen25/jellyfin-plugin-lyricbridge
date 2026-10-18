import assert from "node:assert/strict";
import { test } from "node:test";
import { PreviewSession } from "./preview-session.ts";
test("repeated previews retain the original playback baseline and newest deferred response", () => {
    const owner = {},
        preview = new PreviewSession<object, string>();
    preview.begin(owner, "original", 7);
    preview.begin(owner, "preview", 19);
    assert.equal(preview.defer(owner, { data: "new", renderNow: true, order: 5 }), true);
    preview.defer(owner, { data: "older", renderNow: true, order: 3 });
    const ended = preview.finish(owner, true);
    assert.equal(ended.baseline?.doc, "original");
    assert.equal(ended.baseline?.time, 7);
    assert.equal(ended.pending?.data, "new");
    assert.equal(preview.baseline, null);
});
test("apply drops deferred baseline data so another preview cannot replay it", () => {
    const owner = {},
        preview = new PreviewSession<object, string>();
    preview.begin(owner, "original", 7);
    preview.defer(owner, { data: "stale", renderNow: true });
    assert.deepEqual(preview.finish(owner, false), { baseline: null, pending: null });
    preview.begin(owner, "saved-selection", 19);
    assert.equal(preview.finish(owner, true).pending, null);
});
test("track/account identity changes never restore another session including A to B to A", () => {
    const first = {},
        second = {},
        returned = {},
        preview = new PreviewSession<object, string>();
    preview.begin(first, "first", 7);
    assert.equal(preview.defer(second, { data: "second", renderNow: true }), false);
    assert.deepEqual(preview.finish(returned, true), { baseline: null, pending: null });
});
