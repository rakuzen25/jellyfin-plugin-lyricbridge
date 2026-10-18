import type { LyricLine, RichLyrics } from "../../contracts/lyrics.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { PlaybackPreviewRequest } from "../preview/playback-preview.ts";

import type { BridgeDocument, ServiceCapability } from "../../contracts/bridge.ts";
import type { AuxiliaryKind, Preferences, Variant } from "../../contracts/preferences.ts";
import { effectiveAuxiliaryChoice, hasEmbeddedVersion, rowLanguage, translationLanguageMatches, translationScript } from "../lyrics/auxiliary.ts";
import type { TrackScope } from "../session/contracts.ts";
import { parseDocument } from "../transport/responses.ts";
import { button, disclosure, e, field, section, select, setGenerationPanelOpen } from "../ui/controls.ts";
import { updateVersionRow, versionRow } from "./version-rows.ts";
interface Context {
    popup: HTMLElement | null;
    scope: TrackScope | null;
    current: BridgeDocument | null;
    services: ServiceCapability[];
}
interface Dependencies {
    mark: (clear: boolean) => Promise<void>;
    reject: () => Promise<void>;
    context: Context;
    documentState: () => Readonly<BridgeDocument>;
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
    startPlaybackPreview: (request: PlaybackPreviewRequest) => void;
    stopPlaybackPreview(panel: HTMLElement | null): void;
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: (() => void) | undefined) => void;
    api: (path: string, method?: string, body?: unknown, signal?: AbortSignal | null | undefined) => Promise<unknown>;
    refreshSong: (force?: boolean) => Promise<void>;
    showError: (cause: unknown, parent?: HTMLElement | null | undefined, retryAction?: () => unknown) => void;
    confirmation: (parent: HTMLElement, message: string, action: () => unknown, label?: string, trigger?: HTMLElement | undefined) => void;
    status: (message: string, error?: boolean, ttl?: number, operation?: string) => void;
    closeSearch: (restore?: boolean) => void;
    openVersions: (better?: RichLyrics | null | undefined, mixKind?: AuxiliaryKind | undefined) => Promise<void>;
    importLyrics: (existing: boolean) => Promise<void>;
    transcribeAudio: () => void;
    exportLyrics: () => void;
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
        transcribeAudio,
        capabilities,
        generate,
        mark,
        reject,
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
            ...(hasEmbeddedVersion(documentState().lyrics, kind, p.translationLanguage)
                ? [
                      {
                          key: "provider",
                          hash: documentState().lyrics?.hash,
                          title: documentState().lyrics?.source || "Original lyrics",
                          description:
                              !documentState().lyrics?.source || ["Local", "Imported"].includes(documentState().lyrics?.source || "")
                                  ? "Supplied"
                                  : "Provider supplied",
                      },
                  ]
                : []),
            ...versions.map((v) => ({
                ...v,
                title: v.service,
                description:
                    (languageChoices.find((l) => l[0] === v.language)?.[1] || v.language) +
                    " · " +
                    (v.originType === "supplied" ? "Supplied" : v.originType === "local" ? "Local" : "Generated"),
            })),
        ];
        const active = () => effectiveAuxiliaryChoice(documentState(), kind, p);
        trackScope().versionBrowsing ??= {};
        const browsing = requireValue(trackScope().versionBrowsing);
        if (browsing[kind] === undefined || (browsing[kind] !== null && !all.some((v) => v.key === browsing[kind]))) browsing[kind] = active();
        const updateActive = () => {
            const used = new Set(
                (documentState().lyrics?.lines || [])
                    .flatMap((line) => (line.background ? [line, line.background] : [line]))
                    .map((line) => auxiliary(line, kind, documentState().preferences)?.key)
                    .filter(Boolean),
            );
            (context.popup?.querySelector<HTMLElement>('[data-version-kind="' + kind + '"]') || area)
                .querySelectorAll<HTMLElement>(".lb-version-row")
                .forEach((row) => {
                    const selected = row.dataset.key === active();
                    const policyUse = !selected && row.dataset.key !== "auto" && used.has(row.dataset.key) ? "In use · Automatic" : undefined;
                    updateVersionRow(row, selected, row.dataset.key === browsing[kind], policyUse);
                    const remove = row.querySelector<HTMLButtonElement>(".lb-delete-version");
                    const explanation = row.querySelector<HTMLElement>(".lb-delete-reason");
                    const reason =
                        row.dataset.deleteRestriction || (selected || !!policyUse ? "Switch to another version or policy before deleting." : "");
                    if (remove) {
                        remove.disabled = !!reason;
                        remove.title = reason;
                    }
                    if (explanation) {
                        explanation.textContent = reason;
                        explanation.hidden = !reason;
                    }
                });
        };
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
                    : version.key === "provider"
                      ? version.description
                      : "Selection policy",
                details:
                    version.key === "auto"
                        ? [version.description]
                        : version.key === "provider"
                          ? [
                                documentState().lyrics?.providerId ? "Provider ID: " + documentState().lyrics?.providerId : "",
                                kind === "translation"
                                    ? languageChoices.find((l) => l[0] === p.translationLanguage)?.[1] || p.translationLanguage
                                    : "Pronunciation",
                            ]
                          : [
                                version.origin?.providerId ? "Provider ID: " + version.origin.providerId : "",
                                version.model ? "Model: " + version.model : "",
                                version.reasoningEffort ? "Thinking: " + version.reasoningEffort : "",
                                version.createdAt ? "Saved: " + new Date(version.createdAt).toLocaleDateString() : "",
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
                                startPlaybackPreview({
                                    document: requireValue(doc()),
                                    description: "Previewing " + kind + " · " + version.title,
                                    returnLabel: "Return to versions",
                                    panel: requireValue(context.popup),
                                });
                            },
                            "",
                            { icon: "preview" },
                        ),
                    );
                },
                "",
                { icon: "preview" },
            );
            previewButton.classList.add("lb-preview-version");
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
            if (!["auto", "provider"].includes(version.key)) {
                row.dataset.deleteRestriction = !documentState().canDeleteVariants
                    ? "Only administrators can delete saved versions."
                    : version.service === "Kawazu"
                      ? "Managed locally by Kawazu. Change the pronunciation policy instead of deleting this version."
                      : "";
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
                    "lb-danger lb-delete-version",
                    { icon: "trash" },
                );
                const reason = e("p", "lb-help lb-delete-reason");
                actions.append(remove);
                content.append(reason);
            }
            content.append(actions, feedback, preview);
            area.append(row);
        }
        updateActive();
    }
    function stopLanguagePlayback() {
        dependencies.stopPlaybackPreview(context.popup);
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
        if (!versions.length) area.append(e("p", "lb-help", "No saved originals."));
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
                name: version.source === "Local" ? "Jellyfin lyrics" : version.source,
                description:
                    (version.currentOnly
                        ? version.source === "Local"
                            ? "Currently supplied by Jellyfin"
                            : "Current version"
                        : version.autoSaved
                          ? "Loaded from Jellyfin"
                          : version.source === "Imported"
                            ? "Imported original"
                            : "Saved original") +
                    " · " +
                    (version.wordTimed ? "Word timing" : "Line / plain lyrics"),
                details: [
                    version.providerId ? "Provider ID: " + version.providerId : "",
                    [version.title, version.artist].filter(Boolean).join(" · "),
                    version.savedAt ? "Saved: " + new Date(version.savedAt).toLocaleDateString() : "",
                ],
                toggle: () => {
                    browsing.original = browsing.original === version.hash ? null : version.hash;
                    update();
                },
            });
            row.dataset.hash = version.hash;
            row.dataset.autoSaved = String(!!version.autoSaved);
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
                    if (context.scope === target && !target?.controller.signal.aborted && row.isConnected) {
                        if (operation === "delete") throw error;
                        showError(error, content);
                    }
                }
            };
            const previewButton = button(
                "Preview",
                async () => {
                    if (!preview.hidden) {
                        preview.hidden = true;
                        previewButton.classList.add("lb-preview-version");
                        previewButton.setAttribute("aria-expanded", "false");
                        return;
                    }
                    const popup = context.popup,
                        request = ++originalRequest;
                    previewButton.dataset.loading = "true";
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
                                    startPlaybackPreview({
                                        document: doc,
                                        description: "Previewing original · " + version.source,
                                        returnLabel: "Return to versions",
                                        panel: requireValue(popup),
                                    });
                                },
                                "",
                                { icon: "preview" },
                            ),
                        );
                    } catch (error) {
                        if (request === originalRequest && context.scope === target && !target?.controller.signal.aborted && row.isConnected)
                            showError(error, content);
                    } finally {
                        delete previewButton.dataset.loading;
                        previewButton.disabled = row.dataset.active === "true";
                    }
                },
                "",
                { icon: "preview" },
            );
            previewButton.classList.add("lb-preview-version");
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
                                "Delete this saved original and its timing? Affected jobs are cancelled. If selected, the newest remaining original is used. Shared content and job history are kept. Media files are untouched.",
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
                e("p", "lb-help", documentState().state === "instrumental" ? "This version is instrumental." : "No original lyrics selected."),
            );
        originalVersions(original);
        const originalActions = e("div", "lb-section-actions");
        originalActions.append(
            button("Search versions", () => openVersions(), "", { icon: "search" }),
            button("Transcribe audio", transcribeAudio, "", { icon: "speech" }),
        );
        if (documentState().canSelect)
            originalActions.append(
                button("Import lyrics", () => importLyrics(false), "", { icon: "import" }),
                button("Use Jellyfin lyrics", () => importLyrics(true), "", { icon: "library" }),
            );
        if (currentOriginal) originalActions.append(button("Export lyrics", dependencies.exportLyrics, "", { icon: "export" }));
        original.append(originalActions, e("div", "lb-original-feedback"));
        if (documentState().canSelect) {
            const classification = e("div", "lb-version-classification");
            classification.append(e("p", "lb-help", "Classification · affects everyone"));
            const actions = e("div", "lb-section-actions");
            const rejectButton = button(
                "Remove lyrics",
                () =>
                    confirmation(
                        classification,
                        "Remove the current lyric selection and pause automatic matching? Saved versions remain available. Resume with Search again or a manual selection.",
                        reject,
                        "Remove lyrics",
                        rejectButton,
                    ),
                "",
                { icon: "warning" },
            );
            rejectButton.disabled = !currentOriginal;
            const markButton = button(
                documentState().state === "instrumental" ? "Clear instrumental mark" : "Mark instrumental",
                () =>
                    confirmation(
                        classification,
                        "Change the instrumental classification for everyone?",
                        () => mark(documentState().state === "instrumental"),
                        "Confirm classification",
                        markButton,
                    ),
                "",
                { icon: "music" },
            );
            actions.append(rejectButton, markButton);
            classification.append(actions);
            original.append(classification);
        }

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
                    const prepare = group.querySelector<HTMLElement>(".lb-generation");
                    if (!prepare) return;
                    setGenerationPanelOpen(prepare, Boolean(prepare.hidden));
                    if (!prepare.hidden) {
                        prepare.scrollIntoView({ block: "nearest" });
                        prepare.querySelector<HTMLElement>("select, input, button")?.focus({ preventScroll: true });
                    }
                },
                "lb-generation-trigger",
                { icon: "generate" },
            );
            generateAction.setAttribute("aria-controls", "lb-generation-" + kind);
            generateAction.setAttribute("aria-expanded", "false");
            sectionActions.append(generateAction);
            const generationSignature = JSON.stringify([
                languages.size ? [...languages].sort() : [],
                documentState().canGenerate,
                requireValue(documentState().lyrics).hash,
            ]);
            const oldGeneration = generationNodes.get(kind);
            if (oldGeneration?.dataset.signature === generationSignature) {
                group.append(oldGeneration);
                setGenerationPanelOpen(oldGeneration, !oldGeneration.hidden);
                drawJobDetails(oldGeneration, kind);
                continue;
            }
            const prepare = e("div", "lb-generation");
            prepare.id = "lb-generation-" + kind;
            prepare.hidden = true;
            prepare.setAttribute("role", "group");
            prepare.setAttribute("aria-label", kind + " generation settings");
            const prepareBody = e("div", "lb-disclosure-content");
            prepare.append(prepareBody);
            prepare.dataset.kind = kind;
            prepare.dataset.signature = generationSignature;
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
                    const choices: [string, string][] = available
                        .filter((s) => (s.service === "Kawazu" ? kind === "pronunciation" && japanese : documentState().canGenerate))
                        .map((s) => [s.optionId || s.service, s.name || (s.service === "Kawazu" ? "Local (Kawazu)" : s.service)]);
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
                        const provider = available.find((s) => (s.optionId || s.service) === value)?.service || value;
                        advanced.hidden = !value || provider === "Kawazu";
                        requireValue(thinking.closest<HTMLElement>(".lb-field")).hidden = provider !== "AI";
                        for (const input of advanced.querySelectorAll<HTMLElement>('[data-generation-key^="context"]'))
                            requireValue(input.closest<HTMLElement>(".lb-field")).hidden = provider === "AI" || kind !== "translation";
                    };
                    const method = select(prepareBody, "Generation method", "", [["", "Choose a service…"], ...choices], (value) => {
                        showAdvanced(value);
                        start.disabled = !value;
                    });
                    showAdvanced("");
                    prepareBody.append(advanced);
                    const generationActions = e("div", "lb-section-actions");
                    const start = button(
                        "Start generation",
                        async () => {
                            if (!method.value) return;
                            const selected = available.find((s) => (s.optionId || s.service) === method.value);
                            if ((selected?.service || method.value) !== "Kawazu") {
                                const chosen = method.value;
                                start.disabled = true;
                                method.disabled = true;
                                try {
                                    await generate(kind, chosen, prepare, true);
                                } finally {
                                    method.value = "";
                                    method.disabled = false;
                                    showAdvanced("");
                                }
                                return;
                            }
                            method.value = "";
                            start.disabled = true;
                            showAdvanced("");
                            try {
                                const target = context.scope;
                                await api("items/" + requireValue(target).itemId + "/pronunciation", "POST", {
                                    hash: requireValue(documentState().lyrics).hash,
                                    includeSupplied: true,
                                    retry: true,
                                    ...(selected?.optionId ? { optionId: selected.optionId } : {}),
                                });
                                if (context.scope !== target) return;
                                await refreshSong();
                                status(
                                    documentState().pronunciation?.state === "complete"
                                        ? "Local pronunciation version ready"
                                        : "Generating local pronunciation…",
                                    false,
                                    documentState().pronunciation?.state === "complete" ? 4000 : 0,
                                    "local-pronunciation",
                                );
                            } catch (error) {
                                showError(error, prepare);
                            }
                        },
                        "lb-primary",
                        { icon: "generate" },
                    );
                    start.disabled = true;
                    generationActions.append(start);
                    generationActions.append(
                        button("Cancel", () => {
                            setGenerationPanelOpen(prepare, false);
                            prepare.parentElement?.querySelector<HTMLButtonElement>(`[aria-controls="${prepare.id}"]`)?.focus();
                        }),
                    );
                    prepareBody.append(generationActions);
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
