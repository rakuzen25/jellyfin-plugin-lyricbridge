import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchAdmission, parseSearchResults, rankCandidates } from "./search-models.ts";
const candidate = { source: "fixture", id: "one", title: "Title", artist: "Artist", score: 90 };
test("search contracts reject malformed provider data before UI iteration", () => {
    assert.throws(() => parseSearchAdmission({ id: "" }), /invalid search session/);
    const base = { state: "complete", finished: 1, total: 1, candidates: [candidate], errors: [] };
    assert.deepEqual(parseSearchResults(base).candidates, [candidate]);
    for (const candidates of [null, [{ ...candidate, title: { text: "bad" } }], [{ ...candidate, assessment: { score: 100 } }]])
        assert.throws(() => parseSearchResults({ ...base, candidates }), /invalid search results/);
    assert.throws(() => parseSearchResults({ ...base, errors: [{ code: "fixture", message: 5 }] }), /invalid search results/);
});
test("manual candidate sorting remains deterministic for score ties", () => {
    const second = { ...candidate, id: "two" },
        strong = { ...candidate, id: "strong", score: 100 };
    assert.deepEqual(
        [second, strong, candidate].sort(rankCandidates).map((value) => value.id),
        ["strong", "one", "two"],
    );
});

test("final improvement metadata is validated rather than trusted", () => {
    const base = { state: "complete", finished: 1, total: 1, candidates: [candidate], errors: [] };
    const improvement = { key: "fixture:one", hash: "new", baselineHash: "old", reason: "auxiliary-completeness", description: "More supplied rows" };
    assert.deepEqual(parseSearchResults({ ...base, improvement }).improvement, improvement);
    for (const malformed of [{ ...improvement, hash: null }, { ...improvement, description: {} }, []])
        assert.throws(() => parseSearchResults({ ...base, improvement: malformed }), /invalid search results/);
});
