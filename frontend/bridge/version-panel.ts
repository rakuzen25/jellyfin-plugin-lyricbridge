import { requireValue } from "../shared/invariants.ts";
import type { LyricLine, RichLyrics } from "../shared/lyrics.ts";
import type {} from "../shared/runtime.ts";
import { rowLanguage, translationLanguageMatches, translationScript } from "./auxiliary.ts";
import type { BridgeDocument, ServiceCapability, TrackScope } from "./contracts.ts";
import { parseDocument } from "./responses.ts";
import { versionRow, updateVersionRow } from "./version-rows.ts";
import { button, disclosure, e, field, section, select } from "./controls.ts";
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
    importLyrics: (existing: boolean) => Promise<void>;
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
        importLyrics,
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
        const browsing = requireValue(trackScope().versionBrowsing);
        if (browsing[kind] === undefined || (browsing[kind] !== null && !all.some((v) => v.key === browsing[kind]))) browsing[kind] = active();
        const updateActive = () =>
            (context.popup?.querySelector<HTMLElement>('[data-version-kind="' + kind + '"]') || area)
                .querySelectorAll<HTMLElement>(".lb-version-row")
                .forEach((row) => updateVersionRow(row, row.dataset.key === active(), row.dataset.key === browsing[kind]));
        const expand = (key: string) => {
            browsing[kind] = browsing[kind] === key ? null : key;
            updateActive();
        };
        for (const version of all) {
            const signature = JSON.stringify([version, p, documentState().canDeleteVariants]);
            const existing = trackScope().reusableVersionRows?.get(kind + ":" + version.key);
            if (existing?.dataset.versionSignature === signature) {
                area.append(existing);
                continue;
            }
            const { row, content } = versionRow({
                key: version.key,
                kind,
                name: version.title,
                description: version.language
                    ? (languageChoices.find((l) => l[0] === version.language)?.[1] || version.language) +
                      " · " +
                      (version.originType === "supplied" ? "Supplied" : version.originType === "local" ? "Local" : "Generated")
                    : "Selection policy",
                details: [
                    version.key === "auto" || version.key === "provider"
                        ? version.description
                        : [
                              version.model,
                              version.createdAt ? new Date(version.createdAt).toLocaleDateString() : null,
                              version.reasoningEffort ? "Thinking: " + version.reasoningEffort : null,
                          ]
                              .filter(Boolean)
                              .join(" · "),
                ],
                toggle: () => expand(version.key),
            });
            row.dataset.versionSignature = signature;
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
            const previewButton = button(
                "Preview",
                () => {
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
                        button(
                            "Preview with playback",
                            () => {
                                stopLanguagePlayback();
                                context.languagePlayback = { scope: context.scope, input: previewButton };
                                startPlaybackPreview(requireValue(doc()), "Previewing " + kind + " · " + version.title, [
                                    button("Return to versions", stopLanguagePlayback, "", { icon: "back" }),
                                ]);
                                requireValue(context.popup).hidden = true;
                            },
                            "",
                            { icon: "preview" },
                        ),
                    );
                },
                "",
                { icon: "preview" },
            );
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
                { icon: "check" },
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
                    { icon: "trash" },
                );
                actions.append(remove);
            }
            content.append(actions, feedback, preview);
            area.append(row);
        }
        updateActive();
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
        parent = parent.querySelector<HTMLElement>(":scope > .lb-disclosure-content") || parent;
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
                job.request.service + " · " + job.state + " · " + job.progress + "%" + (job.outputDeleted ? " · Output deleted" : "");
            if (!box.querySelector<HTMLElement>(".lb-song-actions")) {
                const actions = e("div", "lb-song-actions");
                actions.append(
                    button("Cancel request", () => requireValue(requireValue(trackScope().jobActions).get(job.id)).cancel(), "", { icon: "close" }),
                    button("Retry", () => requireValue(requireValue(trackScope().jobActions).get(job.id)).retry(), "", { icon: "retry" }),
                );
                box.append(actions);
            }
            const buttons = box.querySelectorAll<HTMLElement>(".lb-song-actions button"),
                active = ["queued", "running", "pending"].includes(job.state);
            requireValue(buttons[0]).hidden = !active;
            requireValue(buttons[1]).hidden = job.outputDeleted === true || (!job.failure && !job.error);
            if (!job.outputDeleted && (job.failure || job.error) && !trackScope().dismissedJobs?.has(job.id))
                showError({ message: job.failure?.message || job.error, details: job.failure, noticeKey: "job:" + job.id }, box, () =>
                    requireValue(requireValue(trackScope().jobActions).get(job.id)).retry(),
                );
            else box.querySelector<HTMLElement>(".lb-feedback")?.remove();
        }
    }
    let originalRequest = 0;
    function originalVersions(parent: HTMLElement) {
        const current = documentState().lyrics;
        const versions = (documentState().savedOriginals || []).map((v) => ({ ...v, currentOnly: false }));
        if (current && !versions.some((v) => v.hash === current.hash))
            versions.unshift({
                itemId: trackScope().itemId,
                hash: current.hash,
                source: current.source || "Jellyfin lyrics",
                providerId: current.providerId || "",
                title: current.title || "",
                artist: current.artist || "",
                wordTimed: current.wordTimed ?? current.lines.some((l) => l.cues?.length),
                savedAt: "",
                revision: 0,
                currentOnly: true,
            });
        const area = e("div", "lb-language-versions");
        area.dataset.versionKind = "original";
        parent.append(area);
        if (!versions.length) area.append(e("p", "lb-help", "No saved originals yet."));
        trackScope().versionBrowsing ??= {};
        const browsing = requireValue(trackScope().versionBrowsing);
        if (browsing.original === undefined || (browsing.original !== null && !versions.some((v) => v.hash === browsing.original)))
            browsing.original = current?.hash ?? versions[0]?.hash ?? null;
        const update = () =>
            (context.popup?.querySelector<HTMLElement>('[data-version-kind="original"]') || area)
                .querySelectorAll<HTMLElement>(".lb-version-row")
                .forEach((row) => updateVersionRow(row, row.dataset.key === context.current?.lyrics?.hash, row.dataset.key === browsing.original));
        for (const version of versions) {
            const signature = JSON.stringify([version, documentState().preferences, documentState().canSelect, documentState().canDeleteOriginals]);
            const reused = trackScope().reusableVersionRows?.get("original:" + version.hash);
            if (reused?.dataset.versionSignature === signature) {
                area.append(reused);
                continue;
            }
            const { row, content } = versionRow({
                key: version.hash,
                kind: "original",
                name: version.source,
                description:
                    (version.currentOnly ? "Currently supplied" : version.source === "Imported" ? "Imported original" : "Saved original") +
                    " · " +
                    (version.wordTimed ? "Word timing" : "Line / plain lyrics"),
                details: [
                    version.providerId ? "Provider ID: " + version.providerId : "",
                    [version.title, version.artist].filter(Boolean).join(" · "),
                    version.savedAt ? "Saved: " + new Date(version.savedAt).toLocaleDateString() : "Import to save this original.",
                ],
                toggle: () => {
                    browsing.original = browsing.original === version.hash ? null : version.hash;
                    update();
                },
            });
            row.dataset.hash = version.hash;
            row.dataset.versionSignature = signature;
            const target = context.scope;
            const path = "items/" + trackScope().itemId + "/originals/" + encodeURIComponent(version.hash);
            const actions = e("div", "lb-song-actions"),
                feedback = e("p", "lb-version-status"),
                preview = e("div", "lb-version-preview");
            feedback.setAttribute("role", "status");
            preview.hidden = true;
            const mutate = async (operation: "select" | "delete") => {
                ++originalRequest;
                try {
                    await api(
                        path + (operation === "select" ? "/select" : ""),
                        operation === "select" ? "POST" : "DELETE",
                        operation === "delete" ? { confirmed: true, revision: version.revision } : undefined,
                        target?.controller.signal,
                    );
                    if (context.scope !== target || target?.controller.signal.aborted || !row.isConnected) return;
                    stopLanguagePlayback();
                    closeSearch(false);
                    if (operation === "select") browsing.original = version.hash;
                    await refreshSong(true);
                } catch (error) {
                    if (context.scope === target && !target?.controller.signal.aborted && row.isConnected) showError(error, content);
                }
            };
            const previewButton = button(
                "Preview",
                async () => {
                    if (!preview.hidden) {
                        preview.hidden = true;
                        previewButton.setAttribute("aria-expanded", "false");
                        return;
                    }
                    const popup = context.popup,
                        request = ++originalRequest;
                    previewButton.disabled = true;
                    try {
                        const doc = version.currentOnly
                            ? { ...documentState(), canGenerate: false }
                            : parseDocument(await api(path + "/preview", "GET", undefined, target?.controller.signal), documentState().preferences);
                        if (
                            request !== originalRequest ||
                            context.scope !== target ||
                            target?.controller.signal.aborted ||
                            context.popup !== popup ||
                            !row.isConnected
                        )
                            return;
                        preview.replaceChildren();
                        preview.hidden = false;
                        previewButton.setAttribute("aria-expanded", "true");
                        for (const line of richLines(doc.lyrics).slice(0, 3)) {
                            const block = e("div", "lb-preview-block");
                            block.append(e("strong", "", line.text));
                            preview.append(block);
                        }
                        preview.append(
                            button(
                                "Preview with playback",
                                () => {
                                    if (context.scope !== target || target?.controller.signal.aborted || context.popup !== popup) return;
                                    stopLanguagePlayback();
                                    context.languagePlayback = { scope: target, input: previewButton };
                                    startPlaybackPreview(doc, "Previewing original · " + version.source, [
                                        button("Return to versions", stopLanguagePlayback, "", { icon: "back" }),
                                    ]);
                                    if (popup) popup.hidden = true;
                                },
                                "",
                                { icon: "preview" },
                            ),
                        );
                    } catch (error) {
                        if (request === originalRequest && context.scope === target && !target?.controller.signal.aborted && row.isConnected)
                            showError(error, content);
                    } finally {
                        previewButton.disabled = false;
                    }
                },
                "",
                { icon: "preview" },
            );
            previewButton.setAttribute("aria-expanded", "false");
            actions.append(previewButton);
            if (documentState().canSelect) actions.append(button("Use", () => mutate("select"), "lb-use-version", { icon: "check" }));
            if (documentState().canDeleteOriginals && !version.currentOnly)
                actions.append(
                    button(
                        "Delete",
                        () =>
                            confirmation(
                                content,
                                "Delete this song’s saved original? If this is current, another saved original is selected when available. Matching previous selections are cleared and affected work is cancelled. Dependent managed lyrics, translations, pronunciation, choices and timing are removed only when other songs or compositions do not require them. Job history is kept. Media and external lyric files are never deleted.",
                                () => mutate("delete"),
                                "Delete saved original",
                            ),
                        "lb-danger",
                        { icon: "trash" },
                    ),
                );
            content.append(actions, feedback, preview);
            area.append(row);
        }
        update();
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
            context.current?.savedOriginals,
            context.current?.canDeleteOriginals,
            context.current?.instrumental,
        ]);
        if (parent.dataset.revision === revision) return;
        parent.dataset.revision = revision;
        const focusedControl =
            document.activeElement instanceof HTMLElement && parent.contains(document.activeElement) ? document.activeElement : null;
        const focusedRow = focusedControl?.closest<HTMLElement>(".lb-version-row");
        const focusIdentity = focusedRow
            ? {
                  kind: focusedRow.closest<HTMLElement>("[data-version-kind]")?.dataset.versionKind,
                  key: focusedRow.dataset.key,
                  buttonIndex: [...focusedRow.querySelectorAll("button")].indexOf(focusedControl as HTMLButtonElement),
              }
            : null;
        const generationNodes = new Map([...parent.querySelectorAll<HTMLElement>(".lb-generation")].map((node) => [node.dataset.kind, node]));
        trackScope().reusableVersionRows = new Map(
            [...parent.querySelectorAll<HTMLElement>("[data-version-kind] .lb-version-row")].map((row) => [
                requireValue(row.closest<HTMLElement>("[data-version-kind]")).dataset.versionKind + ":" + row.dataset.key,
                row,
            ]),
        );
        parent.replaceChildren();
        if (context.current?.state === "instrumental")
            parent.append(e("p", "lb-help", "Reported by " + (documentState().instrumental?.[0]?.source || "provider")));
        const original = section("Original lyrics");
        original.dataset.songKind = "original";
        const currentOriginal = documentState().lyrics;
        original.append(
            e(
                "p",
                "lb-displaying",
                "Displaying: " +
                    (currentOriginal
                        ? (currentOriginal.source || "Jellyfin lyrics") +
                          " · " +
                          ((currentOriginal.wordTimed ?? currentOriginal.lines.some((l) => l.cues?.length)) ? "Word timing" : "Line / plain lyrics")
                        : "None"),
            ),
        );
        if (!currentOriginal)
            original.append(
                e("p", "lb-help", documentState().state === "instrumental" ? "This version is instrumental." : "Lyrics are not ready yet."),
            );
        originalVersions(original);
        const originalActions = e("div", "lb-section-actions");
        originalActions.append(button("Search versions", () => openVersions(), "", { icon: "search" }));
        if (documentState().canSelect)
            originalActions.append(
                button("Import lyrics", () => importLyrics(false), "", { icon: "import" }),
                button("Use Jellyfin lyrics", () => importLyrics(true), "", { icon: "library" }),
            );
        original.append(originalActions);
        if (documentState().instrumental?.length)
            original.append(
                e(
                    "p",
                    "lb-help",
                    "Instrumental classification: " +
                        requireValue(documentState().instrumental)
                            .map((v) => v.source)
                            .join(", "),
                ),
            );
        parent.append(original);
        if (!currentOriginal) return;
        const languages = originalLanguages();
        const japanese = languages.has("ja");
        const englishOnly = languages.size === 1 && languages.has("en");
        for (const kind of ["pronunciation", "translation"] as const) {
            if (kind === "pronunciation" && englishOnly) continue;
            const group = section(kind === "pronunciation" ? "Pronunciation" : "Translation");
            group.dataset.songKind = kind;
            parent.append(group);
            const values = requireValue(documentState().lyrics)
                .lines.map((line) => auxiliary(line, kind, documentState().preferences))
                .filter(Boolean);
            group.append(
                e(
                    "p",
                    "lb-displaying",
                    values.length ? "Displaying: " + [...new Set(values.map((v) => requireValue(v).provenance))].join(", ") : "Displaying: None",
                ),
            );
            languageVersions(group, kind);
            const sectionActions = e("div", "lb-section-actions");
            sectionActions.append(button("Search versions", () => openVersions(undefined, kind), "", { icon: "search" }));
            group.append(sectionActions);
            if (!documentState().canGenerate && !(kind === "pronunciation" && japanese)) continue;
            const generateAction = button(
                "Generate " + kind,
                () => {
                    const prepare = group.querySelector<HTMLDetailsElement>(".lb-generation");
                    if (prepare) {
                        prepare.open = !prepare.open;
                        if (prepare.open) prepare.scrollIntoView({ block: "nearest" });
                    }
                },
                "",
                { icon: "generate" },
            );
            const generationSignature = JSON.stringify([
                languages.size ? [...languages].sort() : [],
                documentState().canGenerate,
                requireValue(documentState().lyrics).hash,
            ]);
            const oldGeneration = generationNodes.get(kind);
            if (oldGeneration?.dataset.signature === generationSignature) {
                sectionActions.append(generateAction);
                group.append(oldGeneration);
                drawJobDetails(oldGeneration, kind);
                continue;
            }
            const { root: prepare, content: prepareBody } = disclosure("Generate " + kind, "lb-generation");
            prepare.dataset.kind = kind;
            prepare.dataset.signature = generationSignature;
            sectionActions.append(generateAction);
            group.append(prepare);
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
                        prepareBody.append(e("p", "lb-help", "External generation is unavailable for your account."));
                        return;
                    }
                    const { root: advanced, content: advancedBody } = disclosure("Advanced generation settings", "lb-generation-advanced", false);
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
                        field(advancedBody, label, input);
                    }
                    const thinking = select(
                        advancedBody,
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
                    const method = select(prepareBody, "Generation method", requireValue(choices[0])[0], choices, showAdvanced);
                    showAdvanced(requireValue(choices[0])[0]);
                    prepareBody.append(advanced);
                    prepareBody.append(
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
                            { icon: "generate" },
                        ),
                    );
                    prepareBody.append(
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
                    const focused =
                        document.activeElement instanceof HTMLElement && prepare.contains(document.activeElement) ? document.activeElement : null;
                    prepareBody.querySelectorAll<HTMLElement>(":scope > .lb-job-details").forEach((node) => prepareBody.append(node));
                    if (focused?.isConnected) focused.focus({ preventScroll: true });
                })
                .catch((error) => showError(error, prepare));
        }
        if (focusedControl?.isConnected) focusedControl.focus({ preventScroll: true });
        else if (focusIdentity) {
            const row = [...parent.querySelectorAll<HTMLElement>(".lb-version-row")].find(
                (n) =>
                    n.dataset.key === focusIdentity.key && n.closest<HTMLElement>("[data-version-kind]")?.dataset.versionKind === focusIdentity.kind,
            );
            const control = row?.querySelectorAll<HTMLButtonElement>("button")[focusIdentity.buttonIndex];
            if (control && !control.closest("[hidden]")) control.focus({ preventScroll: true });
            else row?.querySelector<HTMLButtonElement>(".lb-version-toggle")?.focus({ preventScroll: true });
        }
    }

    return { languageVersions, stopLanguagePlayback, drawJobDetails, buildVersionsPanel };
}
