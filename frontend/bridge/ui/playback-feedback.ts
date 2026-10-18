import type {} from "../../platform/globals.ts";
import type { BridgeDocument } from "../../contracts/bridge.ts";
import type { RichLyrics } from "../../contracts/lyrics.ts";
import type { AuxiliaryKind } from "../../contracts/preferences.ts";
import type {} from "../../platform/globals.ts";
import type { FeedbackScope } from "../../shared/feedback.ts";
import { type FeedbackAction, type FeedbackSeverity } from "../../shared/feedback.ts";
import { requireValue } from "../../shared/invariants.ts";
import type { Lifecycle } from "../../shared/lifecycle.ts";
import type { TrackScope } from "../session/contracts.ts";
import type { TrackSessionPort } from "../session/ports.ts";
import type { BridgeApi } from "../transport/ports.ts";
import { displayFailure } from "../transport/responses.ts";
import { button, e } from "./controls.ts";
import { feedbackHost } from "./feedback.ts";
import { PlaybackNotifications } from "./playback-notifications.ts";
import type { createSettingsPanel } from "./settings-panel.ts";

interface Dependencies {
    feedbackScope: FeedbackScope;
    retry: () => Promise<void>;
    trackSession: TrackSessionPort;
    safeMessage: (error: unknown) => string;
    trackScope: () => TrackScope;
    isLyrics: () => boolean;
    lyricHost: () => HTMLElement | undefined;
    settingsPanel: ReturnType<typeof createSettingsPanel>;
    closePopup: () => void;
    openPopup: (tabName?: string) => void;
    documentState: () => Readonly<BridgeDocument>;
    lifetime: Lifecycle;
    lyricContainer: () => HTMLElement | undefined;
    render: (doc: RichLyrics | null | undefined) => void;
    searchPopup: HTMLElement | null;
    openVersions: (better?: RichLyrics | null | undefined, mixKind?: AuxiliaryKind | undefined) => Promise<void>;
    api: BridgeApi;
    refreshSong: (force?: boolean) => Promise<void>;
}

