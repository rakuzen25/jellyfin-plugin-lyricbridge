import type { FeedbackOptions } from "../shared/feedback.ts";
import { feedbackHost } from "./feedback.ts";
import { button, disclosure, e, section, select, toggle } from "./controls.ts";
import { createDialog } from "./dialog.ts";
import { isRecord } from "../shared/invariants.ts";
import { BridgeRequestError, parseRequestIssues, type RequestIssue } from "./api.ts";
import type { BridgeDocument, TrackScope } from "./contracts.ts";

interface Preview {
    fileName: string;
    fingerprint: string;
    files: { fileName: string; text: string; bytes: number }[];
    warnings: RequestIssue[];
    hasTranslation: boolean;
    hasPronunciation: boolean;
}
interface Dependencies {
    scope(): TrackScope | null;
    panel(): HTMLElement | null;
    documentState(): BridgeDocument;
    mount(panel: HTMLElement): void;
    beginWorkflow(): boolean;
    closeSearch(): void;
    api(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<unknown>;
    feedback(node: HTMLElement, options: FeedbackOptions): void;
    updatePanelBounds(): void;
}
export function parseExportPreview(value: unknown): Preview {
    if (
        !isRecord(value) ||
        typeof value.fileName !== "string" ||
        typeof value.fingerprint !== "string" ||
        typeof value.hasTranslation !== "boolean" ||
        typeof value.hasPronunciation !== "boolean" ||
        !Array.isArray(value.files)
    )
        throw new Error("The server returned an invalid export preview.");
    const warnings = parseRequestIssues(value.warnings);
    if (!warnings) throw new Error("The server returned invalid export warnings.");
    const files = value.files.map((file: unknown) => {
        if (
            !isRecord(file) ||
            typeof file.fileName !== "string" ||
            typeof file.text !== "string" ||
            typeof file.bytes !== "number" ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0
        )
            throw new Error("The server returned an invalid export file.");
        return { fileName: file.fileName, text: file.text, bytes: file.bytes };
    });
    return {
        fileName: value.fileName,
        fingerprint: value.fingerprint,
        files,
        warnings,
        hasTranslation: value.hasTranslation,
        hasPronunciation: value.hasPronunciation,
    };
}
export function createExportPanel(d: Dependencies) {
    let active: { dispose(): void } | null = null;
    function open() {
        if (!d.beginWorkflow()) return;
        const target = d.scope();
        if (!target || !d.documentState().lyrics?.lines.length) return;
        const { root, body, feedback, footer } = createDialog({ label: "Export lyrics", className: "lb-export-panel", onClose: d.closeSearch });
        const options = section("Export options");
        const status = feedbackHost();
        const warnings = feedbackHost();
        const files = section("Files");
        const summary = files.querySelector<HTMLElement>(".lb-section-title")!;
        feedback.append(status);
        footer.append(warnings);
        let format = d
            .documentState()
            .lyrics?.lines.some((l) => l.start != null || !!l.cues?.length || l.background?.start != null || !!l.background?.cues?.length)
            ? "lrc"
            : "txt";
        let layout = "original",
            translation = false,
            pronunciation = false,
            losslessCopy = true;
        let availableTranslation = false,
            availablePronunciation = false;
        let preview: Preview | null = null,
            revision = 0,
            downloading = false;
        let controller: AbortController | null = null;
        const urls = new Set<string>();
        const live = () => d.scope() === target && d.panel() === root && root.isConnected;
        const abort = () => active?.dispose();
        active = {
            dispose() {
                controller?.abort();
                revision++;
                target.controller.signal.removeEventListener("abort", abort);
                for (const url of urls) URL.revokeObjectURL(url);
                urls.clear();
                active = null;
            },
        };
        target.controller.signal.addEventListener("abort", abort, { once: true });
        const input = () => ({ format, layout, translation, pronunciation, losslessCopy });
        const download = button(
            "Download",
            () => {
                void save();
            },
            "",
            { appearance: "primary", icon: "export" },
        );
        footer.append(download);
        const formatSelect = select(
            options,
            "Format",
            format,
            [
                ["txt", "TXT · Plain text"],
                ["lrc", "LRC · Line timing"],
                ["elrc", "Enhanced LRC · Word timing"],
                ["lyricbridge", "LyricBridge JSON · Lossless"],
            ],
            (value) => {
                format = value;
                if (format === "lyricbridge" || (layout === "interleaved" && format !== "txt")) layout = "original";
                layoutSelect.value = layout;
                updateControls();
                void validate();
            },
        );
        const layoutSelect = select(
            options,
            "File layout",
            layout,
            [
                ["original", "Original lyrics only"],
                ["interleaved", "Interleaved translation / pronunciation"],
                ["zip", "ZIP with companion files"],
            ],
            (value) => {
                layout = value;
                updateControls();
                void validate();
            },
        );
        const translationToggle = toggle(options, "Include current translation", translation, (value) => {
            translation = value;
            void validate();
        });
        const pronunciationToggle = toggle(options, "Include current pronunciation", pronunciation, (value) => {
            pronunciation = value;
            void validate();
        });
        const losslessToggle = toggle(
            options,
            "Include lossless copy",
            losslessCopy,
            (value) => {
                losslessCopy = value;
                void validate();
            },
            "Contains the complete selected lyrics, translation and pronunciation, even when companion files are unchecked.",
        );
        const losslessHelp = e("p", "lb-help", "Preserves the complete selected lyrics and saved language and timing settings.");
        options.append(losslessHelp);
        function updateControls() {
            const native = format === "lyricbridge";
            layoutSelect.parentElement!.hidden = native;
            for (const option of layoutSelect.options)
                if (option.value === "interleaved") {
                    option.hidden = format !== "txt";
                    option.disabled = format !== "txt";
                }
            translationToggle.parentElement!.hidden = native || layout === "original";
            pronunciationToggle.parentElement!.hidden = native || layout === "original";
            losslessToggle.parentElement!.hidden = layout !== "zip";
            losslessHelp.hidden = !native;
            formatSelect.disabled = downloading;
            layoutSelect.disabled = downloading;
            translationToggle.disabled = downloading || !availableTranslation;
            pronunciationToggle.disabled = downloading || !availablePronunciation;
            losslessToggle.disabled = downloading;
        }
        const fileViews = new Map<string, { root: HTMLDetailsElement; heading: HTMLElement; text: HTMLPreElement }>();
        function renderFiles(result: Preview) {
            summary.textContent = `Files · ${result.files.length} ${result.files.length === 1 ? "file" : "files"} · ${readableBytes(result.files.reduce((sum, file) => sum + file.bytes, 0))}`;
            for (const [name, view] of fileViews)
                if (!result.files.some((file) => file.fileName === name)) {
                    view.root.remove();
                    fileViews.delete(name);
                }
            for (const file of result.files) {
                let view = fileViews.get(file.fileName);
                if (!view) {
                    const detail = disclosure(file.fileName, "lb-export-file", false);
                    const text = e("pre", "lb-export-text");
                    text.tabIndex = 0;
                    detail.content.append(text);
                    view = { root: detail.root, heading: detail.root.querySelector(".lb-disclosure-title")!, text };
                    fileViews.set(file.fileName, view);
                    files.append(detail.root);
                }
                const role = /\.translation(?:\.|$)/.test(file.fileName)
                    ? "Translation"
                    : /\.pronunciation(?:\.|$)/.test(file.fileName)
                      ? "Pronunciation"
                      : file.fileName.endsWith(".lyricbridge.json")
                        ? "Lossless copy"
                        : "Original";
                view.heading.textContent = `${file.fileName} · ${role} · ${readableBytes(file.bytes)}`;
                if (view.text.textContent !== file.text) view.text.textContent = file.text;
            }
        }
        function fail(error: unknown) {
            if (error instanceof Error && error.name === "AbortError") return;
            const details = error instanceof BridgeRequestError ? error.details : null;
            d.feedback(status, {
                message: error instanceof Error ? error.message : "The export could not complete.",
                severity: "error",
                details: [
                    ...(details?.diagnosticId ? ["Diagnostic: " + details.diagnosticId] : []),
                    ...(details?.issues?.map((issue) => issue.message) || []),
                ],
                actions: [{ label: "Refresh preview", run: () => validate() }],
            });
        }
        async function validate() {
            controller?.abort();
            controller = new AbortController();
            const ticket = ++revision;
            preview = null;
            download.disabled = true;
            files.setAttribute("aria-busy", "true");
            d.feedback(status, { message: "Preparing export preview…", severity: "progress" });
            d.feedback(warnings, { message: "" });
            try {
                const result = parseExportPreview(await d.api("items/" + target!.itemId + "/export/preview", "POST", input(), controller.signal));
                if (!live() || ticket !== revision) return;
                preview = result;
                availableTranslation = result.hasTranslation;
                availablePronunciation = result.hasPronunciation;
                updateControls();
                renderFiles(result);
                d.feedback(status, { message: "" });
                d.feedback(warnings, {
                    message: result.warnings.length
                        ? `${result.warnings.length} format ${result.warnings.length === 1 ? "limitation" : "limitations"}`
                        : "",
                    secondary: "Download accepts these limitations.",
                    severity: "warning",
                    details: result.warnings.map((w) => w.message),
                });
                download.disabled = false;
            } catch (error) {
                if (live() && ticket === revision) fail(error);
            } finally {
                if (live() && ticket === revision) {
                    files.setAttribute("aria-busy", "false");
                    d.updatePanelBounds();
                }
            }
        }
        async function save() {
            if (!preview || downloading) return;
            downloading = true;
            download.disabled = true;
            updateControls();
            const ticket = revision;
            try {
                const blob = await d.api(
                    "items/" + target!.itemId + "/export",
                    "POST",
                    { ...input(), fingerprint: preview.fingerprint },
                    controller?.signal,
                );
                if (!live() || ticket !== revision) return;
                if (!(blob instanceof Blob)) throw new Error("The server returned an invalid download.");
                const url = URL.createObjectURL(blob);
                urls.add(url);
                const anchor = e("a");
                anchor.href = url;
                anchor.download = preview.fileName;
                root.append(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                    urls.delete(url);
                }, 1000);
                d.feedback(status, { message: "Download started.", severity: "success" });
            } catch (error) {
                if (live()) {
                    d.feedback(warnings, { message: "" });
                    fail(error);
                    preview = null;
                }
            } finally {
                downloading = false;
                if (live()) {
                    updateControls();
                    download.disabled = !preview;
                }
            }
        }
        updateControls();
        body.append(options, files);
        d.mount(root);
        formatSelect.focus({ preventScroll: true });
        d.updatePanelBounds();
        void validate();
    }
    return { open, dispose: () => active?.dispose() };
}
function readableBytes(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`;
    return `${(bytes / (bytes < 1_000_000 ? 1000 : 1_000_000)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${bytes < 1_000_000 ? "KB" : "MB"}`;
}
