import { settingsActionGroup, settingsRowHeader } from "./settings-row.ts";
import { adminButton as button } from "./controls.ts";
import { renderServices } from "./services-panel.ts";
import { FeedbackScope } from "../shared/feedback.ts";
import { materialFeedback } from "./feedback.ts";
import { icon } from "../shared/icons.ts";
import type { Configuration, JobSummary, WebRendererStatus } from "./contracts.ts";
import { hostFailure } from "./contracts.ts";
(() => {
    const id = "70a9d327-7e98-4201-88a5-724d39366c40",
        page = document.querySelector<HTMLElement>("#LyricBridgeConfig")!,
        status = query("#lb-config-status");

    interface Controls {
        "#lb-web-enabled": HTMLInputElement;
        "#lb-web-repair": HTMLButtonElement;
        "#lb-approval": HTMLInputElement;
        "#lb-scheduled": HTMLInputElement;
        "#lb-reset-status": HTMLElement;
        "#lb-defaults": HTMLElement;
        "#lb-score": HTMLInputElement;
        "#lb-reset-submit": HTMLButtonElement;
        form: HTMLElement;
        "#lb-sources": HTMLElement;
        "#lb-queue": HTMLElement;
        "#lb-services": HTMLElement;
        ".content-primary": HTMLElement;
        "#lb-refresh": HTMLButtonElement;
        "#lb-queue-status": HTMLElement;
        "#lb-reset-word": HTMLInputElement;
        "#lb-config-status": HTMLElement;
        "#lb-storage-warning": HTMLElement;
        "#lb-daily": HTMLInputElement;
        "#lb-reset-open": HTMLButtonElement;
        "#lb-default-language-options": HTMLElement;
        "#lb-reset-cancel": HTMLButtonElement;
        "#lb-storage": HTMLInputElement;
        "#lb-reset-confirm": HTMLElement;
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
    let config: Configuration, savedConfig: Configuration;
    let rendererRuntime: WebRendererStatus | undefined;
    let storageRuntime: { activeStoragePath?: string; configuredStoragePath?: string; restartRequired?: boolean } = {};
    let dirty = false,
        configRevision = 0,
        loaded = false,
        loading = false;
    const saveButton = query(".lb-config-footer .button-submit");
    let activeEditor: "source" | "service" | null = null;
    let sourceDraft: { name: string; credential: string } | null = null;
    function editing(owner: "source" | "service", value: boolean, resume?: () => void) {
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
        notice(status, value ? "Apply or cancel editor changes before saving." : dirty ? "Unsaved changes" : "");
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
        queueRevision++;
        window.removeEventListener("resize", positionFooter);
        feedbackScope.dispose();
    });
    function changed(event?: Event) {
        if (event?.target instanceof Element && event.target.closest("[data-config-transient]")) return;
        dirty = true;
        configRevision++;
        notice(status, "Unsaved changes");
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
            const failure = Object.assign(new Error(message), { details: body?.error });
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
                const missing = requiresCredential && !s.Credential?.trim();
                checkbox.disabled = missing;
                checkbox.checked = !!s.Enabled && !missing;
                const badge = header.title.querySelector<HTMLElement>(".lb-config-badge")!;
                badge.textContent = missing ? "Needs setup" : s.Credential?.trim() ? "Configured" : "Built in";
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
                    s.Name === "Spotify" ? "Spotify cookie" : s.Name === "AppleMusic" ? "Media-user token" : "Optional token";
                header.description.hidden = false;
                header.actions.append(
                    button(
                        "Edit",
                        function openSourceEditor() {
                            if (!editing("source", true, openSourceEditor)) return;
                            sourceDraft = { name: s.Name, credential: s.Credential || "" };
                            sources();
                            target.querySelector<HTMLInputElement>("[data-config-transient] input")?.focus();
                        },
                        "quiet",
                    ),
                );
                if (sourceDraft?.name === s.Name) {
                    const draft = sourceDraft;
                    const form = node("div");
                    form.className = "lb-service-editor";
                    form.dataset.configTransient = "true";
                    const title = node("h4", "Edit " + s.Name);
                    title.className = "lb-settings-editor-title";
                    form.append(title);
                    field(form, "Credential", draft.credential, "password", (value) => {
                        draft.credential = value;
                    });
                    const instructions = node("details");
                    instructions.append(node("summary", "Setup instructions"));
                    guidance(instructions, sourceHelp[s.Name] || []);
                    const actions = node("div");
                    actions.className = "lb-actions";
                    const close = () => {
                        sourceDraft = null;
                        editing("source", false);
                        sources();
                    };
                    actions.append(
                        button("Apply", () => {
                            s.Credential = draft.credential;
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
            if (!["Spotify", "AppleMusic", "Musixmatch"].includes(s.Name)) {
                const edit = button("Edit", null, "quiet");
                edit.title = "This source has no editable settings.";
                header.actions.append(edit);
            }
            target.append(row);
        });
    }
    function positionFooter() {
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
    const resetOpen = query("#lb-reset-open"),
        resetConfirm = query("#lb-reset-confirm"),
        resetWord = query("#lb-reset-word"),
        resetSubmit = query("#lb-reset-submit"),
        resetStatus = query("#lb-reset-status");
    resetOpen.onclick = () => {
        resetConfirm.hidden = false;
        resetOpen.hidden = true;
        resetWord.focus();
    };
    resetWord.oninput = () => {
        resetSubmit.disabled = resetWord.value !== "RESET";
    };
    query("#lb-reset-cancel").onclick = () => {
        resetConfirm.hidden = true;
        resetOpen.hidden = false;
        resetWord.value = "";
        resetSubmit.disabled = true;
        notice(resetStatus, "");
        resetOpen.focus();
    };
    resetSubmit.onclick = async () => {
        resetSubmit.disabled = true;
        resetWord.disabled = true;
        query("#lb-reset-cancel").disabled = true;
        notice(resetStatus, "Resetting managed lyric library…");
        try {
            await call("admin/reset", "POST", { confirmation: resetWord.value });
            notice(resetStatus, "Managed lyric library reset. Settings and source-library files were retained.", 4000);
            resetConfirm.hidden = true;
            resetOpen.hidden = false;
            resetWord.value = "";
            resetOpen.focus();
        } catch (caught) {
            const error = hostFailure(caught);
            failure(resetStatus, error.message || "Reset failed. Try again.");
            resetSubmit.disabled = resetWord.value !== "RESET";
        } finally {
            resetWord.disabled = false;
            query("#lb-reset-cancel").disabled = false;
        }
    };
    const tabs = query("#lb-config-tabs");
    const tabNames = ["General", "Sources", "Services", "Display defaults", "Requests"];
    function activateTab(index: number, focus = false) {
        if (typeof tabs.selectedIndex === "function") tabs.selectedIndex(index, false);
        page.querySelectorAll<HTMLElement>("[data-tab]").forEach((panel, i) => (panel.hidden = i !== index));
        tabs.querySelectorAll<HTMLElement>("[role=tab]").forEach((tab, i) => {
            tab.setAttribute("aria-selected", String(i === index));
            tab.classList.toggle("emby-tab-button-active", i === index);
            tab.tabIndex = i === index ? 0 : -1;
            if (i === index && focus) tab.focus();
        });
        if (index === 4 && loaded && feedbackVisible) void loadRequests();
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
            config = await ApiClient.getPluginConfiguration(id);
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
            if (feedbackVisible && !page.querySelector<HTMLElement>('[data-tab="Requests"]')!.hidden) void loadRequests();
            saveButton.disabled = false;
            notice(status, "");
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
        }
    });
    query("form").addEventListener("input", changed);
    query("form").addEventListener("change", changed);
    query("form").onsubmit = async (event) => {
        event.preventDefault();
        if (!loaded || loading || saveButton.disabled) return;
        saveButton.disabled = true;
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
        notice(status, "Saving…");
        try {
            const revision = configRevision,
                snapshot = JSON.parse(JSON.stringify(config));
            const storageChanged = snapshot.StoragePath !== savedConfig.StoragePath;
            await ApiClient.updatePluginConfiguration(id, snapshot);
            savedConfig = snapshot;
            storageRuntime = await call<typeof storageRuntime>("admin/runtime").catch(() => ({
                ...storageRuntime,
                restartRequired: storageRuntime.restartRequired || storageChanged,
            }));
            rendererRuntime = await call<WebRendererStatus>("admin/web-renderer/repair", "POST").catch(() => undefined);
            refreshDependentControls();
            dirty = revision !== configRevision;
            notice(status, dirty ? "Unsaved changes" : "Settings saved", dirty ? 0 : 4000);
        } catch {
            dirty = true;
            failure(status, "Settings were not saved. Check the values and try again.");
        } finally {
            saveButton.disabled = !loaded;
        }
    };
    const queueStatus = query("#lb-queue-status");
    let queueOffset = 0;
    let queueRevision = 0;
    async function loadRequests() {
        const revision = ++queueRevision;
        const current = () => feedbackVisible && revision === queueRevision;
        query("#lb-refresh").setAttribute("aria-busy", "true");
        notice(queueStatus, "Loading requests…");
        try {
            const jobs = await call<JobSummary[]>("jobs?offset=" + queueOffset + "&limit=50");
            if (!current()) return;
            notice(queueStatus, "");
            const target = query("#lb-queue");
            target.replaceChildren();
            const retention = node("p", "Finished requests are kept for 30 days.");
            retention.className = "fieldDescription";
            const cleanup = node("div");
            cleanup.className = "lb-actions";
            const cleanupStatus = node("div");
            let removing = false;
            const remove = async (ids: string[]) => {
                if (removing || !feedbackVisible) return;
                removing = true;
                const controls = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).map((control) => ({
                    control,
                    disabled: control.disabled,
                }));
                controls.forEach(({ control }) => {
                    control.disabled = true;
                });
                notice(cleanupStatus, "Removing finished requests…");
                cleanupStatus.setAttribute("aria-busy", "true");
                try {
                    for (let first = 0; first < ids.length; first += 500) {
                        if (!feedbackVisible) return;
                        await call("jobs/history/remove", "POST", { ids: ids.slice(first, first + 500) });
                    }
                    if (!feedbackVisible || !target.isConnected) return;
                    queueOffset = 0;
                    query("#lb-refresh").click();
                } catch (error) {
                    failure(cleanupStatus, hostFailure(error).message ?? "History could not be removed.");
                } finally {
                    removing = false;
                    cleanupStatus.setAttribute("aria-busy", "false");
                    controls.forEach(({ control, disabled }) => {
                        if (control.isConnected) control.disabled = disabled;
                    });
                }
            };
            const confirmRemoval = (ids: string[]) =>
                feedbackScope.update(cleanupStatus, {
                    message:
                        "Remove " +
                        ids.length +
                        " finished request" +
                        (ids.length === 1 ? "" : "s") +
                        " from history? Saved results remain. These requests will no longer be retryable.",
                    severity: "warning",
                    actions: [
                        { label: "Remove from history", destructive: true, run: () => remove(ids) },
                        { label: "Cancel", run: () => notice(cleanupStatus, "") },
                    ],
                });
            cleanup.append(
                button(
                    "Clear finished history",
                    async () => {
                        try {
                            const result = await call<{ ids: string[] }>("jobs/history/finished");
                            if (!feedbackVisible || !cleanupStatus.isConnected) return;
                            if (result.ids.length) confirmRemoval(result.ids);
                            else notice(cleanupStatus, "No finished requests to remove.");
                        } catch (error) {
                            failure(cleanupStatus, hostFailure(error).message ?? "History could not be loaded.");
                        }
                    },
                    "quiet",
                ),
            );
            if (!jobs.length) {
                target.append(node("p", queueOffset ? "No more requests" : "No requests yet"));
            }
            for (const job of jobs) {
                const row = node("div");
                row.className = "lb-settings-row";
                const heading = settingsRowHeader(
                    job.request.kind + (job.request.language ? " · " + job.request.language : ""),
                    job.progress + "%" + (job.stage ? " · " + job.stage : ""),
                    job.state,
                );
                row.append(heading.root);
                if (job.audio?.allowChunking) row.append(node("p", "Chunking requested · " + job.audio.chunkCount + " chunks · one request"));

                if (job.outputDeleted)
                    row.append(
                        node(
                            "p",
                            "Output deleted" +
                                (job.outputDeletedAt ? " · " + new Date(job.outputDeletedAt).toLocaleString() : "") +
                                " · Job history retained",
                        ),
                    );
                if (job.error) {
                    const error = node("div");
                    error.className = "fieldDescription lb-action-status";
                    error.dataset.state = "error";
                    error.setAttribute("role", "alert");
                    feedbackScope.update(error, {
                        message: job.error,
                        severity: "error",
                        details: job.failure?.diagnosticId ? ["Diagnostic ID: " + job.failure.diagnosticId] : [],
                    });
                    row.append(error);
                }
                const actions = job.outputDeleted
                    ? []
                    : job.state === "pending"
                      ? ["approve", "reject", "cancel"]
                      : ["queued", "running"].includes(job.state)
                        ? ["cancel"]
                        : ["failed", "settings_changed"].includes(job.state)
                          ? ["retry"]
                          : [];
                let retryPlan: { identity: string; requestCount: number } | null = null;
                for (const action of actions) {
                    const actionButton = button(
                        action.charAt(0).toUpperCase() + action.slice(1),
                        async () => {
                            try {
                                await call(
                                    "jobs/" + job.id + "/" + action + (retryPlan ? "?planIdentity=" + encodeURIComponent(retryPlan.identity) : ""),
                                    "POST",
                                );
                                query("#lb-refresh").click();
                            } catch (caught) {
                                const error = hostFailure(caught);
                                failure(queueStatus, error.message ?? "Request failed.");
                            }
                        },
                        "quiet",
                    );
                    heading.actions.append(actionButton);
                    if (action === "retry" && job.taskKind === "boundary-review") {
                        actionButton.disabled = true;
                        void call<{ identity: string; requestCount: number }>("jobs/" + job.id + "/review-plan", "POST")
                            .then((plan) => {
                                if (!actionButton.isConnected) return;
                                retryPlan = plan;
                                actionButton.textContent =
                                    "Retry · " + plan.requestCount + (plan.requestCount === 1 ? " AI request" : " AI requests");
                                actionButton.disabled = false;
                            })
                            .catch(() => {
                                actionButton.title = "Could not plan retry. Refresh requests after checking the service configuration.";
                            });
                    }
                }

                if (["complete", "failed", "cancelled", "rejected", "settings_changed"].includes(job.state))
                    heading.actions.append(button("Remove from history", () => confirmRemoval([job.id]), "quiet"));
                if (job.reviewPlan)
                    row.append(node("p", job.reviewPlan.requestCount + (job.reviewPlan.requestCount === 1 ? " AI request" : " AI requests")));
                const edit = button("Edit", null, "quiet");
                edit.title = "Request history has no editable settings.";
                heading.actions.append(edit);
                row.querySelectorAll(":scope > p").forEach((note) => note.classList.add("fieldDescription", "lb-settings-row-description"));
                target.append(row);
            }
            const navigation = node("div");
            navigation.className = "lb-actions";
            if (queueOffset > 0)
                navigation.append(
                    button("Newer requests", () => {
                        queueOffset = Math.max(0, queueOffset - 50);
                        query("#lb-refresh").click();
                    }),
                );
            if (jobs.length === 50)
                navigation.append(
                    button("Older requests", () => {
                        queueOffset += 50;
                        query("#lb-refresh").click();
                    }),
                );
            if (jobs.some((job) => ["complete", "failed", "cancelled", "rejected", "settings_changed"].includes(job.state))) target.append(cleanup);
            target.append(cleanupStatus);
            if (jobs.length) target.append(retention);
            if (navigation.childElementCount) target.append(navigation);
        } catch (caught) {
            if (!current()) return;
            const error = hostFailure(caught);
            failure(queueStatus, (error.message || "Requests could not be loaded.") + " Select Refresh to retry.");
        } finally {
            if (current()) query("#lb-refresh").setAttribute("aria-busy", "false");
        }
    }
    query("#lb-refresh").onclick = () => void loadRequests();
})();
