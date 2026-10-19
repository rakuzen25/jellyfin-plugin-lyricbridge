import { adminButton as sharedAdminButton } from "../../../.build/toolkit/current/ui/controls.ts";
export function adminButton(...args: Parameters<typeof sharedAdminButton>): HTMLButtonElement {
    const button = sharedAdminButton(...args);
    if (args[2] === "quiet") button.classList.add("lb-settings-action");
    return button;
}