/** Owns playback feedback behavior and its installation lifetime. */
export function createPlaybackFeedback(deps: Dependencies) {
    let noticeSequence = 0;
    let tools: HTMLElement | null = null;

    let notifications: PlaybackNotifications | null = null;

    let settingsButton: HTMLButtonElement | null = null;

    let unattributedErrors = new WeakMap<object, string>();

    function notice(node: HTMLElement | null | undefined, message: string, ttl = 0, expire?: () => void, severity?: FeedbackSeverity) {
        if (!node) return;
        deps.feedbackScope.update(node, {
            message,
            severity: severity || (ttl ? "success" : /^(Loading|Searching|Saving|Submitting|Testing)/.test(message) ? "progress" : "info"),
            ttl,
            expire,
        });
    }

    function status(message: string, error = false, ttl = 0, operation = ttl ? "action:status" : "retrieval") {
        ensureTools();
        notifications?.set(
            operation,
            { message, severity: error ? "error" : ttl ? "success" : /^(Loading|Searching|Generating)/.test(message) ? "progress" : "info", ttl },
            operation === "retrieval" ? "lb-status" : operation === "local-pronunciation" ? "lb-local-status" : "lb-action-status",
        );
    }

    function showError(
        cause: unknown,
        parent: HTMLElement | null | undefined = undefined,
        retryAction: () => unknown = deps.retry,
        context: { operation?: string; secondary?: string; severity?: FeedbackSeverity; retryLabel?: string } = {},
    ) {
        const error = displayFailure(cause);
        if (error.name === "AbortError" || (error.scope && error.scope !== deps.trackSession.scope)) return;
        const host = parent?.isConnected ? parent : tools;
        if (!host) return;
        const key = error.noticeKey || error.details?.diagnosticId || error.details?.code || deps.safeMessage(error);
        if (error.persistent && deps.trackSession.scope?.dismissedNotices?.has(key)) return;
        if (key.startsWith("job:") && deps.trackSession.scope?.dismissedJobs?.has(key.slice(4))) return;
        const overlay = host === tools && !!notifications;
        let operation = context.operation || (error.noticeKey ? "notice:" + error.noticeKey : "");
        if (!operation) {
            operation = cause && typeof cause === "object" ? unattributedErrors.get(cause) || "" : "";
            if (!operation) {
                operation = "notice:unattributed:" + ++noticeSequence;
                if (cause && typeof cause === "object") unattributedErrors.set(cause, operation);
            }
        }
        if (!overlay)
            document.querySelectorAll<HTMLElement>('.lb-feedback[data-notice-key="' + CSS.escape(key) + '"]').forEach((n) => {
                if (!n.closest(".lb-tools") && n.parentNode !== host) n.remove();
            });
        let box = overlay
            ? notifications?.get(operation)
            : host.querySelector<HTMLElement>(':scope > .lb-feedback[data-notice-key="' + CSS.escape(key) + '"]');
        if (!box) {
            if (overlay)
                box = requireValue(notifications).set(
                    operation,
                    { message: deps.safeMessage(error), severity: "error" },
                    operation === "retrieval" ? "lb-status" : operation === "local-pronunciation" ? "lb-local-status" : "",
                );
            else {
                box = feedbackHost();
                box.setAttribute("role", "alert");
                host.append(box);
            }
        }
        const signature = JSON.stringify([deps.safeMessage(error), error.details, error.providerErrors]);
        if (!overlay && box.dataset.noticeSignature === signature) return;
        box.dataset.noticeSignature = signature;
        box.dataset.noticeKey = key;
        const informational = error.details?.code === "local_lyrics_missing";
        box.classList.toggle("lb-notice", informational);
        const d = error.details;
        const actions: FeedbackAction[] = [];
        const dismiss = () => {
            if (error.persistent && deps.trackSession.scope) {
                deps.trackScope().dismissedNotices ??= new Set();
                requireValue(deps.trackScope().dismissedNotices).add(key);
            }
            if (key.startsWith("job:") && deps.trackSession.scope) {
                deps.trackScope().dismissedJobs ??= new Set();
                requireValue(deps.trackScope().dismissedJobs).add(key.slice(4));
            }
            if (d?.code === "local_romaji_failed" && deps.trackSession.scope) deps.trackScope().dismissedLocalError = deps.safeMessage(error);
            if (overlay) notifications?.remove(operation);
            else {
                deps.feedbackScope.releaseWithin(box);
                box.remove();
            }
        };
        if (d?.code === "sign_in_required") actions.push({ label: "Sign in", run: () => (location.hash = "/login") });
        else if (d?.code === "service_not_configured")
            actions.push({
                label: "Set up service",
                run: () => {
                    if (deps.trackSession.current?.canSelect) location.hash = "/configurationpage?name=lyricbridge";
                    else status("Ask an administrator to set up this service.", true);
                },
            });
        else if (d?.retryable)
            actions.push({
                label: context.retryLabel || "Retry",
                run: () => {
                    if (overlay) notifications?.remove(operation);
                    else {
                        deps.feedbackScope.releaseWithin(box);
                        box.remove();
                    }
                    return retryAction();
                },
            });
        if (!host.classList.contains("lb-job-banner")) actions.push({ label: "Dismiss", run: dismiss });
        const options = {
            message: informational ? "Jellyfin has no lyrics for this song. Try importing a file." : deps.safeMessage(error),
            severity: context.severity || (informational ? ("info" as const) : ("error" as const)),
            secondary: context.secondary,
            actions,
            details:
                d && !informational
                    ? [
                          d.code +
                              (d.diagnosticId ? " · Reference " + d.diagnosticId : "") +
                              (d.retryAt ? " · Retry after " + new Date(d.retryAt).toLocaleTimeString() : ""),
                          ...(d.issues || []).map((issue) => (issue.location ? issue.location + ": " : "") + issue.message),
                          ...(d.issueCount && d.issueCount > (d.issues?.length || 0)
                              ? [`${d.issueCount} issues in total; showing the first ${d.issues?.length || 0}.`]
                              : []),
                          ...(error.providerErrors || []).map(
                              (sourceError) => sourceError.message + (sourceError.diagnosticId ? " · Reference " + sourceError.diagnosticId : ""),
                          ),
                      ]
                    : [],
        };
        if (overlay) requireValue(notifications).set(operation, options);
        else deps.feedbackScope.update(box, options);
    }

    function ensureTools() {
        if (!deps.trackSession.scope || !deps.isLyrics()) return;
        const host = deps.lyricHost();
        if (!host) return;
        if (tools?.isConnected && notifications) {
            notifications.setHost(host);
            if (settingsButton && settingsButton.parentNode !== host) host.append(settingsButton);
            return;
        }
        tools = e("div", "lb-tools");
        tools.setAttribute("aria-label", "Playback notifications");
        document.body.append(tools);
        notifications = new PlaybackNotifications(tools, host);
        notifications.set("retrieval", { message: "" }, "lb-status");
        settingsButton = button(
            "Lyrics settings",
            () => {
                if (deps.settingsPanel.popup) deps.closePopup();
                else deps.openPopup();
            },
            "lb-settings-trigger",
            { icon: "settings", iconOnly: true },
        );
        host.append(settingsButton);
        const bar = [...document.querySelectorAll<HTMLElement>(".ak-lyrics-tools-bar")].find((n) => n.getClientRects().length && !n.closest(".hide"));
        if (bar) mountTimingBar(bar);
    }

    function mountTimingBar(bar: HTMLElement | null) {
        if (!deps.trackSession.scope || !deps.isLyrics()) return;
        if (!settingsButton) ensureTools();
        const host = bar?.closest(".lyricPage") || deps.lyricHost();
        if (host && settingsButton && settingsButton.parentNode !== host) host.append(settingsButton);
    }

    function updateStatus() {
        if (!deps.trackSession.current) return;
        ensureTools();
        if (!notifications) return;
        const data = deps.documentState();
        const target = deps.trackScope();
        const messages: Record<string, string> = {
            searching: `Searching… ${data.finished || 0}/${data.total || 0} sources`,
            ready: "",
            partial: "",
            instrumental: "",
            rejected: "",
            missing: "No lyrics found",
            cleared: "No version selected · automatic search paused",
            failed: "No lyrics available (some sources failed)",
        };
        const initialWait = data.state === "searching" && performance.now() - (target.loadingStarted || 0) < 300;
        notifications.set(
            "retrieval",
            {
                message: initialWait ? "" : messages[data.state ?? ""] || "",
                severity: data.state === "failed" ? "error" : data.state === "searching" ? "progress" : "info",
                actions: ["missing", "failed", "cleared"].includes(data.state || "") ? [{ label: "Search again", run: deps.retry }] : [],
                details:
                    data.state !== "partial"
                        ? (data.errors || []).map((error) => error.message + (error.diagnosticId ? " · Reference " + error.diagnosticId : ""))
                        : [],
            },
            "lb-status",
        );
        if (data.state !== "searching" && target.loadingTimer) deps.lifetime.clearTimeout(target.loadingTimer);
        document.querySelectorAll<HTMLElement>(".lb-instrumental-view").forEach((node) => node.remove());
        if (data.state === "instrumental") {
            const message = e("div", "lb-instrumental-view", "Instrumental music, please enjoy.");
            message.setAttribute("role", "status");
            deps.lyricHost()?.append(message);
            if (deps.lyricContainer()?.querySelector(".lyricsLine")) deps.render(null);
        }
        if (data.state === "partial" && data.errors?.length) {
            const key =
                "providers:" +
                data.errors
                    .map((error) => error.diagnosticId || error.code + ":" + error.message)
                    .sort()
                    .join("|");
            showError(
                {
                    message: "Some sources unavailable. Showing available lyrics.",
                    details: { code: "partial_provider_failure", retryable: true },
                    providerErrors: data.errors,
                    noticeKey: key,
                    persistent: true,
                },
                tools,
                deps.retry,
                { operation: "retrieval", severity: "warning" },
            );
        }
        if (
            !deps.searchPopup &&
            data.canSelect &&
            data.better &&
            target.dismissedUpgrade !== (data.better.hash || data.better.source + ":" + data.better.providerId)
        ) {
            const reason = data.improvement?.reason;
            notifications.set(
                "improvement",
                {
                    message:
                        reason === "recording-match"
                            ? "Better recording match"
                            : reason === "auxiliary-completeness"
                              ? "Lyric update available"
                              : reason === "match-score"
                                ? "Better lyric match"
                                : "Better timing",
                    severity: "info",
                    actions: [
                        { label: "Preview", run: () => deps.openVersions(requireValue(deps.documentState().better)) },
                        {
                            label: "Dismiss",
                            run: () => {
                                target.dismissedUpgrade =
                                    requireValue(data.better).hash || requireValue(data.better).source + ":" + requireValue(data.better).providerId;
                                notifications?.remove("improvement");
                            },
                        },
                    ],
                },
                "lb-upgrade lb-upgrade-offer",
            );
        } else notifications.remove("improvement");
        if (data.pronunciation?.state === "running" || data.pronunciation?.state === "queued")
            notifications.set("local-pronunciation", { message: "Generating pronunciation…", severity: "progress" }, "lb-local-status");
        else if (data.pronunciation?.state === "failed" && target.dismissedLocalError !== data.pronunciation.error) {
            const retryLocal = async () => {
                try {
                    await deps.api("items/" + target.itemId + "/pronunciation", "POST", {
                        hash: requireValue(deps.documentState().lyrics).hash,
                        includeSupplied: deps.documentState().auxiliaryChoices?.pronunciation !== "auto",
                        retry: true,
                    });
                    if (deps.trackSession.scope === target) await deps.refreshSong();
                } catch (error) {
                    if (deps.trackSession.scope === target)
                        showError(error, tools, retryLocal, { operation: "local-pronunciation", retryLabel: "Retry generation" });
                }
            };
            showError({ message: data.pronunciation.error, details: { code: "local_romaji_failed", retryable: true } }, tools, retryLocal, {
                operation: "local-pronunciation",
                retryLabel: "Retry generation",
            });
        } else notifications.remove("local-pronunciation");
    }
    return {
        notice,
        status,
        showError,
        ensureTools,
        mountTimingBar,
        updateStatus,
        get notifications(): PlaybackNotifications | null {
            return notifications;
        },
        replaceNotifications(value: PlaybackNotifications | null) {
            notifications = value;
        },
        get settingsButton(): HTMLButtonElement | null {
            return settingsButton;
        },
        replaceSettingsButton(value: HTMLButtonElement | null) {
            settingsButton = value;
        },
        get tools(): HTMLElement | null {
            return tools;
        },
        replaceTools(value: HTMLElement | null) {
            tools = value;
        },
        get unattributedErrors(): WeakMap<object, string> {
            return unattributedErrors;
        },
        replaceUnattributedErrors(value: WeakMap<object, string>) {
            unattributedErrors = value;
        },
    };
}
