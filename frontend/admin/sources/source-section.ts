import { icon } from "../../shared/icons.ts";
import { credentialAvailable, credentialEditor } from "../services/credentials.ts";
import type { Configuration } from "../settings/contracts.ts";
import { adminButton as button } from "../ui/controls.ts";
import { rowAction, settingsActionGroup, settingsRowHeader } from "../ui/settings-row.ts";

interface Dependencies {
    query: (selector: string) => HTMLElement;
    config: Configuration;
    node: <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => HTMLElementTagNameMap[K];
    check: (parent: HTMLElement, label: string | undefined, value: unknown, change: (value: boolean) => void) => HTMLInputElement;
    changed: (event?: Event) => void;
    editing: (owner: "source" | "service", value: boolean, resume?: () => void) => boolean;
    failure: (target: HTMLElement, message: string, details?: string[]) => void;
}

/** Owns sources section behavior and its installation lifetime. */
export function createSourcesSection(deps: Dependencies) {
    let sourceDraft: Configuration["Sources"][number] | null = null;

    const sourceHelp: Record<string, string[]> = {
        QQ: ["No setup required. Enable QQ and save settings; LyricBridge searches QQ Music automatically."],
        NetEase: ["No setup required. Enable NetEase and save settings; lyrics may include supplied translations and pronunciation."],
        Kugou: ["No setup required. Enable Kugou and save settings; word timing is used when the recording supplies it."],
        Soda: ["No setup required. Enable Soda and save settings; availability depends on the recording and region."],
        LRCLIB: ["No setup required. Enable LRCLIB and save settings. This adapter uses the public LRCLIB service; no custom endpoint is needed."],
        Musixmatch: [
            "Leave Credential blank to let the helper obtain a token automatically. An optional existing Musixmatch usertoken can be pasted here; this is not a developer API key. Musixmatch may require CAPTCHA/verification during automatic token acquisition; LyricBridge then waits five minutes before retrying. A valid token from your own client may help but is not guaranteed to remove the challenge. Disable this source if you prefer to avoid these failures.",
        ],
        Spotify: [
            "Sign in to open.spotify.com in your browser. Open Developer Tools → Application (or Storage) → Cookies → open.spotify.com. Copy only the value of sp_dc into Credential, without sp_dc= or other cookies. Enable Spotify and save settings. Replace the value if your session expires; a Spotify developer client ID or access token will not work here.",
        ],
        AppleMusic: [
            "Sign in to music.apple.com with your own account. In Developer Tools → Network, inspect an authenticated Apple Music API request and copy the media-user-token request-header value. Paste only that value into Credential, enable AppleMusic, and save settings. This is not an Apple developer token. If your account sends no such header, leave this source disabled.",
        ],
    };

    function guidance(parent: HTMLElement, steps: string[], link?: string[]) {
        const list = deps.node("ol");
        list.className = "fieldDescription lb-setup-guide";
        for (const text of steps) list.append(deps.node("li", text));
        parent.append(list);
        if (link) {
            const a = deps.node("a", link[0]);
            a.href = link[1] ?? "";
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.className = "button-link";
            parent.append(a);
        }
    }

    function sources() {
        const target = deps.query("#lb-sources");
        target.replaceChildren();
        deps.config.Sources.forEach((s, index) => {
            const row = deps.node("div");
            row.dataset.source = s.Name;
            row.className = "lb-source-row lb-settings-row";
            const header = settingsRowHeader(s.Name, "", "");
            row.append(header.root);
            const requiresCredential = ["Spotify", "AppleMusic"].includes(s.Name);
            const checkbox = deps.check(header.actions, "Enabled", s.Enabled, (v) => {
                s.Enabled = v;
                refreshSourceState();
            });
            checkbox.setAttribute("aria-label", "Enable " + s.Name);
            function refreshSourceState() {
                const missing = requiresCredential && !credentialAvailable(s, s.Credential);
                checkbox.disabled = missing;
                checkbox.checked = !!s.Enabled && !missing;
                const badge = header.title.querySelector<HTMLElement>(".lb-config-badge")!;
                badge.textContent = missing
                    ? "Needs setup"
                    : credentialAvailable(s, s.Credential)
                      ? "Configured"
                      : s.Name === "Musixmatch"
                        ? "Token optional"
                        : "No setup needed";
                const enabledLabel = checkbox.closest<HTMLElement>("label")!;
                enabledLabel.title = missing ? "Choose Edit to configure credentials before enabling this source." : "";
                if (missing) {
                    checkbox.setAttribute("aria-description", "Setup required");
                } else {
                    checkbox.removeAttribute("aria-description");
                }
            }
            refreshSourceState();
            const move = (delta: number) => {
                const next = index + delta;
                if (next < 0 || next >= deps.config.Sources.length) return;
                [deps.config.Sources[index], deps.config.Sources[next]] = [deps.config.Sources[next]!, deps.config.Sources[index]!];
                sources();
                deps.changed();
            };
            const ordering = settingsActionGroup("Reorder " + s.Name);
            ordering.classList.add("lb-settings-row-ordering");
            header.root.classList.add("lb-settings-row-orderable");
            header.root.prepend(ordering);
            for (const [delta, glyph, label] of [
                [-1, "up", "Move up"],
                [1, "down", "Move down"],
            ] as const) {
                const b = button(label, () => move(delta), "quiet");
                b.classList.add("paper-icon-button-light", "lb-settings-icon-action");
                b.setAttribute("aria-label", label + " " + s.Name);
                b.title = label;
                b.dataset.tooltip = label;
                b.disabled = index + delta < 0 || index + delta >= deps.config.Sources.length;
                b.replaceChildren(icon(glyph));
                ordering.append(b);
            }
            if (["Spotify", "AppleMusic", "Musixmatch"].includes(s.Name)) {
                header.description.textContent =
                    s.Name === "Spotify" ? "Spotify cookie" : s.Name === "AppleMusic" ? "Media-user token" : "Works without a token.";
                if (requiresCredential && !credentialAvailable(s, s.Credential))
                    header.description.textContent += " required. Choose Edit to configure.";
                header.description.hidden = false;
                header.actions.append(
                    rowAction(
                        "Edit",
                        function openSourceEditor() {
                            if (!deps.editing("source", true, openSourceEditor)) return;
                            sourceDraft = structuredClone(s);
                            sources();
                            target.querySelector<HTMLInputElement>("[data-config-transient] input")?.focus();
                        },
                        "quiet",
                    ),
                );
                if (sourceDraft?.Name === s.Name) {
                    const draft = sourceDraft;
                    const form = deps.node("div");
                    form.className = "lb-service-editor";
                    form.dataset.configTransient = "true";
                    const title = deps.node("h4", "Edit " + s.Name);
                    title.className = "lb-settings-editor-title";
                    form.append(title);
                    form.append(deps.node("p", "Apply adds changes to the draft; Save settings persists them."));
                    credentialEditor(
                        form,
                        draft,
                        () => draft.Credential,
                        (value) => {
                            draft.Credential = value;
                        },
                    );
                    const instructions = deps.node("details");
                    instructions.append(deps.node("summary", "Setup instructions"));
                    guidance(instructions, sourceHelp[s.Name] || []);
                    const actions = deps.node("div");
                    actions.className = "lb-actions";
                    const close = () => {
                        sourceDraft = null;
                        deps.editing("source", false);
                        sources();
                        target.querySelector<HTMLElement>('[data-source="' + s.Name + '"] .lb-settings-row-actions button')?.focus();
                    };
                    actions.append(
                        button("Apply", () => {
                            if (draft.CredentialAction === "replace" && !draft.Credential.trim()) {
                                const error = deps.node("p");
                                form.append(error);
                                deps.failure(error, "Enter a replacement credential, or choose Keep or Clear.");
                                return;
                            }
                            s.Credential = draft.Credential;
                            s.CredentialAction = draft.CredentialAction;
                            deps.changed();
                            close();
                        }),
                        button("Cancel", close),
                    );
                    form.append(instructions, actions);
                    row.append(form);
                }
            } else if (s.Name === "Soda") {
                header.description.textContent = "Availability varies by region.";
                header.description.hidden = false;
            }
            target.append(row);
        });
    }
    return {
        sourceHelp,
        guidance,
        sources,
        get sourceDraft(): Configuration["Sources"][number] | null {
            return sourceDraft;
        },
        replaceSourceDraft(value: Configuration["Sources"][number] | null) {
            sourceDraft = value;
        },
    };
}
