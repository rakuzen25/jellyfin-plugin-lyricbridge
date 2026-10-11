import type { LyricLine, NativeLine, RichLyrics } from "../shared/lyrics.ts";
import { rows } from "../shared/lyrics.ts";
import { auxiliary, hasAuxiliaryText, rowLanguage, translationScript } from "./auxiliary.ts";
import { e } from "./controls.ts";
import type { AuxiliaryDocument, AuxiliaryKind, Preferences } from "./models.ts";
interface DecoratedDocument extends AuxiliaryDocument {
    preferences?: Partial<Preferences>;
}
interface RowIdentity {
    LyricBridgeId?: string;
    lyricBridgeId?: string;
}
interface DecorationOptions {
    defaults: Preferences;
    current(): DecoratedDocument | null;
    decorated(): void;
    ensureTools(): void;
}
/** Owns the row identity index and auxiliary DOM; playback scheduling stays outside. */
export function createLyricDecoration(options: DecorationOptions) {
    let mapDocument: RichLyrics | null | undefined;
    let lineMap = new Map<string, LyricLine>();
    let flatRows: NativeLine[] = [];
    function index(doc: RichLyrics | null | undefined) {
        if (mapDocument === doc) return;
        mapDocument = doc;
        lineMap = new Map();
        for (const l of doc?.lines || []) {
            lineMap.set(l.id, l);
            if (l.background) lineMap.set(l.background.id, l.background);
        }
        flatRows = rows(doc);
    }
    function decorate(elements: HTMLElement[], payloads?: readonly RowIdentity[], doc = options.current()) {
        if (!doc?.lyrics) return;
        options.decorated();
        let changed = false;
        const p = { ...options.defaults, ...doc.preferences };
        index(doc.lyrics);
        elements.forEach((node, i) => {
            const payload = payloads?.[i],
                id = payload?.LyricBridgeId || payload?.lyricBridgeId || flatRows[i]?.LyricBridgeId,
                line = id ? lineMap.get(id) : undefined;
            if (!line) return;
            if (!node.classList.contains("lb-block")) changed = true;
            node.classList.add("lb-block");
            node.dir = "auto";
            const originalLanguage = p.sourceLanguage === "auto" ? line.language : p.sourceLanguage;
            const languageTag = rowLanguage(originalLanguage, p.originalChineseScript, line.text);
            if (node.lang !== languageTag) {
                node.lang = languageTag;
                changed = true;
            }
            // Keep timed/untimed original runs explicit when LyricMotion rebuilds them.
            node.querySelectorAll<HTMLElement>(":scope > .ak-word, :scope > .ak-untimed").forEach((run) => {
                if (run.lang !== languageTag) run.lang = languageTag;
            });
            for (const [name, value] of [
                ["--lb-original-size", p.originalSize + "px"],
                ["--lb-row-spacing", p.rowSpacing + "px"],
            ] as const) {
                if (node.style.getPropertyValue(name) !== value) {
                    node.style.setProperty(name, value);
                    changed = true;
                }
            }
            const wanted: { kind: AuxiliaryKind; text: string; provenance: string; key: string }[] = [];
            for (const kind of (p.rowOrder === "translation-first"
                ? ["translation", "pronunciation"]
                : ["pronunciation", "translation"]) as AuxiliaryKind[]) {
                if (
                    (kind === "translation" && !p.showTranslation) ||
                    (kind === "pronunciation" &&
                        (!p.showPronunciation || ((p.sourceLanguage === "auto" ? line.language : p.sourceLanguage) === "ja" && !p.japaneseRomaji)))
                )
                    continue;
                const value = auxiliary(line, kind, p, doc);
                if (value && hasAuxiliaryText(value.text)) wanted.push({ kind, ...value });
            }
            const signature = JSON.stringify(
                wanted.map((v) => [
                    v.kind,
                    v.text,
                    v.provenance,
                    originalLanguage,
                    p.translationLanguage,
                    p.originalChineseScript,
                    translationScript(p),
                    p.pronunciationSize,
                    p.translationSize,
                ]),
            );
            if (node.dataset.lbSignature === signature && node.querySelectorAll(":scope > .lb-aux").length === wanted.length) return;
            changed = true;
            node.dataset.lbSignature = signature;
            node.querySelectorAll(":scope > .lb-aux").forEach((n) => n.remove());
            for (const value of wanted) {
                const row = e("div", "lb-aux lb-" + value.kind, value.text);
                row.dir = "auto";
                row.lang = rowLanguage(
                    value.kind === "translation" ? p.translationLanguage : originalLanguage,
                    value.kind === "translation" ? translationScript(p) : p.originalChineseScript,
                    value.text,
                    value.kind === "pronunciation",
                );
                row.title = value.provenance;
                row.dataset.provenance = value.provenance;
                row.style.setProperty("--lb-aux-size", (value.kind === "translation" ? p.translationSize : p.pronunciationSize) + "px");
                node.append(row);
            }
        });
        options.ensureTools();
        return changed;
    }
    return {
        index,
        decorate,
        get rows() {
            return flatRows;
        },
    };
}
