import { credentialAvailable, credentialEditor } from "./credentials.ts";
import { same } from "./settings-draft.ts";
import { settingsRowHeader, rowAction } from "./settings-row.ts";
import { adminButton as action } from "./controls.ts";
import type { ServiceConnection, ServiceOption, ServiceSetup } from "./contracts.ts";

interface Dependencies {
    target: HTMLElement;
    setup: ServiceSetup;
    savedSetup: ServiceSetup;
    localPolicy: HTMLElement;
    changed(): void;
    active(): boolean;
    editing(value: boolean, resume?: () => void): boolean;
    test(id: string): Promise<void>;
    modelLimits(
        connection: ServiceConnection,
        model: string,
    ): Promise<{ available: boolean; contextWindow: number | null; completionLimit: number | null }>;
    feedback(target: HTMLElement, text: string, error?: boolean): void;
}
const capabilities = [
    ["transcription", "Transcription", "Turn audio into timed original lyrics."],
    ["boundary-review", "Line-break review", "Review phrases while preserving words and timestamps."],
    ["translation", "Translation", "Generate translated lyric rows."],
    ["pronunciation", "Pronunciation", "Generate pronunciation and Japanese romaji."],
] as const;
const providers: Record<string, string> = {
    AI: "AI-compatible",
    DeepL: "DeepL",
    LibreTranslate: "LibreTranslate",
    Google: "Google (built in)",
    Kawazu: "Japanese romaji (local)",
};
const identity = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
const supports = (p: string, c: string) =>
    p === "AI" || (p === "Google" ? c === "translation" || c === "pronunciation" : p === "Kawazu" ? c === "pronunciation" : c === "translation");
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
}
function field(parent: HTMLElement, label: string, value: string | number, run: (value: string) => void, type = "text") {
    const wrap = node("div", undefined, "inputContainer"),
        input = node("input");
    input.setAttribute("is", "emby-input");
    input.setAttribute("label", label);
    input.type = type;
    input.value = String(value);
    input.oninput = () => run(input.value);
    wrap.append(input);
    parent.append(wrap);
    return input;
}
function select(parent: HTMLElement, label: string, value: string, choices: [string, string][], run: (value: string) => void) {
    const wrap = node("div", undefined, "selectContainer"),
        input = node("select");
    input.setAttribute("is", "emby-select");
    input.setAttribute("label", label);
    choices.forEach(([v, text]) => {
        const o = node("option", text);
        o.value = v;
        input.append(o);
    });
    input.value = value;
    input.onchange = () => run(input.value);
    wrap.append(input);
    parent.append(wrap);
    return input;
}
function check(parent: HTMLElement, text: string, checked: boolean, run: (value: boolean) => void) {
    const label = node("label", undefined, "checkboxContainer emby-checkbox-label"),
        input = node("input");
    input.type = "checkbox";
    input.setAttribute("is", "emby-checkbox");
    input.checked = checked;
    input.onchange = () => run(input.checked);
    label.append(input, node("span", text));
    parent.append(label);
    return input;
}
export function renderServices(d: Dependencies) {
    const setup = d.setup;
    let editor: { kind: "option"; value: ServiceOption; isNew: boolean } | { kind: "connection"; value: ServiceConnection; isNew: boolean } | null =
        null;
    const open = new Set<string>();
    const connection = (o: ServiceOption) => setup.Connections.find((c) => c.Id === o.ConnectionId);
    const validEndpoint = (endpoint: string) => {
        try {
            const u = new URL(endpoint);
            return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
        } catch {
            return false;
        }
    };
    const connectionReady = (c: ServiceConnection | undefined) =>
        !!c && (c.Provider === "DeepL" ? credentialAvailable(c, c.ApiKey) && (!c.Endpoint || validEndpoint(c.Endpoint)) : validEndpoint(c.Endpoint));
    const setupReason = (o: ServiceOption) => {
        if (o.Provider === "Google" || o.Provider === "Kawazu") return "";
        if (!connection(o)) return "Choose a connection";
        if (!connectionReady(connection(o))) return "Complete connection setup";
        if (o.Provider === "AI" && !o.Model.trim()) return "Model ID required";
        return "";
    };
    const configured = (o: ServiceOption) => !setupReason(o);
    const status = (o: ServiceOption) =>
        o.Provider === "Google" || o.Provider === "Kawazu" ? "Built in" : configured(o) ? "Configured" : "Needs setup";
    function closeEditor() {
        const previous = editor;
        editor = null;
        d.editing(false);
        render();
        if (previous) {
            const row = d.target.querySelector<HTMLElement>(
                previous.kind === "connection" ? '[data-connection-id="' + previous.value.Id + '"]' : '[data-option-id="' + previous.value.Id + '"]',
            );
            Array.from(row?.querySelectorAll<HTMLButtonElement>("button") || [])
                .find((button) => button.textContent === "Edit")
                ?.focus();
        }
    }
    function begin(value: NonNullable<typeof editor>) {
        if (!d.editing(true, () => begin(value))) return;
        editor = value;
        render();
        d.target.querySelector<HTMLInputElement>("[data-config-transient] input")?.focus();
    }
    function render() {
        // Keep the existing policy control alive across rerenders and configuration saves.
        d.localPolicy.remove();
        d.target.replaceChildren();
        for (const [id, name, description] of capabilities) {
            const card = node("details", undefined, "lb-service lb-settings-surface");
            card.dataset.capability = id;
            card.open = open.has(id);
            card.ontoggle = () => {
                if (card.open) open.add(id);
                else open.delete(id);
            };
            const list = setup.Options.filter((o) => o.Capability === id),
                available = list.filter((o) => o.Enabled && configured(o)).length;
            const state = id === "boundary-review" ? "Built in" : list.some(configured) ? "Configured" : "Needs setup";
            const heading = settingsRowHeader(
                name,
                description + " " + available + " of " + list.length + " options enabled.",
                state,
                node("summary"),
            );
            const chevron = node("span", "", "lb-settings-chevron");
            chevron.setAttribute("aria-hidden", "true");
            heading.actions.append(chevron);
            const summary = heading.root;
            const body = node("div", undefined, "lb-service-body");
            if (id === "boundary-review")
                body.append(node("p", "Automatic phrase breaking runs locally. AI review is optional.", "fieldDescription"));
            for (const o of list) {
                const row = node("div", undefined, "lb-service-option lb-settings-row");
                row.dataset.optionId = o.Id;
                const heading = settingsRowHeader(
                    o.Name,
                    o.Provider === "Kawazu"
                        ? "Local · NMeCab / IpaDic"
                        : o.Provider === "Google"
                          ? "Built in · No connection required"
                          : [connection(o)?.Name || "Choose a connection", o.Model.trim(), setupReason(o)].filter(Boolean).join(" · "),
                    status(o),
                );
                const enabled = check(heading.actions, "Enabled", o.Enabled && configured(o), (value) => {
                    o.Enabled = value;
                    d.changed();
                    render();
                    Array.from(d.target.querySelectorAll<HTMLElement>("[data-option-id]"))
                        .find((row) => row.dataset.optionId === o.Id)
                        ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
                        ?.focus();
                });
                enabled.setAttribute("aria-label", "Enable " + o.Name);
                enabled.disabled = editor !== null || !configured(o);
                const unavailableReason = setupReason(o) || (editor !== null ? "Finish current edit" : "");
                const enabledLabel = enabled.closest<HTMLElement>("label")!;
                if (unavailableReason) {
                    enabled.setAttribute("aria-description", unavailableReason);
                }
                enabledLabel.title = !configured(o) ? unavailableReason + ". Choose Edit to complete setup." : unavailableReason;
                heading.actions.append(rowAction("Edit", () => begin({ kind: "option", value: structuredClone(o), isNew: false }), "quiet"));
                row.append(heading.root);
                if (unavailableReason) heading.body.append(node("p", unavailableReason + ".", "fieldDescription"));
                body.append(row);
                if (editor?.kind === "option" && editor.value.Id === o.Id) body.append(optionEditor(editor));
            }
            if (editor?.kind === "option" && editor.isNew && editor.value.Capability === id) body.append(optionEditor(editor));
            body.append(
                action("Add option", () => {
                    open.add(id);
                    begin({
                        kind: "option",
                        isNew: true,
                        value: {
                            Id: identity(),
                            Name: "",
                            Capability: id,
                            Provider: "AI",
                            ConnectionId: setup.Connections.find((c) => c.Provider === "AI")?.Id || null,
                            Enabled: true,
                            Model: "",
                            TimeoutSeconds: 120,
                            ModelContextWindow: 32768,
                            DetectModelLimits: true,
                            ModelCompletionLimit: null,
                            ReasoningEffort: "",
                            ContextBefore: 0,
                            ContextAfter: 0,
                            UploadFormat: "opus",
                            MaxInputMb: 256,
                            MaxUploadMb: 25,
                        },
                    });
                }),
            );
            if (id === "pronunciation") body.append(d.localPolicy);
            card.append(summary, body);
            d.target.append(card);
        }
        const connections = node("section", undefined, "lb-settings-surface lb-connections");
        d.target.append(connections);
        const heading = node("div", undefined, "lb-section-heading");
        heading.append(node("h3", "Connections", "sectionTitle"));
        connections.append(
            heading,
            node("p", "Shared endpoints and credentials. Models and task settings belong to each capability option.", "fieldDescription"),
        );
        for (const c of setup.Connections) {
            const row = node("div", undefined, "lb-service-option lb-settings-row");
            row.dataset.connectionId = c.Id;
            const used = capabilities
                .filter(([id]) => setup.Options.some((o) => o.Capability === id && o.ConnectionId === c.Id))
                .map(([, name]) => name);
            const heading = settingsRowHeader(
                c.Name,
                providers[c.Provider] + " · " + (used.length ? "Used by " + used.join(", ") : "Not assigned to a capability"),
                connectionReady(c) ? "Configured" : "Needs setup",
            );
            heading.actions.append(rowAction("Edit", () => begin({ kind: "connection", value: structuredClone(c), isNew: false }), "quiet"));
            row.append(heading.root);
            connections.append(row);
            if (editor?.kind === "connection" && editor.value.Id === c.Id) connections.append(connectionEditor(editor));
        }
        if (editor?.kind === "connection" && editor.isNew) connections.append(connectionEditor(editor));
        connections.append(
            action("Add connection", () =>
                begin({ kind: "connection", isNew: true, value: { Id: identity(), Name: "", Provider: "AI", Endpoint: "", ApiKey: "" } }),
            ),
        );
    }
    function optionEditor(edit: Extract<NonNullable<typeof editor>, { kind: "option" }>) {
        const o = edit.value,
            form = node("div", undefined, "lb-service-editor");
        form.dataset.configTransient = "true";
        form.append(node("p", "Apply adds changes to the draft; Save settings persists them.", "fieldDescription"));
        form.append(node("h4", edit.isNew ? "Add option" : "Edit " + o.Name, "lb-settings-editor-title"));
        const errors = node("div", undefined, "lb-service-editor-feedback");
        let scheduleLimits: (() => void) | undefined;
        let limitsPending = false;
        field(form, "Option name", o.Name, (v) => (o.Name = v)).required = true;
        const selection = select(
            form,
            "Provider",
            o.Provider,
            Object.entries(providers).filter(([p]) => supports(p, o.Capability)),
            (v) => {
                o.Provider = v;
                o.ConnectionId = setup.Connections.find((c) => c.Provider === v)?.Id || null;
                render();
            },
        );
        selection.disabled = !edit.isNew;
        if (o.Provider !== "Google" && o.Provider !== "Kawazu") {
            select(
                form,
                "Connection",
                o.ConnectionId || "",
                [
                    ["", "Choose a connection…"],
                    ...setup.Connections.filter((c) => c.Provider === o.Provider).map((c) => [c.Id, c.Name] as [string, string]),
                ],
                (v) => {
                    o.ConnectionId = v || null;
                    scheduleLimits?.();
                },
            );
            if (o.Provider === "AI")
                field(form, "Model ID", o.Model, (v) => {
                    o.Model = v;
                    o.ModelCompletionLimit = null;
                    scheduleLimits?.();
                });
            form.append(
                node("p", "Edit endpoint and credentials under Connections. Model and task settings apply only to this option.", "fieldDescription"),
            );
        }
        if (o.Provider !== "Kawazu") {
            const advanced = node("details");
            advanced.append(node("summary", o.Capability === "transcription" ? "Advanced audio settings" : "Advanced generation settings"));
            field(advanced, "HTTP timeout (seconds)", o.TimeoutSeconds, (v) => (o.TimeoutSeconds = Number(v)), "number");
            if (o.Capability === "boundary-review") {
                // Existing explicit non-default budgets remain manual unless the administrator opts in.
                o.DetectModelLimits ??= o.ModelContextWindow == null || o.ModelContextWindow === 32768;
                let timer: ReturnType<typeof setTimeout> | undefined;
                let revision = 0;
                const automatic = check(advanced, "Detect model limits automatically", o.DetectModelLimits, (value) => {
                    o.DetectModelLimits = value;
                    context.disabled = value;
                    schedule(0);
                });
                const context = field(
                    advanced,
                    "Model context window (tokens)",
                    o.ModelContextWindow ?? 32768,
                    (value) => {
                        o.ModelContextWindow = Number(value);
                        o.ModelCompletionLimit = null;
                    },
                    "number",
                );
                context.min = "1024";
                context.max = "10000000";
                context.disabled = automatic.checked;
                const lookupStatus = node("div", undefined, "fieldDescription");
                const pending = (value: boolean) => {
                    limitsPending = value;
                    if (applyControl) {
                        applyControl.disabled = value;
                        applyControl.setAttribute("aria-busy", String(value));
                    }
                    lookup.disabled = value;
                };
                const identity = () => JSON.stringify([setup.Connections.find((c) => c.Id === o.ConnectionId), o.Model, o.DetectModelLimits]);
                const fallback = (text: string) => {
                    o.ModelContextWindow = 32768;
                    o.ModelCompletionLimit = null;
                    context.value = "32768";
                    d.feedback(lookupStatus, text + " Using the 32,768-token fallback. Turn off automatic detection to enter a manual limit.");
                };
                async function fetchLimits(current: number) {
                    if (!context.isConnected || !d.active() || !automatic.checked || current !== revision) {
                        if (current === revision) pending(false);
                        return;
                    }
                    const connection = setup.Connections.find((c) => c.Id === o.ConnectionId);
                    if (!connection || !o.Model) {
                        pending(false);
                        return;
                    }
                    const baseline = identity();
                    const live = () => context.isConnected && d.active() && current === revision && baseline === identity();
                    d.feedback(lookupStatus, "Fetching model limits…");
                    try {
                        const result = await d.modelLimits(connection, o.Model);
                        if (!live()) return;
                        if (!result.available || result.contextWindow == null) {
                            fallback("The endpoint did not advertise limits for this exact model ID.");
                            return;
                        }
                        o.ModelContextWindow = result.contextWindow;
                        o.ModelCompletionLimit = result.completionLimit;
                        context.value = String(result.contextWindow);
                        d.feedback(lookupStatus, "Model limits detected in this draft. Apply to keep them.");
                    } catch {
                        if (live()) fallback("Model limits could not be fetched.");
                    } finally {
                        if (context.isConnected && current === revision) pending(false);
                    }
                }
                function schedule(delay: number) {
                    clearTimeout(timer);
                    const current = ++revision;
                    if (!automatic.checked || !o.Model || !o.ConnectionId) {
                        pending(false);
                        return;
                    }
                    pending(true);
                    timer = setTimeout(() => void fetchLimits(current), delay);
                }
                const lookup = action("Fetch model limits", () => {
                    o.DetectModelLimits = true;
                    automatic.checked = true;
                    context.disabled = true;
                    schedule(0);
                });
                scheduleLimits = () => schedule(300);
                advanced.append(
                    lookup,
                    lookupStatus,
                    node(
                        "p",
                        "Automatically reads optional metadata from the selected connection and model. If unavailable, uses 32,768 tokens. Turn off detection to override the limit.",
                        "fieldDescription",
                    ),
                );
                queueMicrotask(() => {
                    if (context.isConnected) schedule(0);
                });
            }
            if (o.Capability === "transcription") {
                select(
                    advanced,
                    "Upload format",
                    o.UploadFormat,
                    [
                        ["flac", "FLAC"],
                        ["wav", "WAV"],
                        ["opus", "Opus (OGG)"],
                    ],
                    (v) => (o.UploadFormat = v),
                );
                field(advanced, "Endpoint upload limit (MB)", o.MaxUploadMb, (v) => (o.MaxUploadMb = Number(v)), "number");
                field(advanced, "Input audio limit (MB)", o.MaxInputMb, (v) => (o.MaxInputMb = Number(v)), "number");
                advanced.append(
                    node(
                        "p",
                        "Groq example: whisper-large-v3 · Opus (OGG) · 25 MB. Oversized audio offers explicit chunking and remains one recording/request.",
                        "fieldDescription",
                    ),
                );
            } else if (o.Provider === "AI")
                select(
                    advanced,
                    "Thinking level",
                    o.ReasoningEffort,
                    [["", "Provider default"], ...["none", "minimal", "low", "medium", "high", "xhigh"].map((v) => [v, v] as [string, string])],
                    (v) => (o.ReasoningEffort = v),
                );
            else if (o.Capability === "translation") {
                field(advanced, "Context lines before", o.ContextBefore, (v) => (o.ContextBefore = Number(v)), "number");
                field(advanced, "Context lines after", o.ContextAfter, (v) => (o.ContextAfter = Number(v)), "number");
            }
            form.append(advanced);
        }
        const buttons = node("div", undefined, "lb-actions");
        buttons.append(
            action("Apply", () => {
                if (limitsPending) return;
                if (
                    !o.Name.trim() ||
                    setup.Options.some(
                        (v) => v.Id !== o.Id && v.Capability === o.Capability && v.Name.trim().toLowerCase() === o.Name.trim().toLowerCase(),
                    )
                ) {
                    d.feedback(errors, "Enter a unique option name for this capability.", true);
                    return;
                }
                if (o.Provider !== "Google" && o.Provider !== "Kawazu" && !o.ConnectionId) {
                    d.feedback(errors, "Add a compatible connection below, then choose it here.", true);
                    return;
                }
                o.Name = o.Name.trim();
                if (edit.isNew) setup.Options.push(o);
                else setup.Options = setup.Options.map((v) => (v.Id === o.Id ? o : v));
                d.changed();
                closeEditor();
            }),
            action("Cancel", closeEditor),
        );
        const applyControl = buttons.querySelector<HTMLButtonElement>("button") ?? undefined;
        if (!edit.isNew)
            buttons.append(
                action("Remove option", () => {
                    setup.Options = setup.Options.filter((v) => v.Id !== o.Id);
                    d.changed();
                    closeEditor();
                }),
            );
        if (!edit.isNew && o.Provider !== "Kawazu" && (o.Capability === "translation" || o.Capability === "pronunciation")) {
            const saved = d.savedSetup.Options.find((value) => value.Id === o.Id);
            const savedConnection = d.savedSetup.Connections.find((value) => value.Id === o.ConnectionId);
            const canTest = same(o, saved) && same(connection(o), savedConnection);
            const test = action(
                "Test saved settings",
                canTest
                    ? async () => {
                          test.disabled = true;
                          try {
                              d.feedback(errors, "Testing saved settings with synthetic text…");
                              await d.test(o.Id);
                              d.feedback(errors, "Saved connection succeeded using synthetic text.");
                          } catch {
                              d.feedback(errors, "Saved connection test failed. Check endpoint, credentials and model.", true);
                          } finally {
                              if (test.isConnected) test.disabled = false;
                          }
                      }
                    : null,
            );
            buttons.append(test);
            const explanation = node("p", "Apply and Save settings before testing changes to this option or its connection.", "fieldDescription");
            explanation.hidden = canTest;
            form.append(explanation);
            const markDraft = () => {
                test.disabled = true;
                explanation.hidden = false;
            };
            form.addEventListener("input", markDraft);
            form.addEventListener("change", markDraft);
        }
        form.append(buttons, errors);
        return form;
    }
    function connectionEditor(edit: Extract<NonNullable<typeof editor>, { kind: "connection" }>) {
        const c = edit.value,
            form = node("div", undefined, "lb-service-editor");
        form.dataset.configTransient = "true";
        form.append(node("p", "Apply adds changes to the draft; Save settings persists them.", "fieldDescription"));
        form.append(node("h4", edit.isNew ? "Add connection" : "Edit " + c.Name, "lb-settings-editor-title"));
        const errors = node("div", undefined, "lb-service-editor-feedback"),
            used = setup.Options.some((o) => o.ConnectionId === c.Id);
        field(form, "Connection name", c.Name, (v) => (c.Name = v)).required = true;
        select(
            form,
            "Connection type",
            c.Provider,
            Object.entries(providers).filter(([p]) => p !== "Google" && p !== "Kawazu"),
            (v) => (c.Provider = v),
        ).disabled = used;
        field(form, "API base URL", c.Endpoint, (v) => (c.Endpoint = v), "url");
        credentialEditor(
            form,
            c,
            () => c.ApiKey,
            (value) => {
                c.ApiKey = value;
            },
        );
        form.append(
            node(
                "p",
                c.Provider === "AI"
                    ? "Include /v1 in the API base. Each capability uses its own model and operation path."
                    : c.Provider === "DeepL"
                      ? "Leave the endpoint blank for DeepL API Free, or enter the translation endpoint."
                      : "Use the server base URL; LyricBridge appends /translate.",
                "fieldDescription",
            ),
        );
        if (used)
            form.append(
                node(
                    "p",
                    "Changes apply to every option using this connection. Remove those options before deleting this connection or changing its type.",
                    "fieldDescription",
                ),
            );
        const buttons = node("div", undefined, "lb-actions");
        buttons.append(
            action("Apply", () => {
                if (c.CredentialAction === "replace" && !c.ApiKey.trim()) {
                    d.feedback(errors, "Enter a replacement credential, or choose Keep or Clear.", true);
                    return;
                }
                if (!c.Name.trim() || setup.Connections.some((v) => v.Id !== c.Id && v.Name.trim().toLowerCase() === c.Name.trim().toLowerCase())) {
                    d.feedback(errors, "Enter a unique connection name.", true);
                    return;
                }
                if (c.Endpoint && !validEndpoint(c.Endpoint)) {
                    d.feedback(errors, "Enter a valid HTTP(S) API URL.", true);
                    return;
                }
                c.Name = c.Name.trim();
                if (edit.isNew) setup.Connections.push(c);
                else setup.Connections = setup.Connections.map((v) => (v.Id === c.Id ? c : v));
                d.changed();
                closeEditor();
            }),
            action("Cancel", closeEditor),
        );
        if (!edit.isNew) {
            const remove = action("Delete connection", () => {
                const dependents = setup.Options.filter((o) => o.ConnectionId === c.Id);
                if (dependents.length) {
                    d.feedback(
                        errors,
                        "Cannot delete this connection. Used by: " +
                            dependents.map((o) => o.Name).join(", ") +
                            ". Choose another connection for these options, or remove the options, before deleting it.",
                        true,
                    );
                    return;
                }
                setup.Connections = setup.Connections.filter((v) => v.Id !== c.Id);
                d.changed();
                closeEditor();
            });
            buttons.append(remove);
        }
        form.append(buttons, errors);
        return form;
    }
    render();
}
