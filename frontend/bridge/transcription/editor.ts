import type { FeedbackScope } from "../../shared/feedback.ts";
import { button, disclosure, e, field, select, toggle } from "../ui/controls.ts";
import { feedbackHost } from "../ui/feedback.ts";
import type { ReviewChange, TranscriptionReviewController, TranscriptionReviewSnapshot } from "./review-controller.ts";
import { graphemeEnds } from "./state.ts";
interface Dependencies {
    controller: TranscriptionReviewController;
    panel: HTMLElement;
    main: HTMLElement;
    footer: HTMLElement;
    feedback: FeedbackScope;
    setBusy(busy: boolean): void;
    live(): boolean;
    navigate(text: string, run: () => unknown): void;
    ask(text: string, run: () => unknown, label?: string): void;
    browse(): void;
    deleteTranscript(parent: HTMLElement, id: string, capability: { readonly allowed: boolean; readonly reason: string | null }, count: number): void;
    play(start: number, end: number): () => void;
}
const stamp = (ticks: number) => {
    const seconds = Math.max(0, ticks / 10_000_000);
    return Math.floor(seconds / 60) + ":" + (seconds % 60).toFixed(2).padStart(5, "0");
};
/** Review presentation consumes immutable snapshots and dispatches named commands. */
export function createTranscriptionEditor(d: Dependencies) {
    const c = d.controller;
    let phraseLimit = 100,
        transcriptId = "",
        clip: (() => void) | null = null;
    let refreshChoices: (() => void) | undefined;
    let updatePlan: (() => void) | undefined;
    let saveButton: HTMLButtonElement | undefined;
    const snapshot = () => c.snapshot;
    function savedChoices(s: TranscriptionReviewSnapshot) {
        return (s.review?.savedEntries ?? []).flatMap((entry) => {
            const version = s.review?.versions.find((v) => v.id === entry.versionId);
            return version
                ? [
                      {
                          id: entry.id,
                          entry,
                          version,
                          label:
                              (entry.origin === "local" ? "Automatic" : entry.origin === "AI" ? "AI review" : "Manual") +
                              (entry.optionName ? " · " + entry.optionName : "") +
                              (entry.model ? " · " + entry.model : "") +
                              (entry.created ? " · " + new Date(entry.created).toLocaleString() : ""),
                      },
                  ]
                : [];
        });
    }
    function notices(s: TranscriptionReviewSnapshot) {
        const review = s.review!;
        const source = review.transcript;
        d.main.append(
            e(
                "p",
                "lb-version-metadata",
                source.language + " · " + (source.timing === "word" ? "Word timing" : "Segment timing only") + " · " + s.phrases.length + " phrases",
            ),
        );
        const warnings = feedbackHost();
        warnings.hidden = source.warnings.length === 0;
        d.main.append(warnings);
        if (source.warnings.length)
            d.feedback.update(warnings, {
                message: source.warnings.length + " transcription notices",
                severity: "warning",
                details: source.warnings.map((w) => w.message),
            });
        const version = review.versions.find((v) => v.id === s.selectedVersionId);
        const seams = review.reviewResults.find((r) => r.id === s.selectedResultId)?.seamTokenIds ?? version?.seamTokenIds;
        if (seams?.length) {
            const notice = feedbackHost();
            d.main.append(notice);
            d.feedback.update(notice, {
                message: "Review " + seams.length + " batch seams without strong pauses or punctuation.",
                severity: "warning",
                details: seams.map((id) => "After " + (source.tokens.find((t) => t.id === id)?.text ?? id)),
            });
        }
    }
    function savedEntries(s: TranscriptionReviewSnapshot) {
        const review = s.review!;
        const choices = select(
            d.main,
            "Saved line breaks",
            s.selectedEntryId,
            [["", "Unsaved draft"], ...savedChoices(s).map((choice) => [choice.id, choice.label] as const)],
            (value) => {
                if (!savedChoices(snapshot()).some((choice) => choice.id === value)) return;
                choices.value = snapshot().selectedEntryId;
                d.navigate("Save unfinished edits before switching versions?", () => c.selectEntry(value));
            },
        );
        refreshChoices = () => {
            if (!choices.isConnected) return;
            const current = snapshot();
            choices.replaceChildren(
                ...[{ id: "", label: "Unsaved draft" }, ...savedChoices(current)].map((choice) => {
                    const option = e("option");
                    option.value = choice.id;
                    option.textContent = choice.label;
                    return option;
                }),
            );
            choices.value = current.selectedEntryId;
        };
        choices.disabled = s.saving;
        const { root, content } = disclosure("Manage saved line breaks", "lb-transcription-management");
        for (const choice of savedChoices(s)) {
            const row = e("div", "lb-transcription-saved-entry");
            row.append(e("p", "lb-version-metadata", choice.label));
            const remove = button(
                "Delete",
                () =>
                    d.ask(
                        "Delete “" + choice.label + "”? Only this saved entry is removed. Your current draft and other saved entries are retained.",
                        () => c.deleteEntry(choice.id),
                        "Delete",
                    ),
                "",
                { icon: "trash" },
            );
            remove.disabled = s.saving || !choice.entry.deletion.allowed;
            row.append(remove);
            if (choice.entry.deletion.reason) row.append(e("p", "lb-help", choice.entry.deletion.reason));
            content.append(row);
        }
        if (!review.savedEntries.length) content.append(e("p", "lb-help", "No saved line breaks."));
        d.deleteTranscript(content, review.transcript.id, review.deletion, review.savedEntries.length);
        d.main.append(root);
    }
    function automaticTools(s: TranscriptionReviewSnapshot) {
        const { root: options, content } = disclosure("Automatic line breaks", "lb-transcription-automatic");
        content.append(e("p", "lb-help", "Runs locally without an AI service. Adjust the targets, then apply automatic line breaks."));
        const chars = e("input");
        chars.type = "number";
        chars.min = "4";
        chars.max = "200";
        chars.placeholder = s.review!.transcript.language === "ja" ? "14 (automatic)" : "42 (automatic)";
        chars.value = s.settings.characters == null ? "" : String(s.settings.characters);
        chars.onchange = () => c.updateSettings({ characters: chars.value === "" ? null : Number(chars.value) });
        field(content, "Character target", chars, "Soft target; natural phrases may be longer.");
        const seconds = e("input");
        seconds.type = "number";
        seconds.min = ".5";
        seconds.max = "30";
        seconds.step = ".5";
        seconds.value = String(s.settings.seconds);
        seconds.onchange = () => c.updateSettings({ seconds: Number(seconds.value) });
        field(content, "Duration target (seconds)", seconds);
        toggle(content, "Keep short replies separate", s.settings.keepShortReplies, (value) => c.updateSettings({ keepShortReplies: value }));
        content.append(button("Apply automatic line breaks", () => void c.automatic(), "", { icon: "generate" }));
        const { root: aiOptions, content: aiContent } = disclosure("AI review", "lb-transcription-ai-review");
        aiContent.append(
            e(
                "p",
                "lb-help",
                "Requests a remote proposal using the targets under Automatic line breaks. Your current edits stay in place until you open a result.",
            ),
        );
        const ai = button("Request AI review", () => void c.requestReview(), "", { icon: "speech" });
        const choice = select(
            aiContent,
            "AI review service",
            s.selectedReviewOption,
            [["", "Choose a service…"], ...s.reviewOptions.map((o) => [o.id, o.name] as [string, string])],
            (value) => c.selectReviewOption(value),
        );
        const count = e("p", "lb-version-metadata");
        updatePlan = () => {
            if (!count.isConnected) return;
            const current = snapshot();
            choice.value = current.selectedReviewOption;
            ai.disabled = current.saving || !current.plan;
            count.textContent = current.plan
                ? current.plan.requestCount + (current.plan.requestCount === 1 ? " AI request" : " AI requests") + " · approximate input estimate"
                : current.planStatus === "loading"
                  ? "Estimating AI requests…"
                  : current.planStatus === "unavailable"
                    ? "Request count unavailable"
                    : "";
        };
        ai.disabled = true;
        aiContent.append(count, ai);
        const tools = e("div", "lb-transcription-tools");
        tools.append(options, aiOptions);
        d.main.append(tools);
        updatePlan();
    }
    function editActions(s: TranscriptionReviewSnapshot) {
        const actions = e("div", "lb-song-actions");
        const undo = button("Undo", () => c.undo(), "", { icon: "back" });
        undo.disabled = !s.canUndo;
        const redo = button("Redo", () => c.redo(), "", { icon: "retry" });
        redo.disabled = !s.canRedo;
        actions.append(
            undo,
            redo,
            button("Reset edits", () => c.reset(), "", { icon: "reset" }),
        );
        d.main.append(actions);
    }
    function phrases(s: TranscriptionReviewSnapshot) {
        const phrases = e("div", "lb-transcription-phrases");
        d.main.append(phrases);
        const source = s.review!.transcript;
        const allowed = graphemeEnds(source.text),
            guidance = new Map(s.review!.boundaries.map((b) => [b.afterId, b.message]));
        let rendered = 0;
        const play = (start: number, end: number) => {
            clip?.();
            clip = d.play(start, end);
        };
        const renderMore = () => {
            more.remove();
            const next = Math.min(Math.max(rendered + 100, phraseLimit), s.phrases.length);
            for (let index = rendered; index < next; index++) {
                const group = s.phrases[index]!,
                    last = group.at(-1)!;
                const row = e("section", "lb-frame lb-transcription-phrase");
                row.append(e("p", "lb-transcription-text", group.map((t) => t.separator + t.text).join("")));
                const start = Math.min(...group.map((t) => t.start)),
                    end = Math.max(...group.map((t) => t.end));
                row.append(e("p", "lb-version-metadata", stamp(start) + " – " + stamp(end) + " · " + ((end - start) / 10_000_000).toFixed(2) + " s"));
                const controls = e("div", "lb-song-actions");
                controls.append(
                    button("Play phrase " + (index + 1), () => play(Math.max(0, start - 10_000_000), end + 10_000_000), "", { icon: "music" }),
                );
                if (index < s.phrases.length - 1)
                    controls.append(
                        button("Merge with next", () => c.merge(last.id), "", { icon: "minus" }),
                        button("Play boundary " + (index + 1), () => play(Math.max(0, end - 15_000_000), end + 15_000_000), "", { icon: "timing" }),
                    );
                row.append(controls);
                if (group.length > 1) {
                    const { root, content } = disclosure("Split phrase " + (index + 1), "", false);
                    for (const token of group.slice(0, -1))
                        if (allowed.has(token.endPosition)) {
                            const entry = e("div", "lb-transcription-split");
                            entry.append(button("Split after “" + token.text.trim() + "”", () => c.split(token.id), "", { icon: "plus" }));
                            const note = guidance.get(token.id);
                            if (note) entry.append(e("small", "lb-help", note));
                            content.append(entry);
                        }
                    row.append(root);
                }
                phrases.append(row);
            }
            rendered = next;
            phraseLimit = Math.max(phraseLimit, rendered);
            if (rendered < s.phrases.length) phrases.append(more);
        };
        const more = button("Show next 100 phrases", renderMore);
        renderMore();
    }
    function footer(s: TranscriptionReviewSnapshot) {
        d.footer.replaceChildren(
            button("Back to recordings", () => d.navigate("Save unfinished edits before returning to recordings?", d.browse), "", { icon: "back" }),
        );
        d.footer.hidden = false;
        if (!s.hasHistory) return;
        const playback = button("Playback preview", () => void c.preview(), "", { icon: "preview" });
        playback.dataset.playbackPreview = "true";
        saveButton = button("Save line breaks", () => void c.save(), "", {
            icon: "check",
            ...(s.review!.canUse ? {} : { appearance: "primary" as const }),
        });
        saveButton.disabled = s.saving || !s.dirty || !s.review!.canManage;
        d.footer.append(playback, saveButton);
        if (s.review!.canUse) d.footer.append(button("Use reviewed lyrics", () => void c.use(), "", { icon: "check", appearance: "primary" }));
        else d.footer.append(e("p", "lb-help", "An administrator must use these lyrics for the shared track."));
    }
    function render() {
        const s = snapshot();
        if (!d.live() || !s.review) return;
        if (s.review.transcript.id !== transcriptId) {
            transcriptId = s.review.transcript.id;
            phraseLimit = 100;
        }
        const previousScroll = d.main.scrollTop;
        const focused = document.activeElement instanceof HTMLElement && d.panel.contains(document.activeElement) ? document.activeElement : null;
        const focusLabel = focused?.getAttribute("aria-label") || focused?.textContent;
        d.feedback.releaseWithin(d.main);
        d.main.classList.remove("lb-transcription-overview");
        d.main.classList.add("lb-transcription-editor");
        d.main.replaceChildren();
        refreshChoices = undefined;
        updatePlan = undefined;
        saveButton = undefined;
        if (!s.hasHistory) {
            d.main.append(
                e("p", "lb-help", "No saved line breaks. The preserved transcript is unchanged."),
                e("p", "lb-transcription-text", s.review.transcript.text),
            );
            d.deleteTranscript(d.main, s.review.transcript.id, s.review.deletion, s.review.savedEntries.length);
            footer(s);
            d.footer.append(button("Generate automatic line breaks", () => void c.automatic(), "", { icon: "generate", appearance: "primary" }));
        } else {
            notices(s);
            savedEntries(s);
            automaticTools(s);
            editActions(s);
            phrases(s);
            footer(s);
        }
        d.setBusy(s.saving);
        if (s.saving)
            d.panel
                .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button,input,select")
                .forEach((n) => (n.disabled = true));
        d.main.scrollTop = previousScroll;
        if (focused && !focused.isConnected) {
            const replacement = [...d.panel.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button,select")].find(
                (node) => !node.disabled && (node.getAttribute("aria-label") || node.textContent) === focusLabel,
            );
            (replacement || d.main.querySelector<HTMLButtonElement>(".lb-transcription-phrase button"))?.focus({ preventScroll: true });
        }
    }
    return {
        update(reason: ReviewChange) {
            if (reason === "render") render();
            else if (reason === "choices") refreshChoices?.();
            else {
                const s = snapshot();
                if (saveButton) saveButton.disabled = s.saving || !s.dirty || !s.review?.canManage;
                updatePlan?.();
            }
        },
        dispose() {
            clip?.();
            clip = null;
            refreshChoices = undefined;
            updatePlan = undefined;
        },
    };
}
