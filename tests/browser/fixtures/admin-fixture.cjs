const { expect } = require("playwright/test");
const path = require("node:path");
const { existsSync, readFileSync } = require("node:fs");

exports.mountAdmin = async function mountAdmin(page, { nativeControls = true, startup = null, upgrades = [] } = {}) {
    await page.route("**/*", (route) =>
        new URL(route.request().url()).pathname === "/config.html"
            ? route.fulfill({
                  contentType: "text/html",
                  body: readFileSync(path.resolve(__dirname, "../../../dist/web/config.html"), "utf8").replace(/\$\{([^}]+)\}/g, "$1"),
              })
            : route.fulfill({ status: 204, body: "" }),
    );
    await page.addInitScript(
        ({ startup, upgrades }) => {
            const song = "11111111-1111-1111-1111-111111111111",
                user = "22222222-2222-2222-2222-222222222222";
            const option = (Id, Capability, Provider, Name, ConnectionId = null) => ({
                Id,
                Capability,
                Provider,
                Name,
                ConnectionId,
                Enabled: true,
                Model: Provider === "AI" ? "fixture-model" : "",
                TimeoutSeconds: 120,
                ContextBefore: 0,
                ContextAfter: 0,
                ReasoningEffort: "",
                UploadFormat: "opus",
                MaxInputMb: 256,
                MaxUploadMb: 25,
                ModelContextWindow: 32768,
                DetectModelLimits: false,
                ModelCompletionLimit: null,
            });
            const config = {
                StoragePath: "",
                EnableWebRenderer: true,
                MinimumMatch: 70,
                ScheduledRetrieval: false,
                AutoGeneratePronunciation: true,
                AllowUserRequests: true,
                AutoApproveUserRequests: false,
                UserRequestDailyQuota: 5,
                UserRequestActiveCap: 3,
                Defaults: {
                    TranslationLanguage: "en",
                    SourceLanguage: "auto",
                    OriginalChineseScript: "Simplified",
                    RomanizationSystem: "Hepburn",
                    RowOrder: "pronunciation-first",
                    OriginalSize: 40,
                    PronunciationSize: 24,
                    TranslationSize: 24,
                    RowSpacing: 6,
                    ShowTranslation: true,
                    ShowPronunciation: true,
                    JapaneseRomaji: true,
                },
                Sources: ["QQ", "NetEase", "Kugou", "Soda", "Musixmatch", "Spotify", "AppleMusic", "LRCLIB"].map((Name) => ({
                    Name,
                    Enabled: true,
                    Credential: "",
                })),
                SchemaVersion: 1,
                ServiceSetup: {
                    Connections: [{ Id: "connection", Name: "Fixture endpoint", Provider: "AI", Endpoint: "https://example.test/v1", ApiKey: "" }],
                    Options: [
                        option("translation", "translation", "AI", "Fixture translation", "connection"),
                        option("transcription", "transcription", "AI", "Fixture transcription", "connection"),
                        option("review", "boundary-review", "AI", "Fixture review", "connection"),
                        option("local", "pronunciation", "Kawazu", "Japanese romaji"),
                    ],
                },
            };
            const make = (kind, id, blocker = null) => ({
                target: { kind, id },
                inspection: {
                    lines: [{ text: "Hello from stored lyrics", startSeconds: 2 }],
                    fields: [],
                    metadata: [],
                    relationships: blocker
                        ? [{ role: "blocker", target: { kind: "saved-original", id: "saved" }, label: "Original lyrics", missing: false }]
                        : [],
                    restriction: blocker,
                    canCancel: false,
                },
                category: kind === "transcript" ? "transcripts" : "originals",
                title: "Saved fixture lyrics " + id,
                source: "Imported",
                storedAt: "2026-10-10T10:00:00Z",
                itemIds: [song],
                userIds: [user],
                payloadBytes: 100,
                canDelete: !blocker,
                blocker,
                dependencies: blocker ? [{ kind: "saved-original", id: "saved" }] : [],
                songs: [{ id: song, name: "Missing song", missing: true }],
                accounts: [{ id: user, name: "Missing account", missing: true }],
                data: {
                    title: "Saved fixture lyrics",
                    source: "Imported",
                    lines: [{ text: "Hello from stored lyrics", start: 100 }],
                    credentialPresent: true,
                },
            });
            const records = [make("saved-original", "saved"), make("transcript", "transcript", "Delete the saved original first.")];
            const jobs = ["pending", "running", "failed", "complete"].map((state, index) => ({
                id: "job" + index,
                title: "Fixture request " + index,
                state,
                progress: 50,
                request: { kind: "translation", language: "en" },
                taskKind: "language",
                outputDeleted: index === 2,
                stage: "Fixture stage",
            }));
            window.adminFixture = {
                config,
                startup,
                upgrades,
                revision: 1,
                records,
                jobs,
                calls: [],
                writes: [],
                failSave: false,
                failExecute: false,
                failLoad: false,
                partial: false,
                manyRecords: false,
                entityTotal: 51,
                expirePreview: false,
                credentials: { "source:Spotify": "SAVED-SOURCE-SECRET", "connection:connection": "SAVED-CONNECTION-SECRET" },
                make,
            };
            const f = window.adminFixture;
            function snapshot() {
                const result = structuredClone(f.config);
                for (const [entries, kind, key] of [
                    [result.Sources, "source", "Credential"],
                    [result.ServiceSetup.Connections, "connection", "ApiKey"],
                ])
                    for (const entry of entries) {
                        entry[key] = "";
                        const secret = f.credentials[kind + ":" + (entry.Id || entry.Name)];
                        entry.CredentialPresent = !!secret;
                        entry.CredentialVersion = secret ? "opaque-" + f.revision : "empty";
                    }
                return { configuration: result, revision: String(f.revision) };
            }
            function jobRecord(job) {
                return {
                    ...make("job", job.id),
                    title: job.title,
                    canDelete: !["pending", "running", "queued"].includes(job.state),
                    blocker: ["pending", "running", "queued"].includes(job.state) ? "Cancel this request first." : null,
                    category: "history",
                    displayType: "Generation request",
                    inspection: {
                        lines: [],
                        fields: [
                            { label: "Status", value: job.state },
                            { label: "Progress", value: String(job.progress), format: "percent" },
                        ],
                        metadata: [],
                        relationships: [],
                        canCancel: ["pending", "running", "queued"].includes(job.state),
                    },
                };
            }
            window.ApiClient = {
                getUrl: (path) => "/base/" + path,
                getPluginConfiguration: async () => {
                    throw new Error("Legacy credential-bearing read must not be used");
                },
                updatePluginConfiguration: async () => {
                    throw new Error("Unversioned configuration save must not be used");
                },
                ajax: async (options) => {
                    const url = new URL(options.url, "http://fixture.invalid"),
                        p = url.pathname,
                        input = options.data ? JSON.parse(options.data) : null;
                    f.calls.push({ path: p, search: url.search, input, method: options.type });
                    if (p.endsWith("/acknowledge")) {
                        f.upgrades.find((r) => p.includes(r.id)).acknowledged = true;
                        return {};
                    }
                    if (p.endsWith("/backup-deletion-preview")) {
                        const record = f.upgrades.find((r) => p.includes(r.id));
                        return { token: "confirmed-preview", path: record.backupPath, bytes: record.backupBytes };
                    }
                    if (p.endsWith("/backup") && options.type === "DELETE") {
                        if (input.token !== "confirmed-preview") throw new Error("Preview required");
                        f.upgrades.find((r) => p.includes(r.id)).backupState = "deleted";
                        return {};
                    }
                    if (p.endsWith("admin/startup")) return f.startup || { state: "ready", phase: "complete" };
                    if (p.endsWith("admin/upgrades")) return f.upgrades || [];
                    if (p.endsWith("admin/settings")) {
                        if (options.type === "PUT") {
                            if (f.failSave)
                                throw {
                                    status: 500,
                                    responseJSON: { error: { message: "Settings were not saved. Synthetic persistence failure." } },
                                };
                            if (input.revision !== String(f.revision))
                                throw { status: 409, responseJSON: { error: { message: "Saved settings changed." } } };
                            for (const item of input.credentials)
                                f.credentials[item.kind + ":" + item.id] = item.action === "clear" ? "" : item.value;
                            f.config = input.configuration;
                            f.writes.push(input);
                            f.revision++;
                        }
                        return snapshot();
                    }
                    if (p.includes("admin/web-renderer"))
                        return { enabled: f.config.EnableWebRenderer, mechanism: "direct", webRoot: "/fixture/web", result: "Ready" };
                    if (p.endsWith("admin/runtime"))
                        return { activeStoragePath: "/fixture/storage", configuredStoragePath: "/pending/storage", restartRequired: true };
                    if (p.endsWith("admin/requests")) {
                        const finished = url.searchParams.get("group") === "finished",
                            offset = Number(url.searchParams.get("offset")),
                            limit = Number(url.searchParams.get("limit"));
                        const all = f.jobs.filter((job) => !["pending", "queued", "running"].includes(job.state) === finished);
                        return { items: all.slice(offset, offset + limit), total: all.length, offset, limit };
                    }
                    if (p.includes("/jobs/")) {
                        const parts = p.split("/"),
                            action = parts.at(-1),
                            id = parts.at(-2);
                        const job = f.jobs.find((job) => job.id === id);
                        if (job) job.state = action === "cancel" ? "cancelled" : action === "reject" ? "rejected" : "queued";
                        return {};
                    }
                    if (p.includes("service-options/model-limits")) return { available: true, contextWindow: 64000, completionLimit: 4096 };
                    if (p.endsWith("/test")) return { state: "ready" };
                    if (p.endsWith("data/overview")) {
                        if (f.failLoad) throw new Error("Synthetic data load failure");
                        return {
                            activeStoragePath: "/fixture/storage",
                            configuredStoragePath: "/pending/storage",
                            restartRequired: true,
                            databaseBytes: 1024,
                            walBytes: 200,
                            audioBytes: 300,
                            categories: [
                                "originals",
                                "versions",
                                "transcripts",
                                "line-breaks",
                                "selections",
                                "preferences",
                                "history",
                                "bookkeeping",
                            ].map((name, i) => ({ name, count: i + 1, payloadBytes: 100 * (i + 1) })),
                            bookkeeping: { deletionRevisions: 2 },
                            retention: "Finished requests: 30 days.",
                        };
                    }
                    if (p.endsWith("data/configuration"))
                        return {
                            storagePath: "/fixture/storage",
                            sources: [{ name: "Spotify", credentialPresent: true }],
                            serviceSetup: { connections: [{ name: "Fixture endpoint", apiKeyPresent: true }] },
                            defaults: { showTranslation: true },
                        };
                    if (p.endsWith("data/songs") || p.endsWith("data/accounts"))
                        return {
                            items: [
                                {
                                    identity: {
                                        id: p.endsWith("accounts") ? user : song,
                                        name: p.endsWith("accounts") ? "Missing account" : "Missing song",
                                        missing: true,
                                    },
                                    artist: "Fixture artist",
                                    records: f.records.length,
                                    payloadBytes: 200,
                                },
                            ],
                            total: f.entityTotal,
                            offset: Number(url.searchParams.get("offset")),
                            limit: 50,
                        };
                    if (p.endsWith("data/records")) {
                        const all = f.manyRecords ? Array.from({ length: 101 }, (_, i) => make("saved-original", "record" + i)) : f.records;
                        const filtered = url.searchParams.get("category")
                            ? all.filter((item) => item.category === url.searchParams.get("category"))
                            : all;
                        const offset = Number(url.searchParams.get("offset"));
                        return { items: filtered.slice(offset, offset + 50), total: filtered.length, offset, limit: 50 };
                    }
                    if (p.endsWith("data/detail") && url.searchParams.get("kind") === "job")
                        return jobRecord(f.jobs.find((job) => job.id === url.searchParams.get("id")));
                    if (p.endsWith("data/detail"))
                        return (
                            f.records.find((item) => item.target.id === url.searchParams.get("id")) ||
                            make("saved-original", url.searchParams.get("id"))
                        );
                    if (p.endsWith("data/preview")) {
                        f.preview = input;
                        const all = [
                            ...f.records,
                            ...f.jobs.map(jobRecord),
                            ...(f.manyRecords ? Array.from({ length: 101 }, (_, i) => make("saved-original", "record" + i)) : []),
                        ];
                        return {
                            token: "opaque-token",
                            confirmation:
                                input.action === "factory-reset"
                                    ? "FACTORY RESET"
                                    : input.action.includes("reset")
                                      ? "RESET"
                                      : input.action === "category"
                                        ? "DELETE"
                                        : "",
                            items: input.targets ? all.filter((item) => input.targets.some((target) => target.id === item.target.id)) : all,
                            effects: ["Shared content is retained while another song requires it."],
                            expires: new Date(Date.now() + (f.expirePreview ? -1000 : 600000)).toISOString(),
                        };
                    }
                    if (p.endsWith("data/execute")) {
                        if (f.failExecute) throw new Error("Stored data changed. Preview again.");
                        if (f.preview.action === "factory-reset") {
                            f.config.StoragePath = "/fixture/storage";
                            f.credentials = {};
                            f.revision++;
                        }
                        const targets = f.preview.targets || f.records.map((item) => item.target);
                        const outcomes = targets.map((target, index) => ({
                            target,
                            status: f.partial && index ? "failed" : "deleted",
                            message: f.partial && index ? "Synthetic failure" : undefined,
                        }));
                        f.jobs = f.jobs.filter((job) => !outcomes.some((item) => item.target.id === job.id && item.status === "deleted"));
                        return { complete: !f.partial, outcomes };
                    }
                    return {};
                },
            };
        },
        { startup, upgrades },
    );
    await page.goto("http://fixture.invalid/config.html");
    const css = path.resolve(__dirname, "../../../.build/jellyfin-admin.css"),
        controls = path.resolve(__dirname, "../../../.build/jellyfin-admin-native.js");
    if (nativeControls && existsSync(css) && existsSync(controls)) {
        await page.addStyleTag({ content: readFileSync(css, "utf8") });
        const theme = path.resolve(__dirname, "../../../.build/jellyfin-admin-theme.css");
        if (existsSync(theme)) await page.addStyleTag({ content: readFileSync(theme, "utf8") });
        await page.addScriptTag({ path: controls });
    }
    await page.locator("#LyricBridgeConfig").dispatchEvent("viewshow");
    if (startup?.state === "blocked") await expect(page.getByRole("heading", { name: "LyricBridge startup is blocked" })).toBeVisible();
    else await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
};
