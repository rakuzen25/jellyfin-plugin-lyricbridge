import { createUpgradesPanel } from "./upgrades-panel.ts";
import { FeedbackScope } from "../shared/feedback.ts";
import type { DataHost } from "./data/data-contracts.ts";
import { createDataPanel } from "./data/data-panel.ts";
import { createRequestsPanel } from "./requests/requests-panel.ts";
import { renderServices } from "./services/services-panel.ts";
import type { Configuration, WebRendererStatus } from "./settings/contracts.ts";
import { hostFailure } from "./settings/contracts.ts";
import { SettingsController, type SettingsSnapshot } from "./settings/settings-controller.ts";
import { createDiscardDialog, createNavigationGuard } from "./settings/unsaved-changes.ts";
import { same, sameEditorValues } from "./settings/settings-draft.ts";
import { createSourcesSection } from "./sources/source-section.ts";
import { adminButton as button } from "./ui/controls.ts";
import { materialFeedback } from "./ui/feedback.ts";
import { rowAction, settingsRowHeader } from "./ui/settings-row.ts";
import { revealSelectedTab } from "./ui/ui.ts";
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
    const upgradeSurface = node("section");
    upgradeSurface.className = "lb-settings-surface";
    upgradeSurface.hidden = true;
    upgradeSurface.setAttribute("aria-label", "Plugin startup and upgrades");
    query("#lb-config-tabs").before(upgradeSurface);
    const upgrades = createUpgradesPanel(upgradeSurface, call);
    let config: Configuration, savedConfig: Configuration;
    let saving = false;
    const settings = new SettingsController(call);
    const conflictPanel = node("section");
    conflictPanel.className = "lb-settings-surface";
    conflictPanel.hidden = true;
    conflictPanel.setAttribute("aria-label", "Settings conflict");
    query("#lb-config-tabs").after(conflictPanel);
    let rendererRuntime: WebRendererStatus | undefined;
    let storageRuntime: { activeStoragePath?: string; configuredStoragePath?: string; restartRequired?: boolean } = {};
    let dirty = false,
        loaded = false,
        loading = false;
    const saveButton = query(".lb-config-footer .button-submit");
    let activeEditor: "source" | "service" | null = null;
    let servicesSection: ReturnType<typeof renderServices> | undefined;
    const discardDialog = createDiscardDialog(page);
    const editorSession = () => (activeEditor === "source" ? sourcesSection : activeEditor === "service" ? servicesSection : undefined);
    const editorChanged = () => {
        updateDirtyMarkers();
        navigation?.update();
    };
    const unsaved = () => (!!config && !!savedConfig && !sameEditorValues(config, savedConfig)) || !!editorSession()?.hasChanges();
    const confirmDiscard = (discard: () => void) =>
        discardDialog.open("Discard changes to this editor?", [{ label: "Discard changes", run: discard }]);
    const sourcesSection = createSourcesSection({
        query: (...args) => query(...args),
        get config() {
            return config;
        },
        set config(value) {
            config = value;
        },
        node: (...args) => node(...args),
        check: (...args) => check(...args),
        changed: (...args) => changed(...args),
        editing: (...args) => editing(...args),
        editorChanged,
        confirmDiscard,
        failure: (...args) => failure(...args),
    });
    const { sources } = sourcesSection;
    function editing(owner: "source" | "service", value: boolean, resume?: () => void) {
        if (value && (!loaded || loading)) {
            notice(status, "Wait for settings to finish loading before opening an editor.");
            return false;
        }
        if (value && saving) {
            notice(status, "Wait for settings to finish saving before opening an editor.");
            return false;
        }
        if (value && activeEditor !== null) {
            const previousOwner = activeEditor;
            const session = editorSession();
            if (!session?.hasChanges()) {
                session?.discard();
            } else {
                const current = page.querySelector<HTMLElement>(
                    (previousOwner === "source" ? "#lb-sources" : "#lb-services") + " .lb-service-editor",
                );
                const switchEditor = (apply: boolean) => {
                    if (apply) {
                        const control = Array.from(current?.querySelectorAll<HTMLButtonElement>(".lb-actions > button") || []).find(
                            (candidate) => candidate.textContent?.trim() === "Apply",
                        );
                        control?.click();
                    } else session.discard();
                    if (activeEditor === null) {
                        activateTab(owner === "source" ? 1 : 2);
                        resume?.();
                    }
                };
                activateTab(previousOwner === "source" ? 1 : 2);
                const disclosure = current?.closest("details");
                if (disclosure) disclosure.open = true;
                discardDialog.open("You have an unfinished edit. Apply or discard it before switching rows.", [
                    { label: "Apply and switch", run: () => switchEditor(true) },
                    { label: "Discard and switch", run: () => switchEditor(false) },
                ]);
                return false;
            }
        }
        activeEditor = value ? owner : null;
        saveButton.disabled = value || !loaded;
        notice(status, value ? "Apply adds this edit to your draft. Save settings persists all changes." : dirty ? "Unsaved changes" : "");
        editorChanged();
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
        upgrades.dispose();
        feedbackVisible = false;
        navigation?.active(false);
        requestsPanel.hide();
        window.removeEventListener("resize", positionFooter);
        feedbackScope.dispose();
    });
    page.addEventListener("viewdestroy", () => {
        upgrades.dispose();
        feedbackVisible = false;
        navigation.active(false);
        feedbackScope.dispose();
        servicesSection?.dispose();
        sourcesSection.replaceSourceDraft(null);
        settings.dispose();
    });
    function changed(event?: Event) {
        if (event?.target instanceof Element && event.target.closest("[data-config-transient]")) {
            editorChanged();
            return;
        }
        syncFields();
        settings.replaceDraft(config);
        dirty = settings.snapshot().dirty;
        updateDirtyMarkers();
        notice(status, dirty ? "Unsaved changes" : "");
        refreshDependentControls();
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
            } catch {
                // Invalid error JSON falls back to the HTTP status message below.
            }
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
        servicesSection?.dispose();
        servicesSection = renderServices({
            target: query("#lb-services"),
            setup: config.ServiceSetup,
            savedSetup: savedConfig.ServiceSetup,
            localPolicy: page.querySelector<HTMLElement>("#lb-local-pronunciation")!,
            changed,
            active: () => feedbackVisible,
            editing: (value, resume) => editing("service", value, resume),
            editorChanged,
            confirmDiscard,
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
        unsaved,
        busy: () => loading || !loaded || saving,
        discard: async () => {
            // Confirm successful retrieval before disposing unfinished drafts.
            const snapshot = await call<SettingsSnapshot>("admin/settings");
            activeEditor = null;
            sourcesSection.replaceSourceDraft(null);
            config = snapshot.configuration;
            savedConfig = structuredClone(snapshot.configuration);
            settings.accept(snapshot);
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
            const startup = await upgrades.refresh();
            if (startup.state !== "ready") {
                query("#lb-config-tabs").hidden = true;
                page.querySelectorAll<HTMLElement>('[role="tabpanel"], .lb-config-footer').forEach((element) => {
                    element.hidden = true;
                });
                notice(status, "Plugin work is paused. Review startup status above.");
                return;
            }
            query("#lb-config-tabs").hidden = false;
            page.querySelector<HTMLElement>(".lb-config-footer")!.hidden = false;
            if (!(await settings.load())) {
                loaded = !!settings.snapshot().configuration;
                saveButton.disabled = !loaded || dataMaintenance || activeEditor !== null;
                notice(status, dirty ? "Unsaved changes" : "");
                return;
            }
            const snapshot = settings.snapshot();
            servicesSection?.dispose();
            activeEditor = null;
            sourcesSection.replaceSourceDraft(null);
            config = snapshot.configuration!;
            conflictPanel.hidden = true;
            settings.accept({ configuration: config, revision: snapshot.revision });
            savedConfig = settings.snapshot().baseline!;
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
        navigation?.active(true);
        window.addEventListener("resize", positionFooter);
        positionFooter();
        if (!loaded) loadSettings();
        else {
            void upgrades.refresh();
            refreshDependentControls();
            notice(status, dirty ? "Unsaved changes" : "");
            if (!page.querySelector<HTMLElement>('[data-tab="Requests"]')!.hidden) void loadRequests();
            if (!page.querySelector<HTMLElement>('[data-tab="Data"]')!.hidden && !dataMaintenance) dataPanel.show();
        }
    });
    const navigation = createNavigationGuard({
        unsaved,
        saving: () => saving,
        dialog: discardDialog,
        blocked: () => notice(status, "Wait for settings to finish saving"),
        discard: () => {
            servicesSection?.dispose();
            activeEditor = null;
            sourcesSection.replaceSourceDraft(null);
            config = structuredClone(savedConfig);
            settings.accept({ configuration: config, revision: settings.snapshot().revision });
            dirty = false;
            loaded = false;
            conflictPanel.hidden = true;
            conflictPanel.replaceChildren();
            render();
            saveButton.disabled = true;
            editorChanged();
            notice(status, "");
        },
    });
    page.addEventListener("click", () => queueMicrotask(editorChanged));
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
        navigation?.update();
        if (!config || !savedConfig) return;
        dirty = !sameEditorValues(config, savedConfig);
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
                groups[index]!.some((key) => !sameEditorValues(config[key], savedConfig[key])) ||
                (activeEditor === (index === 1 ? "source" : index === 2 ? "service" : "none") && !!editorSession()?.hasChanges());
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
        settings.replaceDraft(config);
        const comparison = await settings.compare();
        if (!comparison) return;
        const latest = comparison.latest;
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
                Object.keys(latest)
                    .filter((key) => !same(savedConfig[key], latest[key]))
                    .map((key) => areas[key] || "General"),
            ),
        ];
        conflictPanel.hidden = false;
        function show() {
            const result = settings.comparison(choices)!;
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
                              if (!settings.rebase(choices)) {
                                  show();
                                  return;
                              }
                              const rebased = settings.snapshot();
                              config = rebased.configuration!;
                              savedConfig = rebased.baseline!;
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
                        sourcesSection.replaceSourceDraft(null);
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
        navigation?.update();
        saveButton.disabled = true;
        notice(status, "Saving…");
        settings.replaceDraft(config);
        try {
            const unchanged = await settings.save();
            const saved = settings.snapshot();
            config = saved.configuration!;
            savedConfig = saved.baseline!;
            if (unchanged) render();
            storageRuntime = await call<typeof storageRuntime>("admin/runtime").catch(() => storageRuntime);
            rendererRuntime = await call<WebRendererStatus>("admin/web-renderer/repair", "POST").catch(() => undefined);
            refreshDependentControls();
            dirty = settings.snapshot().dirty;
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
            navigation?.update();
            saveButton.disabled = !loaded || activeEditor !== null || dataMaintenance || !conflictPanel.hidden;
        }
    };
    async function loadRequests() {
        await requestsPanel.refresh();
    }
})();
