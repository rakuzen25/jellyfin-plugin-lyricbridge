import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { LyricLine, RichLyrics } from "../../contracts/lyrics.ts";
import type { AuxiliaryKind } from "../../contracts/preferences.ts";
import { type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { TrackScope } from "../session/contracts.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import type { BridgeApi } from "../transport/ports.ts";
import { button, e, select } from "../ui/controls.ts";

interface Dependencies {
    documentState: () => Readonly<BridgeDocument>;
    searchPopup: HTMLElement | null;
    notice: (node: HTMLElement | null | undefined, message: string, ttl?: number, expire?: () => void, severity?: FeedbackSeverity) => void;
    api: BridgeApi;
    trackSession: TrackSessionPort;
    finishWorkflow: () => Promise<void>;
    status: (message: string, error?: boolean, ttl?: number, operation?: string) => void;
    showError: (
        cause: unknown,
        parent?: HTMLElement | null | undefined,
        retryAction?: () => unknown,
        context?: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string },
    ) => void;
}

/** Owns mix section behavior and its installation lifetime. */
export function createMixSection(deps: Dependencies) {
    function buildMixPreview(parent: HTMLElement, donor: BridgeDocument, kind: AuxiliaryKind, target: TrackScope) {
        parent.replaceChildren(e("h3", "", "Use supplied " + kind + " from " + requireValue(donor.lyrics).source));
        const base = deps.documentState().lyrics;
        const language = deps.documentState().preferences.translationLanguage;
        const all = (doc: RichLyrics | null | undefined) =>
            (doc?.lines ?? []).flatMap((line) => (line.background ? [line, line.background] : [line]));
        const donorLines = all(donor.lyrics);
        const mapping: Record<string, string> = {};
        const used = new Set<string>();
        let previous = -1;
        const text = (line: LyricLine) =>
            kind === "pronunciation"
                ? line.pronunciation
                : line.translations?.[language] ||
                  Object.entries(line.translations || {})
                      .filter(([key]) => key.split("-")[0] === language.split("-")[0])
                      .map(([, value]) => value)[0];
        const normalize = (value: string) =>
            value
                .normalize("NFKC")
                .replace(/[^\p{L}\p{N}]/gu, "")
                .toLowerCase();
        const rows = e("div", "lb-mix-lines");
        parent.append(e("p", "lb-help", "Review the mapping. Unmatched rows are skipped; original timing is retained."), rows);
        for (const line of all(base)) {
            let candidates = donorLines
                .map((l, i) => ({ l, i }))
                .filter(
                    ({ l, i }) => i > previous && !used.has(l.id) && text(l) && normalize(l.text) === normalize(line.text) && normalize(line.text),
                );
            if (candidates.length > 1 && line.start != null)
                candidates = candidates.filter(({ l }) => l.start != null && Math.abs(l.start - requireValue(line.start)) <= 5000000);
            const suggested = donor.suggestedOriginHash === requireValue(base).hash ? donor.suggestedMapping?.[line.id] : null;
            const selected = suggested
                ? donorLines.map((l, i) => ({ l, i })).find(({ l }) => l.id === suggested && text(l))
                : candidates.length === 1
                  ? candidates[0]
                  : null;
            if (selected) {
                mapping[line.id] = selected.l.id;
                used.add(selected.l.id);
                previous = selected.i;
            }
            select(
                rows,
                line.text,
                selected?.l.id || "",
                [["", "Unmatched — skip"], ...donorLines.filter(text).map((l) => [l.id, l.text + " · " + text(l)] as const)],
                (value) => {
                    if (value) mapping[line.id] = value;
                    else delete mapping[line.id];
                },
            );
        }
        const result = e("p", "lb-version-status");
        result.textContent = Object.keys(mapping).length + " matched · " + (all(base).length - Object.keys(mapping).length) + " unmatched";
        parent.append(result);
        rows.addEventListener(
            "change",
            () =>
                (result.textContent = Object.keys(mapping).length + " matched · " + (all(base).length - Object.keys(mapping).length) + " unmatched"),
        );
        parent.append(
            button(
                "Use mapped " + kind,
                async () => {
                    const workflow = deps.searchPopup;
                    if (workflow?.getAttribute("aria-busy") === "true") return;
                    workflow?.setAttribute("aria-busy", "true");
                    const close = workflow?.querySelector<HTMLButtonElement>(".lb-popup-header button");
                    if (close) close.disabled = true;
                    deps.notice(result, "Saving mapped rows…");
                    try {
                        await deps.api("items/" + target.itemId + "/mix", "POST", {
                            hash: requireValue(base).hash,
                            donorHash: requireValue(donor.lyrics).hash,
                            kind,
                            language,
                            mapping,
                        });
                        if (deps.trackSession.scope !== target || deps.searchPopup !== workflow) return;
                        await deps.finishWorkflow();
                        deps.status("Source rows saved", false, 4000);
                    } catch (error) {
                        if (deps.trackSession.scope === target && deps.searchPopup === workflow) deps.showError(error, parent);
                    } finally {
                        if (deps.searchPopup === workflow) {
                            workflow?.setAttribute("aria-busy", "false");
                            if (close) close.disabled = false;
                        }
                    }
                },
                "",
                { icon: "check" },
            ),
        );
    }
    return { buildMixPreview };
}
