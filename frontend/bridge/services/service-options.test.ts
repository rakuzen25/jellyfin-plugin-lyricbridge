import assert from "node:assert/strict";
import test from "node:test";
import { parseServiceOptions } from "./service-options.ts";
const option = {
    id: "audio",
    name: "Groq · Whisper",
    capability: "transcription",
    provider: "AI",
    model: "whisper",
    status: "Ready",
    maxInputMb: 256,
    maxUploadMb: 25,
};
test("service options preserve independent identities and reject malformed catalogs", () => {
    assert.deepEqual(
        parseServiceOptions([option, { ...option, id: "review", capability: "boundary-review" }]).map((o) => o.id),
        ["audio", "review"],
    );
    assert.throws(() => parseServiceOptions([option, option]));
    for (const value of [
        { ...option, status: "Configured" },
        { ...option, id: "" },
        { ...option, maxInputMb: 0 },
        { ...option, maxUploadMb: Infinity },
        { ...option, name: null },
    ])
        assert.throws(() => parseServiceOptions([value]));
});
