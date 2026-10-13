import { requireValue } from "../shared/invariants.ts";
import { button, e, icon } from "./controls.ts";
import type { AuxiliaryKind } from "./models.ts";

interface VersionRow {
    key: string;
    kind: AuxiliaryKind | "original";
    name: string;
    description: string;
    details: string[];
    toggle: () => void;
}
/** Version provenance and actions share one frame; metadata is already expanded. */
export function versionRow(version: VersionRow) {
    const row = e("article", "lb-version-row lb-frame");
    row.dataset.key = version.key;
    row.setAttribute("aria-label", version.name + " " + version.kind + " version");
    const heading = button("", version.toggle, "lb-version-toggle");
    const summary = e("span", "lb-version-summary");
    summary.append(e("strong", "", version.name), e("small", "lb-provenance", version.description));
    heading.append(icon("chevron"), summary, e("span", "lb-active-label lb-status-badge"));
    heading.setAttribute("aria-label", version.name + " " + version.kind + " version");
    const content = e("div", "lb-version-content");
    content.id = "lb-version-" + version.kind + "-" + encodeURIComponent(version.key);
    heading.setAttribute("aria-controls", content.id);
    for (const detail of version.details.filter(Boolean)) content.append(e("p", "lb-version-metadata", detail));
    row.append(heading, content);
    return { row, heading, content };
}
export function updateVersionRow(row: HTMLElement, active: boolean, expanded: boolean, effectiveUsage?: string) {
    row.dataset.active = String(active);
    requireValue(row.querySelector<HTMLElement>(".lb-active-label")).textContent = active ? "In use" : effectiveUsage || "";
    requireValue(row.querySelector<HTMLElement>(".lb-version-toggle")).setAttribute("aria-expanded", String(expanded));
    requireValue(row.querySelector<HTMLElement>(".lb-version-content")).hidden = !expanded;
    const use = row.querySelector<HTMLButtonElement>(".lb-use-version");
    if (use) use.disabled = active;
    const preview = row.querySelector<HTMLButtonElement>(".lb-preview-version");
    if (preview) preview.disabled = active || !!effectiveUsage || preview.dataset.loading === "true";
}
