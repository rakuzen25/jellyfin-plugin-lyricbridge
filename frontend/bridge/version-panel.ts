import { requireValue } from "../shared/invariants.ts";
import type { LyricLine, RichLyrics } from "../shared/lyrics.ts";
import type {} from "../shared/runtime.ts";
import { rowLanguage, translationLanguageMatches, translationScript } from "./auxiliary.ts";
import type { BridgeDocument, ServiceCapability, TrackScope } from "./contracts.ts";
import { button, e, field, select } from "./controls.ts";
import type { AuxiliaryKind, Preferences, Variant } from "./models.ts";
interface Context {
    popup: HTMLElement | null;
    languagePlayback: { scope: TrackScope | null; input: HTMLElement } | null;
    scope: TrackScope | null;
    current: BridgeDocument | null;
    services: ServiceCapability[];
}
interface Dependencies {
    context: Context;
    documentState: () => BridgeDocument;
    originalLanguages: () => Set<string | undefined>;
    languageChoices: [string, string][];
    trackScope: () => TrackScope;
    richLines: (doc: RichLyrics | null | undefined) => LyricLine[];
    auxiliary: (
        line: LyricLine,
        kind: AuxiliaryKind,
        preferences: Preferences,
        document?: BridgeDocument | null,
    ) => { text: string; provenance: string; key: string } | null;
    startPlaybackPreview: (doc: BridgeDocument, label: string, actions: HTMLElement[]) => void;
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: (() => void) | undefined) => void;
    api: (path: string, method?: string, body?: unknown, signal?: AbortSignal | null | undefined) => Promise<unknown>;
    refreshSong: (force?: boolean) => Promise<void>;
    showError: (cause: unknown, parent?: HTMLElement | null | undefined, retryAction?: () => unknown) => void;
    confirmation: (parent: HTMLElement, message: string, action: () => unknown, label?: string, trigger?: HTMLElement | undefined) => void;
    status: (message: string, error?: boolean, ttl?: number) => void;
    closeSearch: (restore?: boolean) => void;
    openVersions: (better?: RichLyrics | null | undefined, mixKind?: AuxiliaryKind | undefined) => Promise<void>;
    mark: (clear: boolean) => Promise<void>;
    importLyrics: (existing: boolean) => Promise<void>;
    action: (name: string) => Promise<void>;
    capabilities: () => Promise<void>;
    generate: (kind: AuxiliaryKind, service: string, parent: HTMLElement, forceNew?: boolean) => Promise<void>;
}
export function createVersionPanel(dependencies: Dependencies) {
    const {
        context,
        documentState,
        originalLanguages,
        languageChoices,
        trackScope,
        richLines,
        auxiliary,
        startPlaybackPreview,
        notice,
        api,
        refreshSong,
        showError,
        confirmation,
        status,
        closeSearch,
        openVersions,
        mark,
        importLyrics,
        action,
        capabilities,
        generate,
    } = dependencies;
    function languageVersions(parent: HTMLElement, kind: AuxiliaryKind) {
        const p = documentState().preferences,
            area = e("div", "lb-language-versions");
        area.dataset.versionKind = kind;
        parent.append(area);
        const versions = (documentState().variants || []).filter(
            (v) => v.kind === kind && (kind === "pronunciation" || translationLanguageMatches(v.language, p.translationLanguage)),
        );
        const all: (Pick<Variant, "key"> & Partial<Variant> & { title: string; description: string })[] = [
            {
                key: "auto",
                title: "Automatic",
                description:
                    "Provider rows first" +
                    (kind === "pronunciation" && originalLanguages().has("ja") ? ", then missing Japanese romaji locally." : "."),
            },
            { key: "provider", title: "Provider supplied only", description: "Use rows included with the original lyrics." },
            ...versions.map((v) => ({
                ...v,
                title: v.service,
                description:
                    (languageChoices.find((l) => l[0] === v.language)?.[1] || v.language) +
                    " · " +
                    (v.originType === "supplied" ? "Supplied" : v.originType === "local" ? "Local" : "Generated") +
                    (v.model ? " · " + v.model : "") +
                    (v.createdAt ? " · " + new Date(v.createdAt).toLocaleDateString() : ""),
            })),
        ];
        const active = () => documentState().auxiliaryChoices?.[kind] || "auto";
        trackScope().versionBrowsing ??= {};
        if (!all.some((v) => v.key === requireValue(trackScope().versionBrowsing)[kind])) requireValue(trackScope().versionBrowsing)[kind] = active();
        const expand = (key: string) => {
            requireValue(trackScope().versionBrowsing)[kind] = key;
            (context.popup?.querySelector<HTMLElement>('[data-version-kind="' + kind + '"]') || area)
                .querySelectorAll<HTMLElement>(".lb-version-row")
                .forEach((row) => {
                    const open = row.dataset.key === key;
                    requireValue(row.querySelector<HTMLElement>(".lb-version-toggle")).setAttribute("aria-expanded", String(open));
                    requireValue(row.querySelector<HTMLElement>(".lb-version-content")).hidden = !open;
                });
        };
        const updateActive = () =>
            area.querySelectorAll<HTMLElement>(".lb-version-row").forEach((row) => {
                const selected = row.dataset.key === active();
                row.dataset.active = String(selected);
                requireValue(row.querySelector<HTMLElement>(".lb-active-label")).textContent = selected ? "In use" : "";
                requireValue(row.querySelector<HTMLButtonElement>(".lb-use-version")).disabled = selected;
            });
        for (const version of all) {
            const signature = JSON.stringify([version, p, documentState().canDeleteVariants]);
            const existing = trackScope().reusableVersionRows?.get(kind + ":" + version.key);
            if (existing?.dataset.versionSignature === signature) {
                area.append(existing);
                continue;
            }
            const row = e("article", "lb-version-row");
            row.dataset.key = version.key;
            row.dataset.versionSignature = signature;
            row.setAttribute("aria-label", version.title + " " + kind + " version");
            const heading = button("", () => expand(version.key), "lb-version-toggle");
            heading.setAttribute("aria-expanded", "false");
            const summary = e("span", "lb-version-summary");
            summary.append(e("strong", "", version.title));
            if (version.key !== "provider")
                summary.append(
                    e(
                        "small",
                        "lb-provenance",
                        version.language
                            ? (languageChoices.find((l) => l[0] === version.language)?.[1] || version.language) +
                                  " · " +
                                  (version.originType === "supplied" ? "Supplied" : version.originType === "local" ? "Local" : "Generated")
                            : version.key === "auto"
                              ? kind === "pronunciation"
                                  ? "Provider first · local when available"
                                  : "Provider first"
                              : "Supplied rows only",
                    ),
                );
            heading.append(summary, e("span", "lb-active-label lb-status-badge"));
            heading.setAttribute("aria-label", version.title + " " + kind + " version");
            const content = e("div", "lb-version-content");
            content.id = "lb-version-" + kind + "-" + all.indexOf(version);
            heading.setAttribute("aria-controls", content.id);
            if (!["auto", "provider"].includes(version.key))
                content.append(
                    e(
                        "p",
                        "lb-help",
                        [version.model, version.createdAt ? new Date(version.createdAt).toLocaleDateString() : null].filter(Boolean).join(" · "),
                    ),
                );
            row.append(heading, content);
            if (Object.keys(version.skippedRows || {}).length)
                content.append(
                    e(
                        "p",
                        "lb-help",
                        "Partial pronunciation: " +
                            Object.keys(version.skippedRows || {}).length +
                            " empty, Latin-only, or unsupported rows were skipped.",
                    ),
                );
            const doc = (): BridgeDocument => ({
                ...documentState(),
                auxiliaryChoices: { translation: "auto", pronunciation: "auto", ...documentState().auxiliaryChoices, [kind]: version.key },
            });

            const actions = e("div", "lb-song-actions"),
                preview = e("div", "lb-version-preview"),
                feedback = e("p", "lb-version-status");
            preview.hidden = true;
            feedback.setAttribute("role", "status");
            const previewButton = button("Preview", () => {
                preview.hidden = !preview.hidden;
                previewButton.setAttribute("aria-expanded", String(!preview.hidden));
                if (preview.hidden) return;
                preview.replaceChildren();
                let count = 0;
                for (const line of richLines(documentState().lyrics)) {
                    const value = auxiliary(line, kind, p, requireValue(doc()));
                    if (!value?.text) continue;
                    const block = e("div", "lb-preview-block");
                    const original = e("strong", "", line.text);
                    original.lang = rowLanguage(line.language, p.originalChineseScript, line.text);
                    const translated = e("p", "", value.text);
                    translated.lang = rowLanguage(
                        kind === "translation" ? p.translationLanguage : line.language,
                        translationScript(p),
                        value.text,
                        kind === "pronunciation",
                    );
                    block.append(original, translated);
                    preview.append(block);
                    if (++count === 3) break;
                }
                if (!count) preview.append(e("p", "lb-help", "No rows available."));
                preview.append(
                    button("Preview with playback", () => {
                        stopLanguagePlayback();
                        context.languagePlayback = { scope: context.scope, input: previewButton };
                        startPlaybackPreview(requireValue(doc()), "Previewing " + kind + " · " + version.title, [
                            button("Return to versions", stopLanguagePlayback),
                        ]);
                        requireValue(context.popup).hidden = true;
                    }),
                );
            });
            previewButton.setAttribute("aria-expanded", "false");
            const use = button(
                "Use",
                async () => {
                    const target = context.scope,
                        hash = requireValue(documentState().lyrics).hash;
                    use.disabled = true;
                    notice(feedback, "Saving…");
                    try {
                        await api("items/" + requireValue(target).itemId + "/language-version", "POST", { hash, kind, key: version.key });
                        if (context.scope !== target) return;
                        stopLanguagePlayback();
                        await refreshSong();
                        updateActive();
                        notice(feedback, "Saved for your account", 4000);
                    } catch (error) {
                        showError(error, content, () => use.click());
                        updateActive();
                    }
                },
                "lb-use-version",
            );
            actions.append(previewButton, use);
            if (documentState().canDeleteVariants && !["auto", "provider"].includes(version.key) && version.service !== "Kawazu") {
                const remove = button(
                    "Delete",
                    () =>
                        confirmation(
                            content,
                            "Delete this saved " +
                                kind +
                                " version for all users? Accounts using it will return to Automatic. This cannot be undone.",
                            async () => {
                                const target = context.scope;
                                await api("items/" + requireValue(target).itemId + "/language-version", "DELETE", {
                                    hash: requireValue(documentState().lyrics).hash,
                                    kind,
                                    key: version.key,
                                });
                                if (context.scope !== target) return;
                                stopLanguagePlayback();
                                requireValue(trackScope().versionBrowsing)[kind] = active() === version.key ? "auto" : active();
                                remove.closest(".lb-version-row")?.remove();
                                await refreshSong();
                                updateActive();
                                context.popup
                                    ?.querySelector<HTMLElement>('[data-version-kind="' + kind + '"] .lb-version-toggle[aria-expanded=true]')
                                    ?.focus();
                                status("Saved " + kind + " version deleted", false, 4000);
                            },
                            "Delete version",
                            remove,
                        ),
                    "lb-danger",
                );
                actions.append(remove);
            }
            content.append(actions, feedback, preview);
            area.append(row);
        }
        updateActive();
        expand(requireValue(trackScope().versionBrowsing)[kind] || "auto");
    }
    function stopLanguagePlayback() {
        if (!context.languagePlayback) return;
        const input = context.languagePlayback.input;
        context.languagePlayback = null;
        closeSearch();
        if (context.popup) context.popup.hidden = false;
        if (input?.isConnected) input.focus();
    }
    function drawJobDetails(parent: HTMLElement, kind: AuxiliaryKind) {
        for (const job of context.scope?.jobs?.values() || []) {
            if (job.request.kind !== kind || (job.hash && job.hash !== context.current?.lyrics?.hash)) continue;
            let box = parent.querySelector<HTMLElement>('[data-job-detail="' + job.id + '"]');
            if (!box) {
                box = e("div", "lb-job-details");
                box.dataset.jobDetail = job.id;
                box.append(e("p", "lb-job-detail-status"));
                parent.append(box);
            }
            requireValue(box.querySelector<HTMLElement>(".lb-job-detail-status")).textContent =
                job.request.service + " · " + job.state + " · " + job.progress + "%";
            if (!box.querySelector<HTMLElement>(".lb-song-actions")) {
                const actions = e("div", "lb-song-actions");
                actions.append(
                    button("Cancel request", () => requireValue(requireValue(trackScope().jobActions).get(job.id)).cancel()),
                    button("Retry", () => requireValue(requireValue(trackScope().jobActions).get(job.id)).retry()),
                );
                box.append(actions);
            }
            const buttons = box.querySelectorAll<HTMLElement>(".lb-song-actions button"),
                active = ["queued", "running", "pending"].includes(job.state);
            requireValue(buttons[0]).hidden = !active;
            requireValue(buttons[1]).hidden = !job.failure && !job.error;
            if ((job.failure || job.error) && !trackScope().dismissedJobs?.has(job.id))
                showError({ message: job.failure?.message || job.error, details: job.failure, noticeKey: "job:" + job.id }, box, () =>
                    requireValue(requireValue(trackScope().jobActions).get(job.id)).retry(),
                );
            else box.querySelector<HTMLElement>(".lb-feedback")?.remove();
        }
    }
    function buildVersionsPanel() {
        const parent = context.popup?.querySelector<HTMLElement>(".lb-versions-panel");
        if (!parent) return;
        const revision = JSON.stringify([
            context.current?.lyrics?.hash,
            context.current?.state,
            context.current?.variants,
            context.current?.auxiliaryChoices,
            context.current?.preferences,
            context.current?.canDeleteVariants,
            context.current?.canSelect,
            context.current?.canGenerate,
            context.current?.previousSelection,
            context.current?.instrumental,
        ]);
        if (parent.dataset.revision === revision) return;
        parent.dataset.revision = revision;
        const focusedControl =
            document.activeElement instanceof HTMLElement && parent.contains(document.activeElement) ? document.activeElement : null;
        const generationNodes = new Map([...parent.querySelectorAll<HTMLElement>(".lb-generation")].map((node) => [node.dataset.kind, node]));
        trackScope().reusableVersionRows = new Map(
            [...parent.querySelectorAll<HTMLElement>(".lb-version-row")].map((row) => [
                requireValue(row.closest<HTMLElement>("[data-version-kind]")).dataset.versionKind + ":" + row.dataset.key,
                row,
            ]),
        );
        parent.replaceChildren();
        if (context.current?.state === "instrumental")
            parent.append(e("p", "lb-help", "Reported by " + (documentState().instrumental?.[0]?.source || "provider")));
        if (!context.current?.lyrics) {
            parent.append(
                e(
                    "p",
                    "",
                    context.current?.state === "instrumental"
                        ? "This version is instrumental. Translation and pronunciation are unavailable."
                        : "Lyrics are not ready yet. Display settings remain available.",
                ),
            );
            if (context.current?.canSelect) {
                const actions = e("div", "lb-song-actions");
                parent.append(actions);
                actions.append(
                    button("Find lyrics", () => openVersions()),
                    button(documentState().state === "instrumental" ? "Clear instrumental mark" : "Mark instrumental", () =>
                        mark(documentState().state === "instrumental"),
                    ),
                );
            }
            return;
        }
        const original = e("section", "lb-setting-group");
        original.dataset.songKind = "original";
        original.append(e("h3", "", "Original lyrics"));
        parent.append(original);
        original.append(
            e(
                "p",
                "lb-source",
                requireValue(documentState().lyrics).source +
                    " · " +
                    (requireValue(documentState().lyrics).wordTimed ? "Word timing" : "Line / plain lyrics"),
            ),
        );
        if (documentState().canSelect) {
            const originalActions = e("div", "lb-song-actions");
            original.append(originalActions);
            originalActions.append(button("Find versions", () => openVersions(), "lb-primary"));
            if (documentState().previousSelection)
                original.append(
                    e(
                        "p",
                        "lb-help",
                        "Previous selection: " +
                            (requireValue(documentState().previousSelection).lyrics?.source ||
                                requireValue(documentState().previousSelection).instrumental?.source ||
                                "No lyrics"),
                    ),
                );
            const advanced = e("details", "lb-task-surface");
            const advancedActions = e("div", "lb-song-actions");
            advanced.append(e("summary", "", "More actions"), advancedActions);
            advancedActions.append(
                button("Import lyrics", () => importLyrics(false)),
                button("Use existing Jellyfin lyrics", () => importLyrics(true)),
            );
            original.append(advanced);
            if (documentState().previousSelection)
                advancedActions.append(
                    button("Revert previous version", () =>
                        confirmation(advanced, "Restore the previous library selection for everyone?", () => action("revert"), "Revert selection"),
                    ),
                );
        }
        if (documentState().instrumental?.length)
            original.append(
                e(
                    "p",
                    "lb-provenance",
                    "Conflicting instrumental classification: " +
                        requireValue(documentState().instrumental)
                            .map((v) => v.source)
                            .join(", "),
                ),
            );
        const languages = originalLanguages();
        const japanese = languages.has("ja");
        const englishOnly = languages.size === 1 && languages.has("en");
        for (const kind of ["pronunciation", "translation"] as const) {
            if (kind === "pronunciation" && englishOnly) continue;
            const section = e("section", "lb-setting-group");
            section.dataset.songKind = kind;
            section.append(e("h3", "", kind === "pronunciation" ? "Pronunciation" : "Translation"));
            parent.append(section);
            const values = requireValue(documentState().lyrics)
                .lines.map((line) => auxiliary(line, kind, documentState().preferences))
                .filter(Boolean);
            section.append(
                e(
                    "p",
                    "lb-provenance",
                    values.length
                        ? "Displaying: " + [...new Set(values.map((v) => requireValue(v).provenance))].join(", ")
                        : "No rows available yet.",
                ),
            );
            languageVersions(section, kind);
            section.append(button("Choose " + kind + " from another source", () => openVersions(undefined, requireValue(kind))));
            const generationSignature = JSON.stringify([
                languages.size ? [...languages].sort() : [],
                documentState().canGenerate,
                requireValue(documentState().lyrics).hash,
            ]);
            const oldGeneration = generationNodes.get(kind);
            if (oldGeneration?.dataset.signature === generationSignature) {
                section.append(oldGeneration);
                drawJobDetails(oldGeneration, kind);
                continue;
            }
            const prepare = e("details", "lb-generation lb-task-surface");
            prepare.dataset.kind = kind;
            prepare.dataset.signature = generationSignature;
            prepare.append(e("summary", "", "Generate " + kind));
            section.append(prepare);
            drawJobDetails(prepare, kind);
            capabilities()
                .then(() => {
                    if (!prepare.isConnected) return;
                    const available = context.services.filter((service) =>
                        kind === "pronunciation"
                            ? service.pronunciation &&
                              (service.languages?.includes("*") ||
                                  !languages.size ||
                                  languages.has("und") ||
                                  [...languages].some((language) => service.languages?.some((supported) => supported.split("-")[0] === language)))
                            : service.translation !== false,
                    );
                    const choices: [string, string][] = [
                        ...(kind === "pronunciation" && japanese ? [["Kawazu", "Local (Kawazu)"] as [string, string]] : []),
                        ...(documentState().canGenerate ? available.map((service) => [service.service, service.service] as [string, string]) : []),
                    ];
                    if (!choices.length) {
                        prepare.append(e("p", "lb-help", "External generation is unavailable for your account."));
                        return;
                    }
                    const advanced = e("details", "lb-generation-advanced");
                    advanced.append(e("summary", "", "Advanced generation settings"));
                    const numbers: Record<string, [string, number, number]> = {
                        timeoutSeconds: ["HTTP timeout (seconds)", 5, 600],
                        contextBefore: ["Lines before", 0, 10],
                        contextAfter: ["Lines after", 0, 10],
                    };
                    for (const [key, [label, min, max]] of Object.entries(numbers)) {
                        const input = e("input");
                        input.type = "number";
                        input.min = String(min);
                        input.max = String(max);
                        input.placeholder = "Use service default";
                        input.dataset.generationKey = key;
                        field(advanced, label, input);
                    }
                    const thinking = select(
                        advanced,
                        "Thinking level",
                        "inherit",
                        [
                            ["inherit", "Use service default"],
                            ["", "Provider default"],
                            ...["none", "minimal", "low", "medium", "high", "xhigh"].map((v) => [v, v] as const),
                        ],
                        () => {},
                    );
                    thinking.dataset.generationKey = "reasoningEffort";
                    const showAdvanced = (value: string) => {
                        advanced.hidden = value === "Kawazu";
                        requireValue(thinking.closest<HTMLElement>(".lb-field")).hidden = value !== "AI";
                        for (const input of advanced.querySelectorAll<HTMLElement>('[data-generation-key^="context"]'))
                            requireValue(input.closest<HTMLElement>(".lb-field")).hidden = value === "AI" || kind !== "translation";
                    };
                    const method = select(prepare, "Generation method", requireValue(choices[0])[0], choices, showAdvanced);
                    showAdvanced(requireValue(choices[0])[0]);
                    prepare.append(advanced);
                    prepare.append(
                        button(
                            kind === "pronunciation" ? "Generate pronunciation" : "Generate translation",
                            async () => {
                                if (method.value !== "Kawazu") return generate(kind, method.value, prepare, true);
                                try {
                                    const target = context.scope;
                                    await api("items/" + requireValue(target).itemId + "/pronunciation", "POST", {
                                        hash: requireValue(documentState().lyrics).hash,
                                        includeSupplied: true,
                                        retry: true,
                                    });
                                    if (context.scope !== target) return;
                                    await refreshSong();
                                    status(
                                        documentState().pronunciation?.state === "complete"
                                            ? "Local pronunciation version ready"
                                            : "Generating local pronunciation…",
                                        false,
                                        documentState().pronunciation?.state === "complete" ? 4000 : 0,
                                    );
                                } catch (error) {
                                    showError(error, prepare);
                                }
                            },
                            "lb-primary",
                        ),
                    );
                    prepare.append(
                        e(
                            "small",
                            "lb-help",
                            kind === "pronunciation"
                                ? japanese
                                    ? "Kawazu runs locally; Google and AI receive the song text."
                                    : "Google and AI receive the song text."
                                : "Sends song text to this service.",
                        ),
                    );
                    prepare.querySelectorAll<HTMLElement>(":scope > .lb-job-details").forEach((node) => prepare.append(node));
                })
                .catch((error) => showError(error, prepare));
        }
        if (focusedControl?.isConnected) focusedControl.focus({ preventScroll: true });
    }

    return { languageVersions, stopLanguagePlayback, drawJobDetails, buildVersionsPanel };
}
