import type { CredentialState } from "../settings/contracts.ts";
import { adminButton } from "../ui/controls.ts";

export function credentialAvailable(value: CredentialState, secret: string) {
    return value.CredentialAction !== "clear" && (!!secret || !!value.CredentialPresent);
}
/** Edits only a replacement; persisted secrets are never loaded into the form. */
export function credentialEditor(parent: HTMLElement, value: CredentialState, read: () => string, write: (secret: string) => void) {
    const root = document.createElement("div");
    root.className = "lb-credential-editor";
    const status = document.createElement("p");
    status.className = "fieldDescription";
    const actions = document.createElement("div");
    actions.className = "lb-actions";
    const wrap = document.createElement("div");
    wrap.className = "inputContainer";
    const input = document.createElement("input");
    input.setAttribute("is", "emby-input");
    input.setAttribute("label", "Replacement credential");
    input.setAttribute("aria-label", "Replacement credential");
    input.type = "password";
    input.autocomplete = "new-password";
    input.value = read();
    input.oninput = () => {
        write(input.value);
        value.CredentialAction = "replace";
    };
    wrap.append(input);
    const reset = () => {
        value.CredentialAction = "keep";
        write("");
        input.value = "";
        update();
    };
    const replace = adminButton(
        "Replace credential",
        () => {
            value.CredentialAction = "replace";
            update();
            input.focus();
        },
        "quiet",
    );
    const clear = adminButton(
        "Clear credential",
        () => {
            value.CredentialAction = "clear";
            write("");
            input.value = "";
            update();
        },
        "quiet",
    );
    const cancel = adminButton("Cancel replacement", reset, "quiet");
    const undo = adminButton("Undo clear", reset, "quiet");
    const update = () => {
        const replacing = value.CredentialAction === "replace";
        const clearing = value.CredentialAction === "clear";
        status.textContent = clearing
            ? "Credential will be cleared when settings are saved."
            : replacing
              ? "The new credential will be stored when settings are saved."
              : value.CredentialPresent
                ? "Credential configured. Saved values are never displayed."
                : "No credential configured.";
        wrap.hidden = !replacing;
        replace.hidden = replacing || clearing;
        replace.querySelector("span")!.textContent = value.CredentialPresent ? "Replace credential" : "Add credential";
        clear.hidden = replacing || clearing || !value.CredentialPresent;
        cancel.hidden = !replacing;
        undo.hidden = !clearing;
    };
    const heading = document.createElement("h4");
    heading.textContent = "Credential";
    actions.append(replace, clear, cancel, undo);
    root.append(heading, wrap, status, actions);
    parent.append(root);
    update();
}
