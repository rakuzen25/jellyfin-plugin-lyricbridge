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
    const noticeTimers = new Map<HTMLElement, { timer?: number }>();
    function notice(target: HTMLElement, message: string, ttl = 0) {
        const old = noticeTimers.get(target);
        if (old) clearTimeout(old.timer);
        noticeTimers.delete(target);
        target.textContent = message;
        target.hidden = !message;
        target.setAttribute("role", "status");
        if (ttl && message) {
            const ticket: { timer?: number } = {};
            ticket.timer = setTimeout(() => {
                if (noticeTimers.get(target) !== ticket) return;
                noticeTimers.delete(target);
                if (target.isConnected && target.textContent === message) {
                    target.textContent = "";
                    target.hidden = true;
                }
            }, ttl);
            noticeTimers.set(target, ticket);
        }
    }
    function failure(target: HTMLElement, message: string) {
        notice(target, message);
        target.setAttribute("role", "alert");
        target.append(button("Dismiss", () => notice(target, target === status && dirty ? "Unsaved changes" : "")));
    }
    page.addEventListener("viewhide", () => {
        window.removeEventListener("resize", positionFooter);
        for (const ticket of noticeTimers.values()) clearTimeout(ticket.timer);
        noticeTimers.clear();
    });
    function changed() {
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
    const serviceHelp: Record<string, { steps: string[]; link?: string[] }> = {
        DeepL: {
            steps: [
                "Create a DeepL API account and copy a key from the account’s API Keys tab. Paste the key below; a normal translator subscription alone does not configure API access.",
                "For API Free, leave Endpoint blank or use https://api-free.deepl.com/v2/translate. For API Pro, use https://api.deepl.com/v2/translate. Enter the complete translation URL, including /v2/translate.",
                "Save settings, then Test connection. DeepL supplies translations only.",
            ],
            link: ["DeepL API setup", "https://developers.deepl.com/docs/getting-started/auth"],
        },
        AI: {
            steps: [
                "Use a service exposing a Chat Completions compatible API. Enter its API base URL, for example https://your-provider.example/v1. LyricBridge adds /chat/completions; do not include that suffix yourself.",
                "Enter the provider’s API key (without Bearer) if required and the exact model ID supported by that endpoint. The model must support JSON-object output with preserved line IDs.",
                "For a local server, use an address reachable from the Jellyfin container; localhost refers to Jellyfin’s container. Save settings, then Test connection. Translation and pronunciation can be requested explicitly.",
            ],
        },
        LibreTranslate: {
            steps: [
                "Run a LibreTranslate server or use a hosted instance. Enter its base URL, for example http://libretranslate:5000 on a shared Docker network. LyricBridge adds /translate; do not include that suffix yourself.",
                "Enter an API key if that instance requires one; otherwise leave it blank. Use a container-reachable address rather than your browser’s localhost. The server must have the requested language models installed.",
                "Save settings, then Test connection. LibreTranslate supplies translations only.",
            ],
            link: ["LibreTranslate installation and API keys", "https://docs.libretranslate.com/"],
        },
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
    function feedback(parent: HTMLElement) {
        const n = node("div");
        n.className = "fieldDescription lb-action-status";
        n.setAttribute("role", "status");
        n.setAttribute("aria-live", "polite");
        parent.append(n);
        return n;
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
    function button(label: string, action: (event: MouseEvent) => void) {
        const b = document.createElement("button");
        b.setAttribute("is", "emby-button");
        b.className = "raised emby-button";
        b.type = "button";
        b.append(node("span", label));
        b.onclick = action;
        return b;
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
            row.className = "lb-source-row";
            const header = node("div");
            header.className = "flex align-items-center lb-provider-heading";
            row.append(header);
            const requiresCredential = ["Spotify", "AppleMusic"].includes(s.Name);
            const checkbox = check(header, s.Name, s.Enabled, (v) => {
                s.Enabled = v;
                refreshSourceState();
            });
            const sourceLabel = checkbox.parentElement!.lastElementChild!;
            function refreshSourceState() {
                const missing = requiresCredential && !s.Credential?.trim();
                checkbox.disabled = missing;
                checkbox.checked = !!s.Enabled && !missing;
                const badge = node("span", missing ? "Needs credentials" : s.Enabled ? "Ready" : "Disabled");
                badge.className = "lb-config-badge";
                sourceLabel.replaceChildren(node("span", s.Name + " "), badge);
                checkbox.title = missing ? "Set up credentials below to enable this source." : "";
            }
            refreshSourceState();
            const move = (delta: number) => {
                const next = index + delta;
                if (next < 0 || next >= config.Sources.length) return;
                [config.Sources[index], config.Sources[next]] = [config.Sources[next]!, config.Sources[index]!];
                sources();
                changed();
            };
            for (const [delta, icon, label] of [
                [-1, "keyboard_arrow_up", "Move up"],
                [1, "keyboard_arrow_down", "Move down"],
            ] as const) {
                const b = button(label, () => move(delta));
                b.className = "paper-icon-button-light";
                b.setAttribute("aria-label", label + " " + s.Name);
                b.title = label;
                b.dataset.tooltip = label;
                b.disabled = index + delta < 0 || index + delta >= config.Sources.length;
                const symbol = node("span", icon);
                symbol.className = "material-icons";
                symbol.setAttribute("aria-hidden", "true");
                b.replaceChildren(symbol);
                header.append(b);
            }
            if (["Spotify", "AppleMusic", "Musixmatch"].includes(s.Name)) {
                const details = node("details");
                details.open = ["Spotify", "AppleMusic"].includes(s.Name) && !s.Credential;
                const instructions = node("details");
                instructions.append(node("summary", "Setup instructions"));
                guidance(instructions, sourceHelp[s.Name] || []);
                details.append(
                    node(
                        "summary",
                        s.Name === "Spotify"
                            ? "Set up Spotify cookie"
                            : s.Name === "AppleMusic"
                              ? "Set up media-user token"
                              : "Optional Musixmatch token",
                    ),
                );
                details.prepend(details.querySelector("summary")!);
                field(details, "Credential", s.Credential, "password", (v) => {
                    s.Credential = v;
                    refreshSourceState();
                });
                details.append(instructions);
                row.append(details);
            } else if (s.Name === "Soda") {
                const help = node("p", "Availability varies by region.");
                help.className = "fieldDescription";
                row.append(help);
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
        query("#lb-web-status").textContent = rendererRuntime
            ? `${rendererRuntime.result}. Mechanism: ${rendererRuntime.mechanism}. Web root: ${rendererRuntime.webRoot}`
            : "Renderer status unavailable — use Repair to retry.";
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
            ["AllowUserRequests", "#lb-requests"],
            ["AutoApproveUserRequests", "#lb-approval"],
        ] as const)
            query(selector).checked = config[key];
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
        const serviceTarget = query("#lb-services");
        serviceTarget.replaceChildren();
        config.Services.forEach((s) => {
            const row = node("div");
            const card = node("details");
            card.className = "lb-service";
            card.dataset.service = s.Name;
            row.className = "lb-service-body";
            const isConfigured = () =>
                s.Name === "Google" ||
                (s.Name === "DeepL" ? !!s.ApiKey?.trim() : s.Name === "AI" ? !!s.Endpoint?.trim() && !!s.Model?.trim() : !!s.Endpoint?.trim());
            const configured = isConfigured();
            const advanced = node("details");
            advanced.append(node("summary", "Advanced generation settings"));
            const heading = node(
                "summary",
                s.Name + " — " + (s.Name === "Google" ? "Ready · No setup required" : configured ? "Configured · Test connection" : "Needs setup"),
            );
            heading.className = "lb-service-heading";
            const badge = node("span", configured ? "Configured" : "Needs setup");
            badge.className = "lb-config-badge";
            const capabilityText: Record<string, string> = {
                Google: "Translation · Pronunciation: Japanese, Korean, Chinese, Russian, Arabic, Hindi, Thai, Greek",
                DeepL: "Translation only · Languages supported by DeepL",
                AI: "Translation · Pronunciation · Languages depend on the model",
                LibreTranslate: "Translation only · Languages installed on your server",
            };
            const capability = node("span", capabilityText[s.Name] || "Translation");
            capability.className = "fieldDescription lb-service-capability";
            const setupLabel = node("span", configured ? "Options" : "Set up");
            const main = node("span");
            main.className = "lb-service-main";
            main.append(node("span", s.Name), badge, capability);
            heading.replaceChildren(main, setupLabel);
            card.append(heading, row);
            card.open = false;
            if (s.Name !== "Google") {
                const details = node("div");
                details.className = "lb-connection-settings";
                const help = node("details");
                help.append(node("summary", "How to set up " + s.Name));
                guidance(help, serviceHelp[s.Name]?.steps || [], serviceHelp[s.Name]?.link);
                const endpoint = field(
                    details,
                    s.Name === "DeepL" ? "Translation endpoint (optional for API Free)" : "API base URL",
                    s.Endpoint,
                    "url",
                    (v) => (s.Endpoint = v),
                );
                endpoint.placeholder =
                    s.Name === "DeepL"
                        ? "https://api-free.deepl.com/v2/translate"
                        : s.Name === "AI"
                          ? "https://your-provider.example/v1"
                          : "http://libretranslate:5000";
                field(details, "API key" + (s.Name === "DeepL" ? "" : " (if required)"), s.ApiKey, "password", (v) => (s.ApiKey = v));
                if (s.Name === "AI") {
                    field(details, "Model ID", s.Model, "text", (v) => (s.Model = v));
                    select(
                        advanced,
                        "Thinking level",
                        s.ReasoningEffort || "",
                        [
                            ["", "Provider default"],
                            ["none", "None"],
                            ["minimal", "Minimal"],
                            ["low", "Low"],
                            ["medium", "Medium"],
                            ["high", "High"],
                            ["xhigh", "Extra high"],
                        ],
                        (v) => (s.ReasoningEffort = v),
                    );
                    const note = node(
                        "p",
                        "Supported thinking levels depend on the endpoint and model. Use Provider default if unsupported; higher levels may need a longer timeout.",
                    );
                    note.className = "fieldDescription";
                    advanced.append(note);
                }
                details.append(help);
                row.append(details);
            } else {
                const help = node("p", "Requests use Google’s web service; availability and rate limits can vary.");
                help.className = "fieldDescription";
                row.append(help);
            }
            if (s.Name !== "AI") {
                const context = node("details");
                context.append(node("summary", "Translation context (optional)"));
                const help = node(
                    "p",
                    s.Name === "DeepL"
                        ? "Nearby original lines are sent through DeepL’s context field; only the target line is translated."
                        : "Nearby original lines surround a marked target line. Results are rejected if the target markers are lost. Extra context may change accuracy and increase request size.",
                );
                help.className = "fieldDescription";
                context.append(help);
                for (const [key, label] of [
                    ["ContextBefore", "Lines before"],
                    ["ContextAfter", "Lines after"],
                ] as const) {
                    const input = field(context, label, s[key] || 0, "number", (v) => (s[key] = v));
                    input.min = "0";
                    input.max = "10";
                    input.step = "1";
                    input.required = true;
                }
                const note = node("p", "0 disables context on that side; maximum 10. Applies to new translations only.");
                note.className = "fieldDescription";
                context.append(note);
                advanced.append(context);
            } else {
                const help = node("p", "AI receives the complete song as context.");
                help.className = "fieldDescription";
                row.append(help);
            }
            const timeout = field(advanced, "HTTP timeout (seconds)", s.TimeoutSeconds ?? 15, "number", (v) => (s.TimeoutSeconds = v));
            timeout.min = "5";
            timeout.max = "600";
            timeout.step = "1";
            timeout.required = true;
            row.append(advanced);

            const result = feedback(row);
            const testButton = button("Test connection", async () => {
                if (JSON.stringify(s) !== JSON.stringify(savedConfig.Services.find((v) => v.Name === s.Name))) {
                    notice(result, "Save settings before testing this connection.");
                    query(".lb-config-footer .button-submit").focus();
                    return;
                }
                result.dataset.state = "loading";
                result.setAttribute("role", "status");
                notice(result, "Testing with synthetic text…");
                testButton.disabled = true;
                try {
                    await call("services/" + s.Name + "/test", "POST");
                    result.dataset.state = "success";
                    notice(result, s.Name + ": connection succeeded.", 4000);
                } catch (caught) {
                    const error = hostFailure(caught);
                    result.dataset.state = "error";
                    result.setAttribute("role", "alert");
                    notice(result, s.Name + " connection failed: " + error.message + " Use Test connection to retry.");
                    if (error.details?.diagnosticId) {
                        const reference = node("div", "Diagnostic ID: " + error.details.diagnosticId);
                        result.append(reference);
                    }
                    result.append(button("Dismiss", () => notice(result, "")));
                } finally {
                    testButton.disabled = !isConfigured();
                }
            });
            testButton.disabled = !configured;
            testButton.title = configured ? "" : "Complete this service’s setup before testing.";
            row.append(testButton, result);
            row.addEventListener("input", () => {
                badge.textContent = isConfigured() ? "Configured" : "Needs setup";
                setupLabel.textContent = isConfigured() ? "Options" : "Set up";
                const edited = JSON.stringify(s) !== JSON.stringify(savedConfig.Services.find((v) => v.Name === s.Name));
                if (edited) notice(result, "Save settings before testing.");
                testButton.disabled = !isConfigured();
                testButton.title = isConfigured() ? "Save settings before testing." : "Complete this service’s setup before testing.";
            });
            serviceTarget.append(card);
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
        resetStatus.textContent = "";
        resetOpen.focus();
    };
    resetSubmit.onclick = async () => {
        resetSubmit.disabled = true;
        resetWord.disabled = true;
        query("#lb-reset-cancel").disabled = true;
        resetStatus.textContent = "Resetting managed lyric library…";
        try {
            await call("admin/reset", "POST", { confirmation: resetWord.value });
            resetStatus.textContent = "Managed lyric library reset. Settings and source-library files were retained.";
            resetConfirm.hidden = true;
            resetOpen.hidden = false;
            resetWord.value = "";
            resetOpen.focus();
        } catch (caught) {
            const error = hostFailure(caught);
            resetStatus.textContent = error.message || "Reset failed. Try again.";
            resetSubmit.disabled = resetWord.value !== "RESET";
        } finally {
            resetWord.disabled = false;
            query("#lb-reset-cancel").disabled = false;
        }
    };
    const tabs = query("#lb-config-tabs");
    const tabNames = ["General", "Sources", "Language services", "Display defaults", "Requests"];
    function activateTab(index: number, focus = false) {
        if (typeof tabs.selectedIndex === "function") tabs.selectedIndex(index, false);
        page.querySelectorAll<HTMLElement>("[data-tab]").forEach((panel, i) => (panel.hidden = i !== index));
        tabs.querySelectorAll<HTMLElement>("[role=tab]").forEach((tab, i) => {
            tab.setAttribute("aria-selected", String(i === index));
            tab.classList.toggle("emby-tab-button-active", i === index);
            tab.tabIndex = i === index ? 0 : -1;
            if (i === index && focus) tab.focus();
        });
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
            savedConfig = JSON.parse(JSON.stringify(config));
            storageRuntime = await call<typeof storageRuntime>("admin/runtime").catch(() => ({}));
            rendererRuntime = await call<WebRendererStatus>("admin/web-renderer").catch(() => undefined);
            render();
            dirty = false;
            loaded = true;
            saveButton.disabled = false;
            notice(status, "");
        } catch (caught) {
            hostFailure(caught);
            console.error("LyricBridge configuration could not be loaded.");
            failure(status, "Settings could not load.");
            status.append(button("Retry", loadSettings));
        } finally {
            loading = false;
        }
    }
    page.addEventListener("viewshow", () => {
        window.addEventListener("resize", positionFooter);
        positionFooter();
        if (!loaded) loadSettings();
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
    query("#lb-refresh").onclick = async () => {
        queueStatus.textContent = "Loading requests…";
        try {
            const jobs = await call<JobSummary[]>("jobs?offset=" + queueOffset + "&limit=50");
            queueStatus.textContent = "";
            const target = query("#lb-queue");
            target.replaceChildren();
            if (!jobs.length) target.append(node("p", "No requests"));
            for (const job of jobs) {
                const row = node("div");
                row.className = "verticalSection";
                row.append(node("p", job.request.kind + " · " + job.request.language + " · " + job.state + " · " + job.progress + "%"));
                if (job.error) {
                    const error = node("div", job.error);
                    error.className = "fieldDescription lb-action-status";
                    error.dataset.state = "error";
                    error.setAttribute("role", "alert");
                    if (job.failure?.diagnosticId) error.append(node("div", "Diagnostic ID: " + job.failure.diagnosticId));
                    row.append(error);
                }
                const actions =
                    job.state === "pending"
                        ? ["approve", "reject", "cancel"]
                        : ["queued", "running"].includes(job.state)
                          ? ["cancel"]
                          : ["failed", "settings_changed"].includes(job.state)
                            ? ["retry"]
                            : [];
                for (const action of actions)
                    row.append(
                        button(action.charAt(0).toUpperCase() + action.slice(1), async () => {
                            try {
                                await call("jobs/" + job.id + "/" + action, "POST");
                                query("#lb-refresh").click();
                            } catch (caught) {
                                const error = hostFailure(caught);
                                failure(queueStatus, error.message ?? "Request failed.");
                            }
                        }),
                    );
                target.append(row);
            }
            const navigation = node("div");
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
            target.append(navigation);
        } catch (caught) {
            const error = hostFailure(caught);
            failure(queueStatus, error.message + " Refresh queue to retry.");
        }
    };
})();
