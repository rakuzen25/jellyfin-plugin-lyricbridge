import { adminButton } from "./controls.ts";

export interface CredentialState {
    CredentialPresent?: boolean;
    CredentialVersion?: string;
    CredentialAction?: "keep" | "replace" | "clear";
}
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
    const update = () => {
        status.textContent =
            value.CredentialAction === "clear"
                ? "Credential will be cleared when settings are saved."
                : value.CredentialAction === "replace"
                  ? "Replacement will be stored when settings are saved."
                  : value.CredentialPresent
                    ? "Credential configured. Saved values are never displayed."
                    : "No credential configured.";
        wrap.hidden = value.CredentialAction !== "replace";
    };
    actions.append(
        adminButton(
            "Replace credential",
            () => {
                value.CredentialAction = "replace";
                update();
                input.focus();
            },
            "quiet",
        ),
        adminButton(
            "Clear credential",
            () => {
                value.CredentialAction = "clear";
                write("");
                input.value = "";
                update();
            },
            "quiet",
        ),
        adminButton(
            "Keep saved credential",
            () => {
                value.CredentialAction = "keep";
                write("");
                input.value = "";
                update();
            },
            "quiet",
        ),
    );
    root.append(status, actions, wrap);
    parent.append(root);
    update();
}
