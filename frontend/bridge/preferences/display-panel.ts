import { requireValue } from "../../shared/invariants.ts";
import { rendererPort } from "../transport/renderer-port.ts";

import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { AuxiliaryKind, Preferences } from "../../contracts/preferences.ts";
import { rowLanguage, translationScript } from "../lyrics/auxiliary.ts";
import { disclosure, e, field, section, select, toggle } from "../ui/controls.ts";
interface Context {
    current: BridgeDocument | null;
    popup: HTMLElement | null;
}
interface Dependencies {
    context: Context;
    accountPreferences: () => {
        translationLanguage: string;
        sourceLanguage: string;
        showTranslation: boolean;
        showPronunciation: boolean;
        japaneseRomaji: boolean;
        originalChineseScript: string;
        romanizationSystem: string;
        rowOrder: string;
        originalSize: number;
        pronunciationSize: number;
        translationSize: number;
        rowSpacing: number;
    };
    languageChoices: [string, string][];
    preference: (key: keyof Preferences, value: Preferences[keyof Preferences]) => void;
    defaults: Preferences;
}
export function createDisplayPanel(dependencies: Dependencies) {
    const { context, accountPreferences, languageChoices, preference, defaults } = dependencies;
    function buildDisplay(parent: HTMLElement) {
        const p = accountPreferences();
        const expanded = [...parent.querySelectorAll<HTMLDetailsElement>("details[open]")].map(
            (n) => n.querySelector(".lb-disclosure-title")?.textContent,
        );
        const focused = parent.contains(document.activeElement) ? document.activeElement?.getAttribute("aria-label") : null;
        parent.replaceChildren();
        function group(title: string, key: string) {
            const group = section(title);
            group.dataset.group = key;
            parent.append(group);
            return group;
        }
        const original = group("Original lyrics", "original");
        select(
            original,
            "Original language",
            p.sourceLanguage,
            [["auto", "Auto (detect from lyrics)"], ...languageChoices.filter((c) => !c[0].startsWith("zh-")), ["zh", "Chinese"]],
            (v) => {
                preference("sourceLanguage", v);
                buildDisplay(parent);
            },
        );
        const pronunciation = group("Pronunciation", "pronunciation");
        toggle(pronunciation, "Show pronunciation", p.showPronunciation, (v) => preference("showPronunciation", v));
        const translation = group("Translation", "translation");
        toggle(translation, "Show translation", p.showTranslation, (v) => preference("showTranslation", v));
        select(translation, "Translation language", p.translationLanguage, languageChoices, (v) => {
            preference("translationLanguage", v);
            buildDisplay(parent);
        });
        for (const section of [original, translation, pronunciation]) section.append(e("div", "lb-group-language"));
        parent.append(e("div", "lb-language-options"));
        updateLanguageOptions(parent);
        const layoutDisclosure = disclosure("Text sizes and layout");
        parent.append(layoutDisclosure.root);
        const layout = layoutDisclosure.content;
        select(
            layout,
            "Auxiliary row order",
            p.rowOrder,
            [
                ["pronunciation-first", "Pronunciation → translation"],
                ["translation-first", "Translation → pronunciation"],
            ],
            (v) => preference("rowOrder", v),
        );
        for (const [key, label, min, max] of [
            ["originalSize", "Original size", 12, 100],
            ["pronunciationSize", "Pronunciation size", 10, 80],
            ["translationSize", "Translation size", 10, 80],
            ["rowSpacing", "Row spacing", 0, 50],
        ] satisfies [keyof Preferences, string, number, number][]) {
            const input = e("input");
            input.type = "number";
            input.min = String(min);
            input.max = String(max);
            input.value = String(p[key]);
            input.onchange = () => preference(key, Number(input.value));
            field(layout, label, input);
        }
        const renderer = rendererPort();
        if (renderer?.setRenderQuality && renderer.renderQuality) {
            const rendering = layout;
            select(
                rendering,
                "Rendering quality",
                renderer.renderQuality(),
                [
                    ["standard", "Standard"],
                    ["low-power", "Low power"],
                ],
                (value) => {
                    renderer.setRenderQuality?.(value === "low-power" ? "low-power" : "standard");
                },
            );
            rendering.append(e("p", "lb-hint", "Low power uses stationary artwork and simpler lyric effects. Saved for this browser."));
        }
        const preview = e("div", "lb-live-preview");
        parent.append(preview, e("p", "lb-save-status", ""));
        updateLivePreview();
        parent
            .querySelectorAll<HTMLDetailsElement>("details")
            .forEach((n) => (n.open = expanded.includes(n.querySelector(".lb-disclosure-title")?.textContent)));
        if (focused)
            [...parent.querySelectorAll<HTMLElement>("[aria-label]")]
                .find((n) => n.getAttribute("aria-label") === focused)
                ?.focus({ preventScroll: true });
    }
    function originalLanguages() {
        const configured = context.current?.preferences?.sourceLanguage || "auto";
        const detected =
            context.current?.detectedLanguages ||
            context.current?.lyrics?.lines.flatMap((line) => (line.background ? [line.language, line.background.language] : [line.language])) ||
            [];
        return new Set((configured === "auto" ? detected : [configured]).filter(Boolean).map((language) => requireValue(language).split("-")[0]));
    }
    function updateLanguageOptions(parent: HTMLElement | null | undefined) {
        if (!parent) return;
        const p = { ...defaults, ...context.current?.preferences },
            host = parent.querySelector<HTMLElement>(".lb-language-options");
        if (!host) return;
        const automatic =
            context.current?.detectedLanguages ||
            context.current?.lyrics?.lines.flatMap((l) => (l.background ? [l.language, l.background.language] : [l.language])) ||
            [];
        const detected = new Set(p.sourceLanguage === "auto" ? automatic : [p.sourceLanguage]);
        const unknown = p.sourceLanguage === "auto" && (!detected.size || [...detected].every((l) => l === "und"));
        const signature = JSON.stringify([
            p.sourceLanguage,
            p.translationLanguage,
            [...detected],
            p.japaneseRomaji,
            p.romanizationSystem,
            p.originalChineseScript,
            translationScript(p),
        ]);
        if (host.dataset.signature === signature) return;
        host.dataset.signature = signature;
        const expanded = host.querySelector("details")?.open;
        host.replaceChildren();
        parent.querySelectorAll<HTMLElement>(".lb-group-language").forEach((n) => n.replaceChildren());
        const options = unknown ? disclosure("Language-specific options") : null;
        const language = options?.content || e("div");
        if (options) options.root.open = !!expanded;
        host.append(options?.root || language);
        const groupLanguage = (kind: AuxiliaryKind | "original") =>
            unknown ? language : parent.querySelector<HTMLElement>('[data-group="' + kind + '"] .lb-group-language') || language;
        if (unknown || [...detected].some((l) => requireValue(l).split("-")[0] === "ja")) {
            toggle(groupLanguage("pronunciation"), "Japanese romaji", p.japaneseRomaji, (v) => preference("japaneseRomaji", v));
            select(
                groupLanguage("pronunciation"),
                "Romanization",
                p.romanizationSystem,
                [
                    ["Hepburn", "Hepburn"],
                    ["Passport", "Passport"],
                    ["Nippon", "Nippon"],
                ],
                (v) => preference("romanizationSystem", v),
            );
        }
        if (unknown || [...detected].some((l) => requireValue(l).startsWith("zh")))
            select(
                groupLanguage("original"),
                "Chinese original text",
                p.originalChineseScript,
                [
                    ["Simplified", "Simplified"],
                    ["Traditional", "Traditional"],
                ],
                (v) => preference("originalChineseScript", v),
            );
    }
    function updateLivePreview() {
        const preview = context.popup?.querySelector<HTMLElement>(".lb-live-preview");
        if (!preview) return;
        const p = accountPreferences();
        preview.replaceChildren();
        const original = e("strong", "", "朝の光");
        original.lang = "ja";
        original.style.fontSize = p.originalSize + "px";
        preview.append(original);
        for (const kind of p.rowOrder === "translation-first" ? ["translation", "pronunciation"] : (["pronunciation", "translation"] as const)) {
            if ((kind === "translation" && !p.showTranslation) || (kind === "pronunciation" && (!p.showPronunciation || !p.japaneseRomaji))) continue;
            const row = e("div", "", kind === "translation" ? "晨光" : "asa no hikari");
            row.lang = kind === "translation" ? rowLanguage("zh", translationScript(p), row.textContent) : "ja-Latn";
            row.style.fontSize = (kind === "translation" ? p.translationSize : p.pronunciationSize) + "px";
            row.style.marginTop = p.rowSpacing + "px";
            preview.append(row);
        }
    }

    return { buildDisplay, originalLanguages, updateLanguageOptions, updateLivePreview };
}
