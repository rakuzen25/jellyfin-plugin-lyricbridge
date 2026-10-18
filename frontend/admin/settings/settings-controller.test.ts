import assert from "node:assert/strict";
import { test } from "node:test";
import type { Configuration } from "./contracts.ts";
import { SettingsController, type SettingsRequest, type SettingsSnapshot } from "./settings-controller.ts";

function configuration(): Configuration {
    const service = {
        Name: "AI",
        Enabled: true,
        Endpoint: "",
        ApiKey: "",
        Model: "",
        ContextBefore: 0,
        ContextAfter: 0,
        ReasoningEffort: "",
        TimeoutSeconds: 120,
    };
    return {
        ServiceSetup: { Version: 1, Connections: [], Options: [] },
        Transcription: {
            Enabled: false,
            Endpoint: "",
            Model: "",
            ApiKey: "",
            UploadFormat: "opus",
            MaxUploadMb: 25,
            MaxInputMb: 256,
            TimeoutSeconds: 120,
            ReviewUsesAiService: true,
            Review: service,
        },
        EnableWebRenderer: true,
        StoragePath: "",
        MinimumMatch: 70,
        ScheduledRetrieval: false,
        AutoGeneratePronunciation: true,
        AllowUserRequests: false,
        AutoApproveUserRequests: false,
        UserRequestDailyQuota: 5,
        UserRequestActiveCap: 3,
        Sources: [],
        Services: [service],
        Defaults: {
            SourceLanguage: "auto",
            TranslationLanguage: "zh-Hans",
            RowOrder: "pronunciation-first",
            OriginalSize: 40,
            PronunciationSize: 24,
            TranslationSize: 24,
            RowSpacing: 6,
            ShowPronunciation: true,
            ShowTranslation: true,
            JapaneseRomaji: true,
        },
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function setup(call: SettingsRequest) {
    const controller = new SettingsController(call);
    controller.accept({ configuration: configuration(), revision: "initial" });
    return controller;
}

test("settings preserve newer manual edits across a save and advance only the saved baseline", async () => {
    const response = deferred<SettingsSnapshot>();
    const controller = setup(<T>() => response.promise as Promise<T>);
    const draft = controller.snapshot().configuration!;
    draft.StoragePath = "/first";
    controller.replaceDraft(draft);
    const save = controller.save();
    draft.MinimumMatch = 91;
    controller.replaceDraft(draft);
    response.resolve({ configuration: { ...draft, MinimumMatch: 70 }, revision: "saved" });
    assert.equal(await save, false);
    assert.equal(controller.snapshot().configuration?.MinimumMatch, 91);
    assert.equal(controller.snapshot().baseline?.MinimumMatch, 70);
    assert.equal(controller.snapshot().revision, "saved");
    assert.equal(controller.snapshot().dirty, true);
});

test("failed settings saves retain both the draft and its original baseline", async () => {
    const controller = setup(async () => {
        throw new Error("offline");
    });
    const draft = controller.snapshot().configuration!;
    draft.MinimumMatch = 88;
    controller.replaceDraft(draft);
    await assert.rejects(controller.save(), /offline/);
    assert.equal(controller.snapshot().configuration?.MinimumMatch, 88);
    assert.equal(controller.snapshot().baseline?.MinimumMatch, 70);
    assert.equal(controller.snapshot().saving, false);
    assert.equal(controller.snapshot().dirty, true);
});

test("late settings loads cannot replace manual edits, accepted snapshots, or disposed sessions", async () => {
    for (const change of ["edit", "accept", "dispose"] as const) {
        const response = deferred<SettingsSnapshot>();
        const controller = setup(<T>() => response.promise as Promise<T>);
        const load = controller.load();
        const newer = { ...configuration(), MinimumMatch: 96 };
        if (change === "edit") controller.replaceDraft(newer);
        else if (change === "accept") controller.accept({ configuration: newer, revision: "newer" });
        else controller.dispose();
        response.resolve({ configuration: configuration(), revision: "late" });
        assert.equal(await load, false, change);
        assert.equal(controller.snapshot().configuration?.MinimumMatch, change === "dispose" ? 70 : 96, change);
    }
});

test("a save invalidates earlier loads while repeated compares accept only the newest response", async () => {
    const pending: ReturnType<typeof deferred<SettingsSnapshot>>[] = [];
    const controller = setup(<T>() => {
        const item = deferred<SettingsSnapshot>();
        pending.push(item);
        return item.promise as Promise<T>;
    });
    const load = controller.load();
    const save = controller.save();
    pending[1]!.resolve({ configuration: { ...configuration(), MinimumMatch: 80 }, revision: "save" });
    await save;
    pending[0]!.resolve({ configuration: configuration(), revision: "old-load" });
    assert.equal(await load, false);
    assert.equal(controller.snapshot().revision, "save");
    const first = controller.compare(),
        second = controller.compare();
    pending[3]!.resolve({ configuration: { ...configuration(), MinimumMatch: 85 }, revision: "latest" });
    assert.ok(await second);
    pending[2]!.resolve({ configuration: configuration(), revision: "old-compare" });
    assert.equal(await first, undefined);
    assert.equal(controller.comparison()?.latest.MinimumMatch, 85);
});

test("settings conflicts need an explicit choice and snapshots never expose the private draft", async () => {
    const controller = setup(async <T>() => ({ configuration: { ...configuration(), MinimumMatch: 90 }, revision: "latest" }) as T);
    const draft = controller.snapshot().configuration!;
    draft.MinimumMatch = 80;
    controller.replaceDraft(draft);
    draft.MinimumMatch = 99;
    assert.equal(controller.snapshot().configuration?.MinimumMatch, 80);
    assert.equal((await controller.compare())?.conflicts.length, 1);
    assert.equal(controller.rebase(new Map()), false);
    const path = controller.comparison()!.conflicts[0]!.path;
    assert.equal(controller.rebase(new Map([[path, "local"]])), true);
    assert.equal(controller.snapshot().configuration?.MinimumMatch, 80);
    assert.equal(controller.snapshot().baseline?.MinimumMatch, 90);
    assert.equal(controller.snapshot().dirty, true);
});
