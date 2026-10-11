import { auxiliary } from "./auxiliary.ts";
import type { BridgeDocument } from "./contracts.ts";
export function sourceUsage(doc: BridgeDocument | null) {
    const result = new Map<string, Map<string, boolean>>();
    if (!doc?.lyrics) return new Map<string, string[]>();
    const key = (origin: { source?: string; providerId?: string } | null | undefined) =>
        origin?.source && origin?.providerId ? origin.source + ":" + origin.providerId : null;
    const original = { source: doc.lyrics.source, providerId: doc.lyrics.providerId };
    const add = (origin: { source?: string; providerId?: string } | null | undefined, kind: string, visible: boolean) => {
        const id = key(origin);
        if (!id) return;
        let kinds = result.get(id);
        if (!kinds) {
            kinds = new Map();
            result.set(id, kinds);
        }
        kinds.set(kind, kinds.get(kind) || false || visible);
    };
    add(original, "Original", true);
    const p = doc.preferences;
    const variants = new Map((doc.variants || []).map((v) => [v.key, v]));
    for (const line of doc.lyrics.lines.flatMap((line) => (line.background ? [line, line.background] : [line])))
        for (const kind of ["pronunciation", "translation"] as const) {
            const value = auxiliary(line, kind, p, doc);
            if (!value?.text) continue;
            const variant = variants.get(value.key);
            const origin = value.key === "provider" ? original : variant?.origin;
            const visible =
                kind === "translation"
                    ? p.showTranslation
                    : p.showPronunciation && ((p.sourceLanguage === "auto" ? line.language : p.sourceLanguage) !== "ja" || p.japaneseRomaji);
            add(origin, kind === "translation" ? "Translation" : "Pronunciation", visible);
        }
    return new Map(
        [...result].map(([id, kinds]) => [
            id,
            ["Original", "Pronunciation", "Translation"]
                .filter((kind) => kinds.has(kind))
                .map((kind) => kind + (kinds.get(kind) ? " in use" : " selected · hidden")),
        ]),
    );
}
