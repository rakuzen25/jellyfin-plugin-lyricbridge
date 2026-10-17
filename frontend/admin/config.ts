import { revealSelectedTab } from "./ui.ts";
import { createRequestsPanel } from "./requests-panel.ts";
import type { DataHost } from "./data-contracts.ts";
import { credentialAvailable, credentialEditor } from "./credentials.ts";
import { rebaseSettings, same } from "./settings-draft.ts";
import { createDataPanel } from "./data-panel.ts";
import { settingsActionGroup, settingsRowHeader, rowAction } from "./settings-row.ts";
import { adminButton as button } from "./controls.ts";
import { renderServices } from "./services-panel.ts";
import { FeedbackScope } from "../shared/feedback.ts";
import { materialFeedback } from "./feedback.ts";
import { icon } from "../shared/icons.ts";
import type { Configuration, WebRendererStatus } from "./contracts.ts";
import { hostFailure } from "./contracts.ts";
(() => {
    const page = document.querySelector<HTMLElement>("#LyricBridgeConfig")!,
        status = query("#lb-config-status");

    interface Controls {
        "#lb-web-enabled": HTMLInputElement;
        "#lb-web-repair": HTMLButtonElement;
        "#lb-approval": HTMLInputElement;
        "#lb-scheduled": HTMLInputElement;
        "#lb-defaults": HTMLElement;
        "#lb-score": HTMLInputElement;
        form: HTMLElement;
        "#lb-sources": HTMLElement;
        "#lb-queue": HTMLElement;
        "#lb-services": HTMLElement;
        ".content-primary": HTMLElement;
        "#lb-config-status": HTMLElement;
        "#lb-storage-warning": HTMLElement;
        "#lb-daily": HTMLInputElement;
        "#lb-default-language-options": HTMLElement;
        "#lb-storage": HTMLInputElement;
        "#lb-active": HTMLInputElement;
        "#lb-effective-storage": HTMLElement;
        "#lb-config-tabs": HTMLElement & {
            selectedIndex?: (index: number, notify: boolean) => void;
            scroller?: { toCenter(element: HTMLElement, smooth: boolean): void };
        };
        "#lb-requests": HTMLInputElement;
        "#lb-auto-pronunciation": HTMLInputElement;
        ".lb-config-footer .button-submit": HTMLButtonElement;
        "#lb-default-preview": HTMLElement;
    }
    function query<S extends string>(selector: S): S extends keyof Controls ? Controls[S] : HTMLElement {
        const element = page.querySelector(selector);
        if (!element) throw new Error("Missing configuration control: " + selector);
        return element as S extends keyof Controls ? Controls[S] : HTMLElement;
    }
    interface SettingsSnapshot {
        configuration: Configuration;
        revision: string;
    }
    let config: Configuration, savedConfig: Configuration;
    let settingsRevision = "",
        saving = false;
    const conflictPanel = node("section");
    conflictPanel.className = "lb-settings-surface";
    conflictPanel.hidden = true;
    conflictPanel.setAttribute("aria-label", "Settings conflict");
    query("#lb-config-tabs").after(conflictPanel);
    let rendererRuntime: WebRendererStatus | undefined;
    let storageRuntime: { activeStoragePath?: string; configuredStoragePath?: string; restartRequired?: boolean } = {};
    let dirty = false,
        configRevision = 0,
        loaded = false,
        loading = false;
    const saveButton = query(".lb-config-footer .button-submit");
    let activeEditor: "source" | "service" | null = null;
    let sourceDraft: Configuration["Sources"][number] | null = null;
    function editing(owner: "source" | "service", value: boolean, resume?: () => void) {
        if (value && saving) {
            notice(status, "Wait for settings to finish saving before opening an editor.");
            return false;
        }
        if (value && activeEditor !== null) {
            const previousOwner = activeEditor;
            const current = page.querySelector<HTMLElement>((activeEditor === "source" ? "#lb-sources" : "#lb-services") + " .lb-service-editor");
            if (!current) return false;
            let prompt = current.querySelector<HTMLElement>(".lb-editor-switch");
            if (!prompt) {
                prompt = node("div");
                prompt.className = "lb-editor-switch";
                current.prepend(prompt);
            }
            const switchEditor = (label: string) => {
                const control = Array.from(current?.querySelectorAll<HTMLButtonElement>(".lb-actions > button") || []).find(
                    (candidate) => candidate.textContent?.trim() === label,
                );
                control?.click();
                if (activeEditor === null) {
                    activateTab(owner === "source" ? 1 : 2);
                    resume?.();
                } else {
                    activateTab(previousOwner === "source" ? 1 : 2);
                    current?.scrollIntoView({ block: "center" });
                }
            };
            feedbackScope.update(prompt, {
                message: "You have an unfinished edit. Apply or discard it before switching rows.",
                severity: "warning",
                actions: [
                    { label: "Apply and switch", run: () => switchEditor("Apply") },
                    { label: "Discard and switch", run: () => switchEditor("Cancel") },
                    {
                        label: "Keep editing",
                        run: () => {
                            prompt.remove();
                            notice(status, "Apply or cancel editor changes before saving.");
                            activateTab(previousOwner === "source" ? 1 : 2);
                            current?.querySelector<HTMLInputElement>("input")?.focus();
                        },
                    },
                ],
            });
            activateTab(previousOwner === "source" ? 1 : 2);
            const disclosure = current.closest("details");
            if (disclosure) disclosure.open = true;
            prompt.scrollIntoView({ block: "center" });
            prompt.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
            return false;
        }
        activeEditor = value ? owner : null;
        saveButton.disabled = value || !loaded;
        notice(status, value ? "Apply adds this edit to your draft. Save settings persists all changes." : dirty ? "Unsaved changes" : "");
        updateDirtyMarkers();
        return true;
    }
    const names: Record<string, string> = {
        TranslationLanguage: "Translation language",
        SourceLanguage: "Original language",
        OriginalChineseScript: "Chinese original text",
        RomanizationSystem: "Romanization",
        RowOrder: "Auxiliary row order",
        OriginalSize: "Original size",
        PronunciationSize: "Pronunciation size",
        TranslationSize: "Translation size",
        RowSpacing: "Row spacing",
        ShowTranslation: "Show translation",
        ShowPronunciation: "Show pronunciation",
        JapaneseRomaji: "Japanese romaji",
    };
    const languages: [string, string][] = [
        ["zh-Hans", "Chinese (Simplified)"],
        ["zh-Hant", "Chinese (Traditional)"],
        ["en", "English"],
        ["ja", "Japanese"],
        ["ko", "Korean"],
        ["ar", "Arabic"],
        ["fr", "French"],
        ["de", "German"],
        ["es", "Spanish"],
        ["ru", "Russian"],
        ["hi", "Hindi"],
    ];
    function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
        const n = document.createElement(tag);
        if (text !== undefined) n.textContent = text;
        return n;
    }
    const feedbackScope = new FeedbackScope(materialFeedback);
    let feedbackVisible = true;
    function notice(target: HTMLElement, message: string, ttl = 0) {
        if (!feedbackVisible) return;
        feedbackScope.update(target, {
            message,
            severity: ttl ? "success" : /^(Loading|Saving|Testing|Resetting)/.test(message) ? "progress" : "info",
            ttl,
        });
    }
    function failure(target: HTMLElement, message: string, details: string[] = []) {
        if (!feedbackVisible) return;
        feedbackScope.update(target, {
            message,
            severity: "error",
            details,
            actions: [{ label: "Dismiss", run: () => notice(target, target === status && dirty ? "Unsaved changes" : "") }],
        });
    }
    page.addEventListener("viewhide", () => {
        feedbackVisible = false;
        requestsPanel.hide();
        window.removeEventListener("resize", positionFooter);
        feedbackScope.dispose();
    });
    function changed(event?: Event) {
        if (event?.target instanceof Element && event.target.closest("[data-config-transient]")) return;
        syncFields();
        dirty = !same(config, savedConfig);
        configRevision++;
        updateDirtyMarkers();
        notice(status, dirty ? "Unsaved changes" : "");
        refreshDependentControls();
    }
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
        const list = node("ol");
        list.className = "fieldDescription lb-setup-guide";
        for (const text of steps) list.append(node("li", text));
        parent.append(list);
        if (link) {
            const a = node("a", link[0]);
            a.href = link[1] ?? "";
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.className = "button-link";
            parent.append(a);
        }
    }
    function field<T extends string | number | boolean>(
        parent: HTMLElement,
        label: string | undefined,
        value: T | undefined,
        type = "text",
        change?: (value: T) => void,
    ) {
        const wrap = node("div");
        wrap.className = "inputContainer";
        const input = document.createElement("input");
        input.setAttribute("is", "emby-input");
        input.setAttribute("label", label ?? "");
        input.type = type;
        input.value = String(value ?? "");
        input.oninput = () => {
            change?.((type === "number" ? Number(input.value) : input.value) as T);
            changed();
        };
        wrap.append(input);
        parent.append(wrap);
        return input;
    }
    function select(
        parent: HTMLElement,
        label: string | undefined,
        value: string | number | boolean,
        choices: readonly (readonly string[])[],
        change: (value: string) => void,
    ) {
        const wrap = node("div");
        wrap.className = "selectContainer";
        const setting = Object.keys(names).find((k) => names[k] === label);
        if (setting) wrap.dataset.defaultKey = setting;
        const input = document.createElement("select");
        input.setAttribute("is", "emby-select");
        input.setAttribute("label", label ?? "");
        for (const [v, t] of choices) {
            const o = node("option", t);
            o.value = v ?? "";
            input.append(o);
        }
        input.value = String(value);
        input.onchange = () => {
            change(input.value);
            changed();
        };
        wrap.append(input);
        parent.append(wrap);
    }
    function check(parent: HTMLElement, label: string | undefined, value: unknown, change: (value: boolean) => void) {
        const wrap = node("label");
        wrap.className = "checkboxContainer emby-checkbox-label";
        const setting = Object.keys(names).find((k) => names[k] === label);
        if (setting) wrap.dataset.defaultKey = setting;
        const input = document.createElement("input");
        input.setAttribute("is", "emby-checkbox");
        input.type = "checkbox";
        input.checked = Boolean(value);
        input.onchange = () => {
            change(input.checked);
            changed();
        };
        wrap.append(input, node("span", label));
        parent.append(wrap);
        return input;
    }
    async function call<T = unknown>(path: string, method = "GET", data?: unknown): Promise<T> {
        try {
            return (await ApiClient.ajax({
                type: method,
                url: ApiClient.getUrl("LyricBridge/" + path),
                dataType: "json",
                contentType: "application/json",
                data: data === undefined ? undefined : JSON.stringify(data),
            })) as T;
        } catch (caught) {
            const error = hostFailure(caught);
            let body;
            try {
                body =
                    typeof error.json === "function"
                        ? await error.clone?.().json()
                        : error.responseJSON || JSON.parse(error.responseText || error.response?.data || "null");
            } catch {}
            const code = error.status || error.response?.status;
            const message =
                body?.error?.message ||
                (code === 401
                    ? "Sign in again before retrying."
                    : code === 403
                      ? "This action requires administrator permissions."
                      : "The request failed. Check the service setup and retry this action.");
            const failure = Object.assign(new Error(body?.error?.message || error.message || message), { details: body?.error, status: code });
            throw failure;
        }
    }
    function sources() {
        const target = query("#lb-sources");
        target.replaceChildren();
        config.Sources.forEach((s, index) => {
            const row = node("div");
            row.dataset.source = s.Name;
            row.className = "lb-source-row lb-settings-row";
            const header = settingsRowHeader(s.Name, "", "");
            row.append(header.root);
            const requiresCredential = ["Spotify", "AppleMusic"].includes(s.Name);
            const checkbox = check(header.actions, "Enabled", s.Enabled, (v) => {
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
                if (next < 0 || next >= config.Sources.length) return;
                [config.Sources[index], config.Sources[next]] = [config.Sources[next]!, config.Sources[index]!];
                sources();
                changed();
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
                b.disabled = index + delta < 0 || index + delta >= config.Sources.length;
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
                            if (!editing("source", true, openSourceEditor)) return;
                            sourceDraft = structuredClone(s);
                            sources();
                            target.querySelector<HTMLInputElement>("[data-config-transient] input")?.focus();
                        },
                        "quiet",
                    ),
                );
                if (sourceDraft?.Name === s.Name) {
                    const draft = sourceDraft;
                    const form = node("div");
                    form.className = "lb-service-editor";
                    form.dataset.configTransient = "true";
                    const title = node("h4", "Edit " + s.Name);
                    title.className = "lb-settings-editor-title";
                    form.append(title);
                    form.append(node("p", "Apply adds changes to the draft; Save settings persists them."));
                    credentialEditor(
                        form,
                        draft,
                        () => draft.Credential,
                        (value) => {
                            draft.Credential = value;
                        },
                    );
                    const instructions = node("details");
                    instructions.append(node("summary", "Setup instructions"));
                    guidance(instructions, sourceHelp[s.Name] || []);
                    const actions = node("div");
                    actions.className = "lb-actions";
                    const close = () => {
                        sourceDraft = null;
                        editing("source", false);
                        sources();
                        target.querySelector<HTMLElement>('[data-source="' + s.Name + '"] .lb-settings-row-actions button')?.focus();
                    };
                    actions.append(
                        button("Apply", () => {
                            if (draft.CredentialAction === "replace" && !draft.Credential.trim()) {
                                const error = node("p");
                                form.append(error);
                                failure(error, "Enter a replacement credential, or choose Keep or Clear.");
                                return;
                            }
                            s.Credential = draft.Credential;
                            s.CredentialAction = draft.CredentialAction;
                            changed();
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
    function positionFooter() {
        revealSelectedTab(query("#lb-config-tabs"));
        const content = query(".content-primary"),
            rect = content.getBoundingClientRect(),
            style = getComputedStyle(content);
        const scale = rect.width / content.offsetWidth || 1;
        const left = Math.max(8, rect.left + parseFloat(style.paddingLeft) * scale);
        const right = Math.min(innerWidth - 8, rect.right - parseFloat(style.paddingRight) * scale);
        page.style.setProperty("--lb-footer-left", left / scale + "px");
        page.style.setProperty("--lb-footer-width", Math.max(0, right - left) / scale + "px");
        const background = document.querySelector(".backgroundContainer");
        const color = getComputedStyle(background || document.body).backgroundColor;
        if (color && color !== "rgba(0, 0, 0, 0)") page.style.setProperty("--lb-footer-background", color);
    }
    function refreshDependentControls() {
        if (!config) return;
        for (const id of ["lb-approval", "lb-daily", "lb-active"])
            query("#" + id).closest<HTMLElement>(".checkboxContainer,.inputContainer")!.hidden = !query("#lb-requests").checked;
        query("#lb-effective-storage").textContent = "Active path: " + (storageRuntime.activeStoragePath || "Unavailable — reload settings to retry");
        query("#lb-storage-warning").hidden =
            !storageRuntime.restartRequired && query("#lb-storage").value.trim() === (savedConfig.StoragePath?.trim() || "");
        const rendererStatus = query("#lb-web-status");
        const severity = rendererRuntime?.severity || (rendererRuntime ? "info" : "warning");
        rendererStatus.dataset.state = severity;
        rendererStatus.setAttribute("role", severity === "error" ? "alert" : "status");
        const statusLines = rendererRuntime
            ? [
                  (severity === "error" ? "Renderer error: " : severity === "warning" ? "Renderer warning: " : "") + rendererRuntime.result,
                  "Mechanism: " + rendererRuntime.mechanism,
                  "Web root: " + rendererRuntime.webRoot,
              ]
            : ["Renderer warning: status unavailable — use Repair to retry."];
        const rendererView = feedbackScope.update(rendererStatus, { message: statusLines[0] || "", severity });
        rendererView.message.replaceChildren(...statusLines.map((text) => node("div", text)));
        const lang = config.Defaults.SourceLanguage;
        const languageOptions = query("#lb-default-language-options");
        if (languageOptions) {
            languageOptions.hidden = lang !== "auto";
            for (const key of ["OriginalChineseScript", "JapaneseRomaji", "RomanizationSystem"]) {
                const field = query('[data-default-key="' + key + '"]');
                if (!field) continue;
                const relevant = key === "OriginalChineseScript" ? lang.startsWith("zh") : lang === "ja";
                field.hidden = lang !== "auto" && !relevant;
                const group = key === "OriginalChineseScript" ? "original" : "pronunciation";
                const destination = lang === "auto" ? languageOptions : query('[data-group="' + group + '"] .lb-field-grid');
                if (field.parentNode !== destination) destination.append(field);
            }
        }
        const preview = query("#lb-default-preview");
        if (preview) {
            preview.replaceChildren();
            const d = config.Defaults;
            const rows: Record<string, [string, number, boolean, string]> = {
                original: ["朝の光", d.OriginalSize, true, "ja"],
                pronunciation: ["asa no hikari", d.PronunciationSize, d.ShowPronunciation && d.JapaneseRomaji, "ja-Latn"],
                translation: [
                    d.TranslationLanguage === "zh-Hant" ? "晨光照亮窗戶" : "晨光照亮窗户",
                    d.TranslationSize,
                    d.ShowTranslation,
                    d.TranslationLanguage,
                ],
            };
            for (const key of [
                "original",
                ...(d.RowOrder === "translation-first" ? ["translation", "pronunciation"] : ["pronunciation", "translation"]),
            ]) {
                const [text, size, show, language] = rows[key]!;
                if (!show) continue;
                const row = node("div", text);
                row.lang = language;
                row.dir = "auto";
                row.style.fontSize = size + "px";
                row.style.marginTop = key === "original" ? "0" : d.RowSpacing + "px";
                preview.append(row);
            }
        }
    }
    function render() {
        for (const [key, selector] of [
            ["StoragePath", "#lb-storage"],
            ["MinimumMatch", "#lb-score"],
            ["UserRequestDailyQuota", "#lb-daily"],
            ["UserRequestActiveCap", "#lb-active"],
        ] as const)
            query(selector).value = String(config[key] ?? "");
        for (const [key, selector] of [
            ["EnableWebRenderer", "#lb-web-enabled"],
            ["ScheduledRetrieval", "#lb-scheduled"],
            ["AutoGeneratePronunciation", "#lb-auto-pronunciation"],
            ["AllowUserRequests", "#lb-requests"],
            ["AutoApproveUserRequests", "#lb-approval"],
        ] as const)
            query(selector).checked = key === "AutoGeneratePronunciation" ? config[key] !== false : config[key];
        const target = query("#lb-defaults");
        target.replaceChildren();
        const choices: Record<string, readonly (readonly string[])[]> = {
            TranslationLanguage: languages,
            SourceLanguage: [["auto", "Auto (detect from lyrics)"], ...languages.filter((l) => !l[0].startsWith("zh")), ["zh", "Chinese"]],
            OriginalChineseScript: [
                ["Simplified", "Simplified"],
                ["Traditional", "Traditional"],
            ],
            RomanizationSystem: [
                ["Hepburn", "Hepburn"],
                ["Passport", "Passport"],
                ["Nippon", "Nippon"],
            ],
            RowOrder: [
                ["pronunciation-first", "Pronunciation → translation"],
                ["translation-first", "Translation → pronunciation"],
            ],
        };
        function group(title: string, keys: string[], toggles: string[] = []) {
            const section = node("div");
            section.className = "lb-settings-group";
            section.append(node("h4", title));
            section.dataset.group = title === "Original lyrics" ? "original" : title.toLowerCase();
            target.append(section);
            for (const key of toggles) check(section, names[key], config.Defaults[key], (v) => (config.Defaults[key] = v));
            const grid = node("div");
            grid.className = "lb-field-grid";
            section.append(grid);
            for (const key of keys)
                select(
                    grid,
                    names[key],
                    config.Defaults[key] ?? (key === "OriginalChineseScript" ? "Simplified" : "Hepburn"),
                    choices[key] ?? [],
                    (v) => (config.Defaults[key] = v),
                );
        }
        group("Original lyrics", ["SourceLanguage", "OriginalChineseScript"]);
        group("Pronunciation", ["RomanizationSystem"], ["ShowPronunciation", "JapaneseRomaji"]);
        group("Translation", ["TranslationLanguage"], ["ShowTranslation"]);
        const languageOptions = node("details");
        languageOptions.id = "lb-default-language-options";
        languageOptions.append(node("summary", "Language-specific options"));
        target.append(languageOptions);
        const layout = node("details");
        layout.append(node("summary", "Text sizes and layout"));
        target.append(layout);
        const grid = node("div");
        grid.className = "lb-field-grid";
        layout.append(grid);
        select(grid, names.RowOrder, config.Defaults.RowOrder, choices.RowOrder ?? [], (v) => (config.Defaults.RowOrder = v));
        for (const key of ["OriginalSize", "PronunciationSize", "TranslationSize", "RowSpacing"])
            field(grid, names[key], config.Defaults[key], "number", (v) => (config.Defaults[key] = v));
        refreshDependentControls();
        sources();
        renderServices({
            target: query("#lb-services"),
            setup: config.ServiceSetup,
            savedSetup: savedConfig.ServiceSetup,
            localPolicy: page.querySelector<HTMLElement>("#lb-local-pronunciation")!,
            changed,
            active: () => feedbackVisible,
            editing: (value, resume) => editing("service", value, resume),
            modelLimits: async (connection, model) => {
                const result = await call<{ available: boolean; contextWindow: number | null; completionLimit: number | null }>(
                    "service-options/model-limits",
                    "POST",
                    { endpoint: connection.Endpoint, apiKey: connection.ApiKey, connectionId: connection.Id, model },
                );
                if (!feedbackVisible) throw new Error("Settings view closed.");
                return result;
            },
            test: async (optionId) => {
                if (JSON.stringify(config.ServiceSetup) !== JSON.stringify(savedConfig.ServiceSetup))
                    throw new Error("Save settings before testing.");
                await call("service-options/" + optionId + "/test", "POST");
            },
            feedback: (target, text, error) => (error ? failure(target, text) : notice(target, text)),
        });
    }
    let dataMaintenance = false;
    const dataHost: DataHost = {
        call,
        feedback: (target, message, error) => (error ? failure(target, message) : notice(target, message)),
        unsaved: () => dirty || activeEditor !== null,
        busy: () => loading || !loaded || saving,
        discard: async () => {
            // Confirm successful retrieval before disposing unfinished drafts.
            const snapshot = await call<SettingsSnapshot>("admin/settings");
            activeEditor = null;
            sourceDraft = null;
            config = snapshot.configuration;
            savedConfig = structuredClone(snapshot.configuration);
            settingsRevision = snapshot.revision;
            render();
            dirty = false;
            loaded = true;
            updateDirtyMarkers();
            notice(status, "");
        },
        maintenance: (value) => {
            dataMaintenance = value;
            saveButton.disabled = value || !loaded || activeEditor !== null;
            page.querySelectorAll<HTMLElement>("[data-tab]").forEach((panel) => {
                if (panel.dataset.tab !== "Data") panel.inert = value;
            });
            page.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => {
                tab.disabled = value;
            });
        },
        reload: loadSettings,
        settings: (index) => activateTab(index, true),
    };
    const dataPanel = createDataPanel(query("#lb-data-manager"), dataHost);
    const requestsPanel = createRequestsPanel(
        query("#lb-queue"),
        dataHost,
        () => feedbackVisible && !page.querySelector<HTMLElement>('[data-tab="Requests"]')!.hidden,
    );
    page.addEventListener("viewhide", () => dataPanel.hide());
    const tabs = query("#lb-config-tabs");
    const tabNames = ["General", "Sources", "Services", "Display defaults", "Requests", "Data"];
    function activateTab(index: number, focus = false) {
        if (typeof tabs.selectedIndex === "function") tabs.selectedIndex(index, false);
        page.querySelectorAll<HTMLElement>("[data-tab]").forEach((panel, i) => (panel.hidden = i !== index));
        tabs.querySelectorAll<HTMLElement>("[role=tab]").forEach((tab, i) => {
            tab.setAttribute("aria-selected", String(i === index));
            tab.classList.toggle("emby-tab-button-active", i === index);
            tab.tabIndex = i === index ? 0 : -1;
            if (i === index) {
                if (focus) tab.focus();
                tab.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
        });
        query(".lb-config-footer").hidden = index === 5;
        page.classList.toggle("lb-data-active", index === 5);
        if (index === 4 && loaded && feedbackVisible) void loadRequests();
        else requestsPanel.hide();
        if (index === 5 && loaded && feedbackVisible) dataPanel.show();
        else dataPanel.hide();
    }
    tabs.replaceChildren(
        ...tabNames.map((name, i) => {
            const b = button(name, (event) => {
                event.stopPropagation();
                activateTab(i);
                if (tabs.scroller) tabs.scroller.toCenter(b, false);
                else b.scrollIntoView({ block: "nearest", inline: "nearest" });
            });
            b.className = "emby-button button-flat";
            b.dataset.index = String(i);
            b.id = "lb-tab-" + i;
            b.setAttribute("role", "tab");
            b.setAttribute("aria-controls", "lb-panel-" + i);
            const panel = page.querySelectorAll<HTMLElement>("[data-tab]")[i]!;
            panel.id = "lb-panel-" + i;
            panel.setAttribute("aria-labelledby", b.id);
            return b;
        }),
    );
    activateTab(0);
    tabs.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        if (!(event.target instanceof Element) || event.target.closest('[role="tablist"]') !== tabs) return;
        event.preventDefault();
        const current = Number((event.target as HTMLElement).closest<HTMLElement>("[role=tab]")?.dataset.index || 0);
        activateTab(
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabNames.length - 1
                  : (current + (event.key === "ArrowRight" ? 1 : tabNames.length - 1)) % tabNames.length,
            true,
        );
    });
    query("#lb-web-repair").onclick = async () => {
        const control = query("#lb-web-repair");
        control.disabled = true;
        try {
            rendererRuntime = await call<WebRendererStatus>("admin/web-renderer/repair", "POST");
            refreshDependentControls();
        } catch {
            query("#lb-web-status").dataset.state = "error";
            query("#lb-web-status").setAttribute("role", "alert");
            failure(query("#lb-web-status"), "Renderer repair failed. Reload settings and retry.");
        } finally {
            control.disabled = false;
        }
    };
    async function loadSettings() {
        if (loading) return;
        loading = true;
        loaded = false;
        saveButton.disabled = true;
        notice(status, "Loading settings…");
        try {
            const snapshot = await call<SettingsSnapshot>("admin/settings");
            config = snapshot.configuration;
            settingsRevision = snapshot.revision;
            conflictPanel.hidden = true;
            config.Transcription ??= {
                Enabled: false,
                Endpoint: "https://api.groq.com/openai/v1",
                Model: "whisper-large-v3",
                ApiKey: "",
                UploadFormat: "opus",
                MaxUploadMb: 25,
                MaxInputMb: 256,
                TimeoutSeconds: 120,
                ReviewUsesAiService: true,
                Review: {
                    Name: "AI",
                    Enabled: true,
                    Endpoint: "",
                    Model: "",
                    ApiKey: "",
                    TimeoutSeconds: 120,
                    ContextBefore: 0,
                    ContextAfter: 0,
                    ReasoningEffort: "",
                },
            };
            savedConfig = JSON.parse(JSON.stringify(config));
            storageRuntime = await call<typeof storageRuntime>("admin/runtime").catch(() => ({}));
            rendererRuntime = await call<WebRendererStatus>("admin/web-renderer").catch(() => undefined);
            render();
            dirty = false;
            loaded = true;
            updateDirtyMarkers();
            if (feedbackVisible && !page.querySelector<HTMLElement>('[data-tab="Requests"]')!.hidden) void loadRequests();
            saveButton.disabled = dataMaintenance;
            notice(status, "");
            if (feedbackVisible && !dataMaintenance && !page.querySelector<HTMLElement>('[data-tab="Data"]')!.hidden) dataPanel.show();
        } catch (caught) {
            hostFailure(caught);
            console.error("LyricBridge configuration could not be loaded.");
            failure(status, "Settings could not load.");
            status.querySelector(".lb-material-actions")?.append(button("Retry", loadSettings));
        } finally {
            loading = false;
        }
    }
    page.addEventListener("viewshow", () => {
        feedbackVisible = true;
        window.addEventListener("resize", positionFooter);
        positionFooter();
        if (!loaded) loadSettings();
        else {
            refreshDependentControls();
            notice(status, dirty ? "Unsaved changes" : "");
            if (!page.querySelector<HTMLElement>('[data-tab="Requests"]')!.hidden) void loadRequests();
            if (!page.querySelector<HTMLElement>('[data-tab="Data"]')!.hidden && !dataMaintenance) dataPanel.show();
        }
    });
    query("form").addEventListener("input", changed);
    query("form").addEventListener("change", changed);
    function syncFields() {
        if (!config) return;
        config.StoragePath = query("#lb-storage").value.trim();
        config.MinimumMatch = Number(query("#lb-score").value);
        config.UserRequestDailyQuota = Number(query("#lb-daily").value);
        config.UserRequestActiveCap = Number(query("#lb-active").value);
        for (const [key, selector] of [
            ["EnableWebRenderer", "#lb-web-enabled"],
            ["ScheduledRetrieval", "#lb-scheduled"],
            ["AutoGeneratePronunciation", "#lb-auto-pronunciation"],
            ["AllowUserRequests", "#lb-requests"],
            ["AutoApproveUserRequests", "#lb-approval"],
        ] as const)
            config[key] = query(selector).checked;
    }
    function updateDirtyMarkers() {
        if (!config || !savedConfig) return;
        const groups = [
            ["EnableWebRenderer", "StoragePath", "ScheduledRetrieval"],
            ["Sources", "MinimumMatch"],
            ["ServiceSetup", "AutoGeneratePronunciation"],
            ["Defaults"],
            ["AllowUserRequests", "AutoApproveUserRequests", "UserRequestDailyQuota", "UserRequestActiveCap"],
            [],
        ];
        page.querySelectorAll<HTMLElement>('#lb-config-tabs [role="tab"]').forEach((tab, index) => {
            const changed =
                groups[index]!.some((key) => !same(config[key], savedConfig[key])) ||
                activeEditor === (index === 1 ? "source" : index === 2 ? "service" : "none");
            tab.querySelector(".lb-dirty-marker")?.remove();
            if (changed) {
                const marker = node("span", " •");
                marker.className = "lb-dirty-marker";
                marker.setAttribute("aria-hidden", "true");
                tab.append(marker);
            }
            tab.setAttribute("aria-description", changed ? "Unsaved changes" : "");
        });
    }
    async function compareSettings() {
        const latest = await call<SettingsSnapshot>("admin/settings");
        const choices = new Map<string, "local" | "latest">();
        const areas: Record<string, string> = {
            Sources: "Sources",
            MinimumMatch: "Sources",
            ServiceSetup: "Services",
            AutoGeneratePronunciation: "Services",
            Defaults: "Display defaults",
            AllowUserRequests: "Requests",
            AutoApproveUserRequests: "Requests",
            UserRequestDailyQuota: "Requests",
            UserRequestActiveCap: "Requests",
        };
        const remoteAreas = [
            ...new Set(
                Object.keys(latest.configuration)
                    .filter((key) => !same(savedConfig[key], latest.configuration[key]))
                    .map((key) => areas[key] || "General"),
            ),
        ];
        conflictPanel.hidden = false;
        function show() {
            const result = rebaseSettings(savedConfig, config, latest.configuration, choices);
            conflictPanel.replaceChildren(
                node("h3", "Saved settings changed"),
                node("p", "Changed elsewhere: " + remoteAreas.join(", ") + "."),
                node("p", "Your draft is preserved. Review conflicting changes before rebasing; nothing is saved automatically."),
            );
            for (const item of result.conflicts) {
                const row = node("div");
                row.className = "lb-settings-row";
                const heading = settingsRowHeader(item.label);
                const describe = (value: unknown) => (value === undefined ? "Removed" : typeof value === "object" ? "Changed item" : String(value));
                heading.description.hidden = false;
                heading.description.textContent = "Draft: " + describe(item.local) + " · Latest: " + describe(item.latest);
                for (const choice of ["local", "latest"] as const)
                    heading.actions.append(
                        rowAction(
                            choice === "local" ? "Use draft" : "Use latest",
                            () => {
                                choices.set(item.path, choice);
                                show();
                            },
                            "quiet",
                        ),
                    );
                row.append(heading.root);
                if (typeof item.local === "object" || typeof item.latest === "object") {
                    const details = node("details");
                    details.append(
                        node("summary", "Compare draft and latest"),
                        node("h4", "Draft"),
                        node("pre", JSON.stringify(item.local, null, 2)),
                        node("h4", "Latest saved"),
                        node("pre", JSON.stringify(item.latest, null, 2)),
                    );
                    heading.body.append(details);
                }
                conflictPanel.append(row);
            }
            const actions = node("div");
            actions.className = "lb-actions";
            actions.append(
                button(
                    "Rebase draft",
                    result.conflicts.length
                        ? null
                        : () => {
                              const final = rebaseSettings(savedConfig, config, latest.configuration, choices);
                              if (final.conflicts.length) {
                                  show();
                                  return;
                              }
                              config = final.configuration;
                              savedConfig = structuredClone(latest.configuration);
                              settingsRevision = latest.revision;
                              conflictPanel.hidden = true;
                              render();
                              changed();
                              saveButton.disabled = !loaded || activeEditor !== null || dataMaintenance || !conflictPanel.hidden;
                              notice(status, "Draft rebased. Review it, then Save settings.");
                          },
                ),
                button(
                    "Discard draft and load latest",
                    () => {
                        activeEditor = null;
                        sourceDraft = null;
                        void loadSettings();
                    },
                    "quiet",
                ),
            );
            conflictPanel.append(actions);
        }
        show();
        conflictPanel.scrollIntoView({ block: "nearest" });
        conflictPanel.querySelector<HTMLButtonElement>("button")?.focus();
    }
    query("form").onsubmit = async (event) => {
        event.preventDefault();
        if (!loaded || loading || saving || dataMaintenance || activeEditor !== null) return;
        syncFields();
        saving = true;
        saveButton.disabled = true;
        notice(status, "Saving…");
        const revision = configRevision,
            snapshot = structuredClone(config);
        const payload = structuredClone(snapshot);
        const credentials = [
            ...payload.Sources.map((value) => ({
                kind: "source",
                id: value.Name,
                action: value.CredentialAction || "keep",
                value: value.Credential,
            })),
            ...payload.ServiceSetup.Connections.map((value) => ({
                kind: "connection",
                id: value.Id,
                action: value.CredentialAction || "keep",
                value: value.ApiKey,
            })),
        ].filter((value) => value.action !== "keep");
        for (const value of payload.Sources) value.Credential = "";
        for (const value of payload.ServiceSetup.Connections) value.ApiKey = "";
        try {
            const saved = await call<SettingsSnapshot>("admin/settings", "PUT", { configuration: payload, revision: settingsRevision, credentials });
            settingsRevision = saved.revision;
            if (revision === configRevision) {
                config = structuredClone(saved.configuration);
                savedConfig = structuredClone(saved.configuration);
                render();
            } else {
                config = rebaseSettings(snapshot, config, saved.configuration).configuration;
                savedConfig = structuredClone(saved.configuration);
            }
            storageRuntime = await call<typeof storageRuntime>("admin/runtime").catch(() => storageRuntime);
            rendererRuntime = await call<WebRendererStatus>("admin/web-renderer/repair", "POST").catch(() => undefined);
            refreshDependentControls();
            dirty = !same(config, savedConfig);
            updateDirtyMarkers();
            notice(status, dirty ? "Unsaved changes" : "Settings saved", dirty ? 0 : 4000);
        } catch (caught) {
            dirty = true;
            if (hostFailure(caught).status === 409) {
                try {
                    await compareSettings();
                } catch {
                    failure(status, "Latest settings could not load. Your draft is preserved; retry Save settings.");
                }
            } else failure(status, hostFailure(caught).message || "Settings were not saved. Your draft is preserved; try again.");
        } finally {
            saving = false;
            saveButton.disabled = !loaded || activeEditor !== null || dataMaintenance || !conflictPanel.hidden;
        }
    };
    async function loadRequests() {
        await requestsPanel.refresh();
    }
})();
