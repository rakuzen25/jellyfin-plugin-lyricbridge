import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseSettings } from "./settings-draft.ts";

test("rebases independent fields and stable-ID collection edits without dropping additions", () => {
    const base = { StoragePath: "", Options: [{ Id: "one", Model: "old", Enabled: true }] };
    const local = { StoragePath: "/draft", Options: [{ Id: "one", Model: "mine", Enabled: true }] };
    const latest = {
        StoragePath: "",
        Options: [
            { Id: "one", Model: "old", Enabled: false },
            { Id: "two", Model: "new", Enabled: true },
        ],
    };
    const result = rebaseSettings(base, local, latest);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.configuration, {
        StoragePath: "/draft",
        Options: [
            { Id: "one", Model: "mine", Enabled: false },
            { Id: "two", Model: "new", Enabled: true },
        ],
    });
});
test("requires explicit choices for conflicts, deletion versus edit, and ordering", () => {
    const base = {
        Sources: [
            { Name: "A", Enabled: true },
            { Name: "B", Enabled: true },
            { Name: "C", Enabled: true },
        ],
    };
    const local = { Sources: [base.Sources[1], base.Sources[0], base.Sources[2]] };
    const latest = { Sources: [base.Sources[0], base.Sources[2], base.Sources[1]] };
    assert.equal(rebaseSettings(base, local, latest).conflicts[0]?.path, "Sources/order");
    assert.deepEqual(rebaseSettings(base, local, latest, new Map([["Sources/order", "latest"]])).configuration, latest);
    const removed = rebaseSettings({ Options: [{ Id: "x", Model: "old" }] }, { Options: [] }, { Options: [{ Id: "x", Model: "new" }] });
    assert.equal(removed.conflicts[0]?.path, "Options/x");
});
test("credential conflicts expose no replacement values and latest choice discards a replacement", () => {
    const base = { Id: "one", ApiKey: "", CredentialPresent: true, CredentialVersion: "old" };
    const local = { ...base, ApiKey: "PRIVATE-REPLACEMENT", CredentialAction: "replace" };
    const latest = { ...base, CredentialVersion: "latest" };
    const result = rebaseSettings(base, local, latest);
    assert.equal(result.conflicts.length, 1);
    assert.ok(!JSON.stringify(result.conflicts).includes("PRIVATE-REPLACEMENT"));
    assert.deepEqual(rebaseSettings(base, local, latest, new Map([["/credential", "latest"]])).configuration, latest);
});

test("deletion-versus-edit conflicts do not expose replacement credentials in comparison values", () => {
    const base = { Connections: [{ Id: "one", ApiKey: "", Name: "Before" }] };
    const local = { Connections: [{ Id: "one", ApiKey: "PRIVATE-REPLACEMENT", Name: "Edited" }] };
    const latest = { Connections: [] };
    assert.ok(!JSON.stringify(rebaseSettings(base, local, latest).conflicts).includes("PRIVATE-REPLACEMENT"));
});
