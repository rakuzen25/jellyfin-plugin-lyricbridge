import type { LyricLine, RichLyrics } from "../../contracts/lyrics.ts";
import type { AuxiliaryDocument, AuxiliaryKind, Preferences, Variant } from "../../contracts/preferences.ts";
function variantLabel(v: Variant) {
    return (
        (v.optionName || v.service) +
        (v.model ? " · " + v.model : "") +
        (v.reasoningEffort ? " · " + v.reasoningEffort : "") +
        (v.createdAt ? " · " + new Date(v.createdAt).toLocaleString() : " · saved version")
    );
}
// Test visibility without changing Unicode shaping or the stored provider text.
export function hasAuxiliaryText(text: unknown): text is string {
    return typeof text === "string" && /[^\s\u200B-\u200F\u2060\u2066-\u2069\uFEFF]/u.test(text);
}
export function translationScript(p: Pick<Preferences, "translationLanguage">) {
    return /^(zh-Hant|zh-TW|zh-HK)(-|$)/i.test(p.translationLanguage) ? "Traditional" : "Simplified";
}
export function translationLanguageMatches(language: string | undefined, target: string) {
    return language === target || (language?.split("-")[0] === "zh" && target.split("-")[0] === "zh");
}
export function rowLanguage(language: string | undefined, script: string, text: string, pronunciation = false) {
    let tag;
    try {
        tag = Intl.getCanonicalLocales(language || "und")[0] || "und";
    } catch {
        tag = "und";
    }
    const primary = tag.split("-")[0];
    if (pronunciation || primary === "und") {
        const letters = [...(text || "")].filter((char) => /\p{L}/u.test(char));
        if (letters.length && letters.every((char) => /\p{Script=Latin}/u.test(char))) return primary + "-Latn";
    }
    if (primary === "zh") return script === "Traditional" ? "zh-Hant" : "zh-Hans";
    return tag;
}
function embeddedText(line: LyricLine, kind: AuxiliaryKind, language: string) {
    let supplied = kind === "pronunciation" ? line.pronunciation : line.translations?.[language];
    if (!hasAuxiliaryText(supplied) && kind === "translation") {
        const key = Object.keys(line.translations || {}).find(
            (k) => k.split("-")[0] === language.split("-")[0] && hasAuxiliaryText(line.translations?.[k]),
        );
        supplied = key ? line.translations?.[key] : undefined;
    }
    return hasAuxiliaryText(supplied) ? supplied : null;
}
export function hasEmbeddedVersion(lyrics: RichLyrics | null | undefined, kind: AuxiliaryKind, language: string) {
    return !!lyrics?.lines.some((line) => embeddedText(line, kind, language) || (line.background && embeddedText(line.background, kind, language)));
}
// Responses replace lyric objects; cache availability so rendering each row remains linear overall.
const embeddedAvailability = new WeakMap<RichLyrics, { lines: LyricLine[]; choices: Map<string, boolean> }>();
export function effectiveAuxiliaryChoice(doc: AuxiliaryDocument, kind: AuxiliaryKind, p: Preferences) {
    const selected = doc.auxiliaryChoices?.[kind] || "auto";
    if (selected !== "provider") return selected;
    if (!doc.lyrics) return "auto";
    let cached = embeddedAvailability.get(doc.lyrics);
    if (!cached || cached.lines !== doc.lyrics.lines) {
        cached = { lines: doc.lyrics.lines, choices: new Map() };
        embeddedAvailability.set(doc.lyrics, cached);
    }
    const key = kind + ":" + (kind === "translation" ? p.translationLanguage : "");
    if (!cached.choices.has(key)) cached.choices.set(key, hasEmbeddedVersion(doc.lyrics, kind, p.translationLanguage));
    return cached.choices.get(key) ? selected : "auto";
}
export function auxiliary(line: LyricLine, kind: AuxiliaryKind, p: Preferences, doc: AuxiliaryDocument | null) {
    if (!doc?.lyrics) return null;
    const shared = doc.resolvedAuxiliary;
    const useShared =
        shared &&
        shared.translationLanguage === p.translationLanguage &&
        shared.sourceLanguage === p.sourceLanguage &&
        shared.originalChineseScript === p.originalChineseScript &&
        shared.choices[kind] === effectiveAuxiliaryChoice(doc, kind, p);
    const resolved = useShared ? shared[kind][line.id] : undefined;
    if (useShared && !resolved) return null;
    const selected = resolved?.key || effectiveAuxiliaryChoice(doc, kind, p);
    const supplied = embeddedText(line, kind, p.translationLanguage);
    const provided = hasAuxiliaryText(supplied) ? { text: supplied, provenance: "Provided by " + doc.lyrics.source, key: "provider" } : null;
    if (selected === "provider")
        return resolved ? { text: resolved.text, key: resolved.key, provenance: "Provided by " + doc.lyrics.source } : provided;
    const matches = (doc.variants || []).filter(
        (v) =>
            v.kind === kind &&
            (kind === "pronunciation" || translationLanguageMatches(v.language, p.translationLanguage)) &&
            hasAuxiliaryText(v.text[line.id]),
    );
    if (selected === "auto" && provided) return provided;
    const variant =
        selected !== "auto"
            ? matches.find((v) => v.key === selected)
            : kind === "pronunciation"
              ? matches.find((v) => v.service === "Kawazu")
              : matches[0];
    if (variant)
        return {
            text: resolved?.text ?? variant.text[line.id]!,
            key: variant.key,
            provenance:
                variant.originType === "supplied"
                    ? "Supplied by " + variant.service
                    : variant.service === "Kawazu"
                      ? "Generated locally · Kawazu"
                      : "Generated · " +
                        variantLabel(variant) +
                        (kind === "translation" && (variant.contextBefore || variant.contextAfter)
                            ? " · context " + (variant.contextBefore || 0) + " before / " + (variant.contextAfter || 0) + " after"
                            : ""),
        };
    return selected === "auto" ? provided : null;
}
