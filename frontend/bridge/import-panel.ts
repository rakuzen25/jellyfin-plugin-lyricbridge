import type { FeedbackOptions, FeedbackSeverity } from "../shared/feedback.ts";
import { parseRequestIssues, type RequestIssue } from "./api.ts";
import { isRecord } from "../shared/invariants.ts";
import type { BridgeDocument, TrackScope } from "./contracts.ts";
import { button, e, section, select } from "./controls.ts";
import type { Preferences } from "./models.ts";
import { parseDocument } from "./responses.ts";
import { feedbackHost } from "./feedback.ts";
import { createDialog } from "./dialog.ts";

interface UploadPreview {
    fileName: string;
    format: string;
    encoding: string;
    timing: "plain" | "line" | "word";
    lineCount: number;
    document: BridgeDocument;
    warnings: RequestIssue[];
}
interface Draft {
    readonly fileName: string;
    readonly fileBytes: string;
    readonly encoding: string;
    readonly format: string;
}
interface Dependencies {
    scope(): TrackScope | null;
    panel(): HTMLElement | null;
    mount(panel: HTMLElement): void;
    beginWorkflow(): boolean;
    closeSearch(restore?: boolean): void;
    endPlaybackPreview(): void;
    startPlaybackPreview(doc: BridgeDocument, label: string, actions: HTMLElement[]): void;
    api(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
    defaults: Preferences;
    status(message: string): void;
    notice(node: HTMLElement, message: string, severity: FeedbackSeverity): void;
    feedback(node: HTMLElement, options: FeedbackOptions): void;
    showError(error: unknown, parent: HTMLElement, retry?: () => unknown): void;
    updatePanelBounds(): void;
    saved(): void;
    finishWorkflow(): Promise<void>;
}
function parsePreview(value: unknown, defaults: Preferences): UploadPreview {
    if (
        !isRecord(value) ||
        typeof value.fileName !== "string" ||
        typeof value.format !== "string" ||
        typeof value.encoding !== "string" ||
        !["plain", "line", "word"].includes(String(value.timing)) ||
        typeof value.lineCount !== "number" ||
        !Number.isSafeInteger(value.lineCount) ||
        value.lineCount < 1
    )
        throw new Error("The server returned an invalid upload preview.");
    const warnings = parseRequestIssues(value.warnings);
    if (!warnings) throw new Error("The server returned invalid upload warnings.");
    return {
        fileName: value.fileName,
        format: value.format,
        encoding: value.encoding,
        timing: value.timing as UploadPreview["timing"],
        lineCount: value.lineCount,
        document: parseDocument(value.document, defaults),
        warnings,
    };
}
export function createImportPanel(dependencies: Dependencies) {
    const d = dependencies;
    let active: { canClose(): boolean; dispose(): void } | null = null;
    function open() {
        if (active && !active.canClose()) return;
        if (!d.beginWorkflow()) return;
        const target = d.scope();
        if (!target) return;
        const cancel = () => {
            if (!saving) d.closeSearch();
        };
        const {
            root: panel,
            body,
            feedback: feedbackArea,
            footer: actions,
            setBusy,
        } = createDialog({
            label: "Import lyrics",
            className: "lb-import-panel",
            onClose: cancel,
        });
        const fileGroup = section("Lyric file");
        const fileLabel = e("p", "lb-help", "Choose a lyric file up to 1 MB, or LyricBridge JSON / ZIP up to 64 MB decoded.");
        fileGroup.append(fileLabel);
        const feedback = e("div");
        const progress = e("p", "lb-help");
        progress.setAttribute("role", "status");
        const summary = e("p", "lb-version-metadata");
        const warnings = feedbackHost();
        warnings.hidden = true;
        const lyrics = e("div", "lb-version-preview lb-import-preview");
        lyrics.setAttribute("aria-label", "Uploaded lyrics preview");
        let generation = 0,
            reading = false,
            saving = false,
            playing = false;
        let draft: Draft | null = null,
            preview: UploadPreview | null = null;
        let request: AbortController | null = null;
        const live = () => d.scope() === target && d.panel() === panel && panel.isConnected;
        active = {
            canClose: () => !saving || !live(),
            dispose: () => {
                request?.abort();
                generation++;
            },
        };
        const stopPlayback = () => {
            if (playing) d.endPlaybackPreview();
            playing = false;
            playback.querySelector(".lb-action-label")!.textContent = "Playback preview";
        };
        const updateActions = () => {
            confirm.disabled = saving || !preview || reading;
            playback.disabled = saving || !preview || reading;
            choose.disabled = saving;
            encoding.disabled =
                saving || reading || ["lyricbridge", "bundle"].includes(format.value) || /\.(lyricbridge\.json|zip)$/i.test(draft?.fileName || "");
            format.disabled = saving || reading;
            setBusy(saving);
        };
        const fail = (error: unknown, retry?: () => unknown) => {
            d.notice(progress, "", "info");
            feedback.replaceChildren();
            d.showError(error, feedback, retry);
        };
        const validate = async () => {
            if (!draft || !live()) return;
            stopPlayback();
            request?.abort();
            request = new AbortController();
            const revision = ++generation,
                submitted = draft;
            preview = null;
            lyrics.replaceChildren();
            summary.textContent = "";
            d.feedback(warnings, { message: "" });
            feedback.replaceChildren();
            d.notice(progress, "Validating lyrics…", "progress");
            updateActions();
            try {
                const result = parsePreview(await d.api("items/" + target.itemId + "/import/preview", "POST", submitted, request.signal), d.defaults);
                if (!live() || revision !== generation || submitted !== draft) return;
                preview = result;
                d.feedback(warnings, {
                    message: result.warnings.length
                        ? `${result.warnings.length} import ${result.warnings.length === 1 ? "warning" : "warnings"}`
                        : "",
                    secondary: "Original text and supplied word times were preserved.",
                    severity: "warning",
                    details: result.warnings.map((warning) => (warning.location ? warning.location + ": " : "") + warning.message),
                });
                d.notice(progress, "Review the parsed lyrics before importing.", "info");
                summary.textContent = `${result.format} · ${result.encoding} · ${result.timing === "word" ? "Word timing" : result.timing === "line" ? "Line timing" : "Untimed lyrics"} · ${result.lineCount} lines`;
                if (["LyricBridge JSON", "LyricBridge ZIP"].includes(result.format) && result.document.timingCorrection) {
                    const overrides = result.document.songOverrides;
                    summary.textContent += ` · Saved timing correction: ${result.document.timingCorrection.seconds}s`;
                    summary.textContent += ` · Original language: ${overrides?.sourceLanguage || "Account default"}`;
                    summary.textContent += ` · Translation language: ${overrides?.translationLanguage || "Account default"}`;
                    summary.textContent += ` · Original script: ${overrides?.originalChineseScript || "Account default"}`;
                }
                const lines = result.document.lyrics?.lines || [];
                let rendered = 0;
                const more = button("Show more lyrics", () => renderMore());
                const renderMore = () => {
                    more.remove();
                    const next = Math.min(rendered + 100, lines.length);
                    for (const line of lines.slice(rendered, next)) {
                        const block = e("div", "lb-preview-line");
                        block.append(e("strong", "", line.text));
                        if (line.pronunciation) block.append(e("div", "lb-help", line.pronunciation));
                        for (const [language, text] of Object.entries(line.translations || {})) {
                            const row = e("div", "lb-help", text);
                            row.lang = language;
                            block.append(row);
                        }
                        if (line.background) {
                            block.append(e("div", "lb-help", line.background.text));
                            if (line.background.pronunciation) block.append(e("div", "lb-help", line.background.pronunciation));
                            for (const [language, text] of Object.entries(line.background.translations || {})) {
                                const row = e("div", "lb-help", text);
                                row.lang = language;
                                block.append(row);
                            }
                        }
                        lyrics.append(block);
                    }
                    rendered = next;
                    if (rendered < lines.length) lyrics.append(more);
                };
                renderMore();
            } catch (error) {
                if (live() && revision === generation) fail(error, validate);
            } finally {
                if (live() && revision === generation) updateActions();
            }
        };
        const encoding = select(
            fileGroup,
            "Text encoding",
            "auto",
            [
                ["auto", "Auto (UTF-8 / Unicode BOM)"],
                ["utf-8", "UTF-8"],
                ["utf-16le", "UTF-16 LE"],
                ["utf-16be", "UTF-16 BE"],
                ["gb18030", "GB18030"],
                ["big5", "Big5"],
                ["shift-jis", "Shift-JIS"],
                ["euc-kr", "EUC-KR"],
                ["windows-1252", "Windows-1252"],
            ],
            (value) => {
                if (draft) {
                    draft = Object.freeze({ ...draft, encoding: value });
                    void validate();
                }
            },
        );
        const format = select(
            fileGroup,
            "Format",
            "auto",
            [
                ["auto", "Auto"],
                ["txt", "TXT · Plain text"],
                ["lrc", "LRC"],
                ["elrc", "ELRC · Enhanced LRC"],
                ["lyricbridge", "LyricBridge JSON · Lossless"],
                ["bundle", "LyricBridge ZIP bundle"],
                ["qrc", "QRC"],
                ["krc", "KRC"],
                ["yrc", "YRC"],
                ["ttml", "TTML"],
                ["lyl", "Lyricify Lines"],
                ["lys", "Lyricify Syllable"],
            ],
            (value) => {
                updateActions();
                if (draft) {
                    draft = Object.freeze({ ...draft, format: value });
                    void validate();
                }
            },
        );
        const chooseFile = () => {
            const input = e("input");
            input.type = "file";
            input.accept = ".txt,.lrc,.elrc,.qrc,.krc,.yrc,.ttml,.xml,.json,.lys,.lyl,.zip";
            input.onchange = async () => {
                const file = input.files?.[0];
                if (!file || !live()) return;
                stopPlayback();
                request?.abort();
                const revision = ++generation;
                draft = null;
                preview = null;
                reading = true;
                feedback.replaceChildren();
                lyrics.replaceChildren();
                summary.textContent = "";
                d.feedback(warnings, { message: "" });
                fileLabel.textContent = file.name;
                d.notice(progress, "Reading file…", "progress");
                updateActions();
                try {
                    const native = /\.(lyricbridge\.json|zip)$/i.test(file.name) || ["lyricbridge", "bundle"].includes(format.value);
                    if (file.size > (native ? 64_000_000 : 1_000_000))
                        throw new Error(native ? "Choose a LyricBridge file up to 64 MB." : "Choose a lyric file up to 1 MB.");
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    if (!live() || revision !== generation) return;
                    let binary = "";
                    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
                    draft = Object.freeze({ fileName: file.name, fileBytes: btoa(binary), encoding: encoding.value, format: format.value });
                } catch (error) {
                    if (live() && revision === generation) fail(error);
                } finally {
                    if (live() && revision === generation) {
                        reading = false;
                        updateActions();
                        if (draft) void validate();
                    }
                }
            };
            input.click();
        };
        const choose = button("Choose another file", chooseFile, "", { icon: "import" });
        const confirm = button(
            "Import",
            async () => {
                if (!draft || !preview || saving || !live()) return;
                const submitted = draft;
                saving = true;
                feedback.replaceChildren();
                d.notice(progress, "Importing lyrics…", "progress");
                updateActions();
                try {
                    await d.api("items/" + target.itemId + "/import", "POST", submitted);
                    if (!live()) return;
                    saving = false;
                    d.saved();
                    await d.finishWorkflow();
                    if (d.scope() === target) d.status("Local lyrics selected");
                } catch (error) {
                    if (live()) fail(error);
                } finally {
                    if (live()) {
                        saving = false;
                        updateActions();
                    }
                }
            },
            "lb-primary",
            { icon: "check" },
        );
        const playback = button(
            "Playback preview",
            () => {
                if (!preview || !live()) return;
                if (playing) stopPlayback();
                else {
                    playing = true;
                    playback.querySelector(".lb-action-label")!.textContent = "Stop playback preview";
                    d.startPlaybackPreview(preview.document, "Uploaded lyrics playback preview", [
                        button("Return to upload preview", stopPlayback, "", { icon: "back" }),
                        button("Cancel import", cancel, "", { icon: "close" }),
                    ]);
                }
            },
            "",
            { icon: "preview" },
        );
        actions.append(choose, playback, confirm);
        body.append(fileGroup, summary, lyrics);
        feedbackArea.append(progress, feedback, warnings);
        d.mount(panel);
        d.updatePanelBounds();
        updateActions();
        chooseFile();
    }
    return {
        open,
        canClose: () => active?.canClose() ?? true,
        dispose: () => {
            active?.dispose();
            active = null;
        },
    };
}
