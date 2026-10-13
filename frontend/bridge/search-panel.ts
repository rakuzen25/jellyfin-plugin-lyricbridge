import { requireValue } from "../shared/invariants.ts";
import type { LyricLine, RichLyrics } from "../shared/lyrics.ts";
import type {} from "../shared/runtime.ts";
import { BridgeRequestError, createApi } from "./api.ts";
import type { BridgeDocument, SourceCapability, TrackScope } from "./contracts.ts";
import { button, disclosure, e, field, select } from "./controls.ts";
import type { AuxiliaryKind, Preferences } from "./models.ts";
import { PreviewSession } from "./preview-session.ts";
import { parseDocument } from "./responses.ts";
import type { Candidate, MatchAssessment, SearchImprovement, SearchQuery, SearchResults } from "./search-models.ts";
import { parseSearchAdmission, parseSearchResults, rankCandidates } from "./search-models.ts";
import { SearchSession } from "./search-session.ts";
interface Context {
    scope: TrackScope | null;
    searchPopup: HTMLElement | null;
    current: BridgeDocument | null;
    sources: SourceCapability[];
    searchUsageRefresh: (() => void) | null;
    searchPlaybackBar: HTMLElement | null;
    lastRequest: Request | null;
    searchSession: SearchSession<SearchQuery, SearchResults> | null;
}
interface Dependencies {
    responseOrder: symbol;
    context: Context;
    closePopup: () => void;
    closeSearch: (restore?: boolean) => void;
    documentState: () => BridgeDocument;
    api: (path: string, method?: string, body?: unknown, signal?: AbortSignal | null | undefined) => Promise<unknown>;
    playbackPreview: PreviewSession<TrackScope, BridgeDocument>;
    refreshSong: (force?: boolean) => Promise<void>;
    updatePanelBounds: () => void;
    metrics: { decorations: number; requests: number; stale: number; searchRowUpdates: number; searchSorts: number; maxSearchPaintMs: number };
    defaults: Preferences;
    buildMixPreview: (parent: HTMLElement, donor: BridgeDocument, kind: AuxiliaryKind, target: TrackScope) => void;
    auxiliary: (
        line: LyricLine,
        kind: AuxiliaryKind,
        preferences: Preferences,
        document?: BridgeDocument | null,
    ) => { text: string; provenance: string; key: string } | null;
    status: (message: string, error?: boolean, ttl?: number) => void;
    showError: (cause: unknown, parent?: HTMLElement | null | undefined, retryAction?: () => unknown) => void;
    startPlaybackPreview: (doc: BridgeDocument, label: string, actions: HTMLElement[]) => void;
    sourceUsage: (doc: BridgeDocument | null) => Map<string, string[]>;
    languageChoices: [string, string][];
    baseFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) &
        ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>);
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: (() => void) | undefined) => void;
    capabilities: () => Promise<void>;
}
export function createSearchPanel(dependencies: Dependencies) {
    const {
        responseOrder,
        context,
        closePopup,
        closeSearch,
        documentState,
        api,
        playbackPreview,
        refreshSong,
        updatePanelBounds,
        metrics,
        defaults,
        buildMixPreview,
        auxiliary,
        status,
        showError,
        startPlaybackPreview,
        sourceUsage,
        languageChoices,
        baseFetch,
        notice,
        capabilities,
    } = dependencies;
    async function openVersions(better: RichLyrics | null | undefined = undefined, mixKind: AuxiliaryKind | undefined = undefined) {
        closePopup();
        closeSearch();
        const target = context.scope;
        context.searchPopup = e("section", "lb-popup lb-search");
        document.querySelectorAll(".lb-upgrade").forEach((node) => node.remove());
        context.searchPopup.setAttribute("role", "dialog");
        context.searchPopup.setAttribute("aria-label", better ? "Preview lyric update" : "Search versions");
        const head = e("header", "lb-popup-header");
        head.append(
            e("h2", "", better ? "Preview lyric update" : "Search versions"),
            button("Cancel", () => closeSearch(), "lb-close", { icon: "close", iconOnly: true }),
        );
        const form = e("div", "lb-search-form");
        const title = e("input"),
            artist = e("input");
        title.value = context.current?.track?.title || context.current?.lyrics?.title || "";
        artist.value = context.current?.track?.artist || context.current?.lyrics?.artist || "";
        field(form, "Title", title);
        field(form, "Artist", artist);
        const provider = select(
            form,
            "Sources",
            "",
            [["", "All enabled"] as const, ...context.sources.map((s) => [s.name, s.name] as const)],
            () => {},
        );
        const progress = e("p", "lb-search-status", ""),
            list = e("div", "lb-results"),
            preview = e("div", "lb-version-preview lb-task-surface");
        list.tabIndex = 0;
        list.setAttribute("aria-label", "Lyric search results");
        const body = e("div", "lb-search-body");
        body.append(list, preview);
        const toolbar = e("div", "lb-search-toolbar");
        toolbar.append(progress);
        const { root: sourceFailures, content: failureContent } = disclosure("Unavailable sources", "lb-search-failures", false);
        sourceFailures.hidden = true;
        const querySummary = e("div", "lb-search-query"),
            queryText = e("span");
        querySummary.hidden = true;
        querySummary.append(
            queryText,
            button(
                "Edit search",
                () => {
                    form.hidden = false;
                    querySummary.hidden = true;
                    title.focus();
                },
                "",
                { icon: "edit" },
            ),
        );
        context.searchPopup.append(head, form, querySummary, toolbar, body);
        form.append(
            e(
                "small",
                "lb-search-context",
                [
                    context.current?.track?.album,
                    context.current?.track?.durationMs
                        ? Math.round(requireValue(requireValue(documentState().track).durationMs) / 1000) + " seconds"
                        : "",
                ]
                    .filter(Boolean)
                    .join(" · "),
            ),
        );
        document.body.append(context.searchPopup);
        updatePanelBounds();
        requireValue(context.searchPopup.querySelector("button")).focus();
        let picked = null;
        let improvement: SearchImprovement | null = null;
        let finalized = false;
        const rendered = new Map<
            string,
            {
                container: HTMLElement;
                row: HTMLButtonElement;
                badge: HTMLElement;
                warning: HTMLElement;
                signature: string | null;
                usage: HTMLElement;
                explanation: HTMLElement;
            }
        >();
        const candidates = new Map<string, Candidate>();
        toolbar.append(sourceFailures);
        const timingName = (value: string | undefined) =>
            ({
                "mostly-word-timed": "Mostly word-timed",
                "partially-word-timed": "Partially word-timed",
                "line-timed": "Line-timed",
                plain: "Plain text",
            })[value ?? ""] || "Checking timing…";
        const explanation = (parent: HTMLElement, assessment: MatchAssessment | null | undefined) => {
            if (!assessment) return;
            if (assessment.reasons?.length) parent.append(e("p", "lb-match-warning", assessment.reasons.join(" · ")));
            const details = e("details", "lb-match-details");
            details.append(e("summary", "", "Match details"));
            for (const f of assessment.fields || [])
                details.append(
                    e(
                        "div",
                        "",
                        `${{ title: "Title", artists: "Artists", album: "Album", albumArtists: "Album artists", duration: "Duration" }[f.field] || f.field}: ${f.result.replace(/([a-z])([A-Z])/g, "$1 $2")}`,
                    ),
                );
            details.append(e("div", "", `Recording: ${assessment.recording} → ${assessment.candidateRecording}`));
            if (assessment.durationDifferenceMs != null)
                details.append(e("div", "", `Duration difference: ${(assessment.durationDifferenceMs / 1000).toFixed(1)} seconds`));
            if (assessment.timing)
                details.append(
                    e(
                        "div",
                        "",
                        `${timingName(assessment.timing.category)} · ${Math.round(assessment.timing.coverage)}% of lead lines · ${assessment.timing.invalidCues} invalid cues`,
                    ),
                );
            if (assessment.auxiliary)
                details.append(
                    e(
                        "div",
                        "",
                        `Supplied rows: translation ${Math.round(assessment.auxiliary.translationCoverage)}% · pronunciation ${Math.round(assessment.auxiliary.pronunciationCoverage)}% of lead lines`,
                    ),
                );
            parent.append(details);
        };
        const pick = async (candidate: Candidate) => {
            const displayedOffer = better?.source === candidate.source && better.providerId === candidate.id ? better : null;
            const upgrade = improvement?.key === candidate.source + ":" + candidate.id ? improvement : null;
            if (matchMedia("(max-width:760px)").matches) list.hidden = true;
            picked = candidate;
            list.querySelectorAll<HTMLElement>(".lb-result").forEach((n) =>
                n.setAttribute("aria-pressed", String(n.dataset.key === candidate.source + ":" + candidate.id)),
            );
            preview.replaceChildren(e("p", "", "Loading preview…"));
            try {
                const data = parseDocument(await api("items/" + requireValue(target).itemId + "/preview", "POST", candidate), defaults);
                if (context.scope !== target || context.searchPopup !== searchPanel || picked !== candidate) return;
                if (mixKind) {
                    buildMixPreview(preview, data, mixKind, requireValue(target));
                    if (list.hidden)
                        preview.prepend(
                            button(
                                "Back to results",
                                () => {
                                    list.hidden = false;
                                    preview.replaceChildren();
                                },
                                "",
                                { icon: "back" },
                            ),
                        );
                    return;
                }
                const canSelect = documentState().canSelect;
                preview.replaceChildren(e("h3", "", candidate.title));
                const usage = e("div", "lb-source-usage");
                usage.dataset.usageKey = candidate.source + ":" + candidate.id;
                preview.append(usage);
                context.searchUsageRefresh?.();
                if (displayedOffer && documentState().improvement?.description)
                    preview.append(e("p", "lb-help", requireValue(documentState().improvement).description));
                explanation(preview, candidate.assessment || data.matchAssessment);
                if (list.hidden && !displayedOffer)
                    preview.prepend(
                        button(
                            "Back to results",
                            () => {
                                list.hidden = false;
                                preview.replaceChildren();
                            },
                            "",
                            { icon: "back" },
                        ),
                    );
                for (const l of data.lyrics?.lines.slice(0, 15) || []) {
                    const block = e("div", "lb-preview-line");
                    block.append(e("strong", "", l.text));
                    for (const kind of ["pronunciation", "translation"] as const) {
                        const value = auxiliary(l, kind, data.preferences, data);
                        if (value) block.append(e("div", "", value.text));
                    }
                    preview.append(block);
                }
                const saveVersion = async () => {
                    const upgrade = improvement?.key === candidate.source + ":" + candidate.id ? improvement : null;
                    try {
                        await api(
                            "items/" +
                                requireValue(target).itemId +
                                (displayedOffer || upgrade
                                    ? "/upgrade?hash=" +
                                      encodeURIComponent(upgrade?.hash || requireValue(displayedOffer).hash) +
                                      "&baselineHash=" +
                                      encodeURIComponent(upgrade?.baselineHash || documentState().improvement?.baselineHash || "")
                                    : "/select"),
                            "POST",
                            displayedOffer || upgrade ? undefined : candidate,
                        );
                        if (context.scope !== target || context.searchPopup !== searchPanel) return;
                        playbackPreview.discard();
                        closeSearch(false);
                        await refreshSong(true);
                        status("Lyric version saved", false, 4000);
                    } catch (error) {
                        if (context.scope !== target || context.searchPopup !== searchPanel) return;
                        if (
                            error instanceof BridgeRequestError &&
                            ["lyric_version_changed", "upgrade_offer_changed", "upgrade_unavailable"].includes(error.details.code)
                        ) {
                            improvement = null;
                            for (const entry of rendered.values()) {
                                entry.badge.hidden = true;
                                entry.explanation.hidden = true;
                            }
                            showError(error, context.searchPlaybackBar || preview, () => {
                                void search();
                            });
                            void refreshSong().catch((cause: unknown) => {
                                if (context.scope === target && context.searchPopup === searchPanel) showError(cause, searchPanel);
                            });
                        } else showError(error, context.searchPlaybackBar || preview);
                    }
                };
                const previewActions = e("div", "lb-song-actions");
                preview.append(previewActions);
                if (displayedOffer) previewActions.append(button("Search other versions", () => openVersions(), "", { icon: "search" }));
                previewActions.append(
                    button(
                        "Preview with playback",
                        () => {
                            const actions = [
                                button(
                                    "Return to results",
                                    () => {
                                        requireValue(context.searchPopup).hidden = false;
                                        context.searchPlaybackBar?.remove();
                                        context.searchPlaybackBar = null;
                                        requireValue(context.searchPopup).querySelector("button")?.focus();
                                    },
                                    "",
                                    { icon: "back" },
                                ),
                                button("Cancel preview", () => closeSearch(), "", { icon: "close" }),
                            ];
                            if (canSelect)
                                actions.push(
                                    button(displayedOffer || upgrade ? "Use improved version" : "Use this version", saveVersion, "lb-primary", {
                                        icon: "check",
                                    }),
                                );
                            startPlaybackPreview(
                                { ...data, itemId: requireValue(target).itemId },
                                "Previewing " + candidate.source + " · " + candidate.title,
                                actions,
                            );
                            requireValue(context.searchPopup).hidden = true;
                        },
                        "",
                        { icon: "preview" },
                    ),
                );
                if (canSelect)
                    previewActions.append(
                        button(displayedOffer || upgrade ? "Use improved version" : "Use this version", saveVersion, "lb-primary", { icon: "check" }),
                    );
                else preview.append(e("p", "lb-help", "Only administrators can apply this selection."));
            } catch (error) {
                showError(error, preview);
            }
        };

        let usageRevision: string | null = null,
            usageCache = new Map<string, string[]>();
        context.searchUsageRefresh = () => {
            const doc = playbackPreview.baseline?.doc || context.current;
            const revision = JSON.stringify([
                doc?.lyrics?.hash,
                doc?.lyrics?.source,
                doc?.lyrics?.providerId,
                doc?.preferences,
                doc?.auxiliaryChoices,
                doc?.variants?.map((v) => [v.key, v.origin]),
            ]);
            if (revision !== usageRevision) {
                usageRevision = revision;
                usageCache = sourceUsage(doc);
            }
            const usage = usageCache;
            for (const node of context.searchPopup?.querySelectorAll<HTMLElement>(".lb-source-usage") || []) {
                const labels = usage.get(node.dataset.usageKey || "") || [];
                const signature = JSON.stringify(labels);
                if (node.dataset.signature === signature) continue;
                node.dataset.signature = signature;
                node.hidden = !labels.length;
                node.replaceChildren(...labels.map((label) => e("span", "lb-status-badge", label)));
            }
        };
        const paint = (results: Candidate[], recommended: string | null | undefined) => {
            const begun = performance.now();
            for (const c of results) {
                const key = c.source + ":" + c.id;
                candidates.set(key, c);
                let entry = rendered.get(key);
                if (!entry) {
                    const container = e("article", "lb-result-container"),
                        row = button("", () => pick(requireValue(candidates.get(key))), "lb-result"),
                        badge = e("span", "lb-recommended", "Recommended"),
                        warning = e("span", "lb-result-warning");
                    row.dataset.key = key;
                    row.setAttribute("aria-pressed", "false");
                    row.append(badge);
                    container.append(row);
                    entry = {
                        container,
                        row,
                        badge,
                        warning,
                        signature: null,
                        usage: e("div", "lb-source-usage"),
                        explanation: e("span", "lb-improvement-reason"),
                    };
                    rendered.set(key, entry);
                    list.append(container);
                }
                const signature = JSON.stringify([
                    c.title,
                    c.artist,
                    c.album,
                    c.durationMs,
                    c.verification,
                    c.wordTiming,
                    c.translationLanguages,
                    c.hasPronunciation,
                    c.assessment,
                ]);
                if (entry.signature !== signature) {
                    entry.row.replaceChildren(
                        e("strong", "", c.title),
                        e("span", "lb-result-artists", c.artist),
                        e(
                            "small",
                            "",
                            [
                                c.source,
                                c.album,
                                c.durationMs ? Math.round(c.durationMs / 1000) + "s" : null,
                                c.assessment?.eligible === false
                                    ? "Needs review"
                                    : c.score >= 90
                                      ? "Strong match"
                                      : c.score >= 70
                                        ? "Possible match"
                                        : "Low match",
                            ]
                                .filter(Boolean)
                                .join(" · "),
                        ),
                        e(
                            "span",
                            "lb-badges",
                            c.verification === "pending"
                                ? "Checking lyrics…"
                                : c.verification === "instrumental"
                                  ? "Instrumental"
                                  : c.verification === "unavailable"
                                    ? "Lyrics unavailable"
                                    : [
                                          timingName(c.assessment?.timing?.category),
                                          ...(c.translationLanguages || []).map(
                                              (l) =>
                                                  (languageChoices.find((choice) => choice[0] === l)?.[1] || (l === "zh" ? "Chinese" : l)) +
                                                  " translation",
                                          ),
                                          ...(c.hasPronunciation ? ["Pronunciation"] : []),
                                      ].join(" · "),
                        ),
                    );
                    entry.warning.textContent = c.assessment?.reasons?.[0] || "";
                    entry.warning.hidden = !entry.warning.textContent;
                    entry.usage.dataset.usageKey = key;
                    entry.row.append(entry.warning, entry.usage, entry.badge);
                    entry.row.append(entry.explanation);
                    entry.signature = signature;
                    metrics.searchRowUpdates++;
                }
                const isImprovement = improvement?.key === key;
                entry.badge.textContent = isImprovement ? "Better than current" : "Recommended";
                entry.explanation.hidden = !isImprovement;
                entry.explanation.textContent = isImprovement && improvement?.description ? "Why it’s better: " + improvement.description : "";
                if (entry.badge.hidden !== (key !== recommended && !isImprovement)) entry.badge.hidden = key !== recommended && !isImprovement;
            }
            context.searchUsageRefresh?.();
            metrics.maxSearchPaintMs = Math.max(metrics.maxSearchPaintMs || 0, performance.now() - begun);
        };
        const finalizeResults = () => {
            if (finalized) return;
            finalized = true;
            const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const scrollTop = list.scrollTop;
            for (const candidate of [...candidates.values()].sort(rankCandidates))
                list.append(requireValue(rendered.get(candidate.source + ":" + candidate.id)).container);
            focused?.focus({ preventScroll: true });
            list.scrollTop = scrollTop;
            metrics.searchSorts++;
        };
        const searchPanel = context.searchPopup;
        const request = context.lastRequest;
        // Capture authentication and item at panel creation, including delayed release.
        const searchApi = createApi({
            request: () => request,
            scope: () => target,
            fetch: baseFetch,
            responseOrder,
            received: () => metrics.requests++,
        });
        const session = new SearchSession<SearchQuery, SearchResults>(
            {
                start: async (query) =>
                    parseSearchAdmission(await searchApi("items/" + requireValue(target).itemId + "/search", "POST", query, null)),
                read: async (id, signal) => parseSearchResults(await searchApi("search/" + id, "GET", undefined, signal)),
                release: async (id) => {
                    await searchApi("search/" + id, "DELETE", undefined, null);
                },
            },
            (state) => {
                if (context.scope !== target || context.searchPopup !== searchPanel) return;
                if (state.kind === "admitting") stopSearch.hidden = false;
                if (state.kind === "failed") {
                    stopSearch.hidden = true;
                    showError(state.error, searchPanel);
                    return;
                }
                if (state.kind !== "results") return;
                const data = state.value;
                const terminal = data.state !== "searching";
                stopSearch.hidden = terminal;
                improvement = terminal && data.state !== "cancelled" ? data.improvement || null : null;
                paint(data.candidates, terminal ? data.recommended : null);
                if (terminal && !finalized) {
                    finalizeResults();
                    void refreshSong().catch((error: unknown) => {
                        if (context.scope === target && context.searchPopup === searchPanel) showError(error, searchPanel);
                    });
                }
                progress.textContent = `${data.finished}/${data.total} sources · ${data.state === "cancelled" ? "search stopped" : data.state === "timed_out" ? "finished (search deadline reached)" : data.state}`;
                const errors = data.errors || [];
                sourceFailures.hidden = !errors.length;
                const failureSignature = JSON.stringify(errors);
                if (sourceFailures.dataset.signature !== failureSignature) {
                    sourceFailures.dataset.signature = failureSignature;
                    requireValue(sourceFailures.querySelector(".lb-disclosure-title")).textContent =
                        errors.length + " source" + (errors.length === 1 ? "" : "s") + " unavailable";
                    failureContent.replaceChildren(
                        ...errors.map((error) => e("p", "lb-help", error.message + (error.diagnosticId ? " · Reference " + error.diagnosticId : ""))),
                    );
                }
                if (data.state !== "searching" && !data.candidates.length) progress.textContent += " · No versions found.";
            },
        );
        context.searchSession = session;
        const stopSearch = button(
            "Stop search",
            () => {
                session.cancel();
                finalizeResults();
                stopSearch.hidden = true;
                progress.textContent = "Search stopped · results received so far";
                progress.tabIndex = -1;
                progress.focus({ preventScroll: true });
            },
            "",
            { icon: "close" },
        );
        stopSearch.hidden = true;
        toolbar.append(stopSearch);
        const collapseFields = (parts: string[]) => {
            queryText.textContent = parts.filter(Boolean).join(" · ");
            const editing = form.contains(document.activeElement);
            form.hidden = true;
            querySummary.hidden = false;
            if (editing) querySummary.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        };
        const search = () => {
            if (context.scope !== target || context.searchPopup !== searchPanel) return;
            picked = null;
            improvement = null;
            finalized = false;
            rendered.clear();
            candidates.clear();
            collapseFields([title.value, artist.value, provider.selectedOptions[0]?.textContent || ""]);
            list.hidden = false;
            list.replaceChildren();
            preview.replaceChildren();
            progress.textContent = "Searching…";
            return session.start({ title: title.value, artist: artist.value, source: provider.value || null });
        };
        const submit = button("Search", search, "lb-primary lb-search-submit", { icon: "search" });
        form.insertBefore(submit, form.querySelector<HTMLElement>(".lb-search-context"));
        const { root: advanced, content: advancedBody } = disclosure("Advanced: provider track ID", "lb-advanced", false);
        const id = e("input");
        const idProvider = select(
            advancedBody,
            "Track ID provider",
            context.sources[0]?.name || "",
            context.sources.map((source) => [source.name, source.name] as const),
            () => {},
        );
        field(advancedBody, "Provider track ID", id);
        const openTrack = button(
            "Open provider track",
            () => {
                if (!idProvider.value || !id.value.trim()) {
                    notice(progress, "Choose a provider and enter its track ID.");
                    return;
                }
                collapseFields([title.value, artist.value, idProvider.value, "Track ID: " + id.value.trim()]);
                pick({ source: idProvider.value, id: id.value.trim(), title: title.value, artist: artist.value, album: "", score: 100 });
            },
            "",
            { icon: "external" },
        );
        advancedBody.append(openTrack);
        form.append(advanced);
        if (better) {
            context.searchPopup.classList.add("lb-offer-preview");
            form.hidden = true;
            querySummary.hidden = true;
            toolbar.hidden = true;
            advanced.hidden = true;
            list.hidden = true;
            const c = {
                source: requireValue(better.source),
                id: requireValue(better.providerId),
                title: better.title || "",
                artist: better.artist || "",
                album: "",
                score: documentState().improvement?.assessment?.score || 100,
                assessment: documentState().improvement?.assessment,
            };
            pick(c);
        } else {
            await capabilities().catch(() => {});
            if (context.scope !== target || context.searchPopup !== searchPanel) return;
            provider.replaceChildren(
                ...[
                    ["", "All enabled"] as const,
                    ...context.sources.filter((s) => s.enabled && (!s.requiresCredential || s.configured)).map((s) => [s.name, s.name] as const),
                ].map(([value, text]) => {
                    const option = e("option", "", text);
                    option.value = value;
                    return option;
                }),
            );
            idProvider.replaceChildren(
                ...context.sources
                    .filter((source) => source.enabled && (!source.requiresCredential || source.configured))
                    .map((source) => {
                        const option = e("option", "", source.name);
                        option.value = source.name;
                        return option;
                    }),
            );
            openTrack.disabled = !idProvider.options.length;
            search();
        }
    }
    return { openVersions };
}
