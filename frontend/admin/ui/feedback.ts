import type { FeedbackAdapter } from "../../shared/feedback.ts";
import { adminButton } from "./controls.ts";
/** Native Jellyfin controls, deliberately independent of lyrics glass styling. */
export const materialFeedback: FeedbackAdapter = {
    presentation(root) {
        root.classList.add("lb-material-feedback");
        const message = document.createElement("span");
        message.className = "lb-material-message";
        const secondary = document.createElement("div");
        secondary.className = "lb-material-secondary";
        const actions = document.createElement("div");
        actions.className = "lb-material-actions";
        const diagnostics = document.createElement("div");
        diagnostics.className = "lb-material-diagnostics";
        root.replaceChildren(message, secondary, diagnostics, actions);
        return {
            message,
            secondary,
            actions,
            diagnostics,
            severity(value) {
                root.dataset.state = value;
            },
        };
    },
    button(action) {
        const control = adminButton(action.label, () => action.run());
        control.disabled = !!action.disabled || !!action.busy;
        control.setAttribute("aria-busy", String(!!action.busy));
        if (action.destructive) control.classList.add("lb-material-destructive");
        return control;
    },
};
