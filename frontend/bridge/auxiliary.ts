import type { LyricLine } from "../shared/lyrics.ts";
import type { AuxiliaryDocument, AuxiliaryKind, Preferences, Variant } from "./models.ts";
function variantLabel(v: Variant) {
    return (
        v.service +
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
export function auxiliary(line: LyricLine, kind: AuxiliaryKind, p: Preferences, doc: AuxiliaryDocument | null) {
    if (!doc?.lyrics) return null;
    const selected = doc.auxiliaryChoices?.[kind] || "auto";
    let supplied = kind === "pronunciation" ? line.pronunciation : line.translations?.[p.translationLanguage];
    if (!hasAuxiliaryText(supplied) && kind === "translation") {
        const key = Object.keys(line.translations || {}).find(
            (k) => k.split("-")[0] === p.translationLanguage.split("-")[0] && hasAuxiliaryText(line.translations?.[k]),
        );
        supplied = key ? line.translations?.[key] : undefined;
    }
    const provided = hasAuxiliaryText(supplied) ? { text: supplied, provenance: "Provided by " + doc.lyrics.source, key: "provider" } : null;
    if (selected === "provider") return provided;
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
            text: variant.text[line.id]!,
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
