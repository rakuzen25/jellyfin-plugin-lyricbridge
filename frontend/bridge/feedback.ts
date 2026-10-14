import { type FeedbackAdapter, type FeedbackAction, type FeedbackSeverity } from "../shared/feedback.ts";
import type { IconName } from "../shared/icons.ts";
import { button, e, icon } from "./controls.ts";
/** Card surfaces belong to the glass presentation, not individual features. */
export function feedbackHost(kind: "notice" | "confirmation" = "notice") {
    return e("div", kind === "confirmation" ? "lb-confirmation" : "lb-feedback");
}
export const glassFeedback: FeedbackAdapter = {
    presentation(root) {
        root.classList.add("lb-feedback-element");
        const glyph = e("span", "lb-feedback-icon");
        const message = e("span", "lb-feedback-message");
        const secondary = e("span", "lb-feedback-secondary");
        const actions = e("div", "lb-notice-actions");
        const diagnostics = e("div", "lb-feedback-diagnostics");
        root.replaceChildren(glyph, message, secondary, diagnostics, actions);
        return {
            message,
            secondary,
            actions,
            diagnostics,
            severity(value) {
                if (glyph.dataset.severity === value) return;
                glyph.dataset.severity = value;
                root.dataset.icon =
                    value === "progress" ? "loading" : value === "success" ? "check" : value === "warning" || value === "error" ? "warning" : "info";
                const names: Record<FeedbackSeverity, IconName> = {
                    info: "info",
                    success: "check",
                    progress: "loading",
                    warning: "warning",
                    error: "warning",
                };
                glyph.replaceChildren(icon(names[value]));
            },
        };
    },
    button(action: FeedbackAction) {
        const control = button(
            action.label,
            () => {
                void action.run();
            },
            "",
            action.destructive ? { appearance: "danger" } : {},
        );
        control.disabled = !!action.disabled || !!action.busy;
        control.setAttribute("aria-busy", String(!!action.busy));
        return control;
    },
};
