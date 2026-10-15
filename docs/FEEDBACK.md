# Integrate feedback components

Use the shared feedback components when adding notices, progress, or confirmations.
`frontend/shared/feedback.ts` owns expiry, live regions, actions, diagnostics, and
disposal. The bridge adapter uses glass controls; the administrator adapter uses native
Jellyfin Material controls. See [frontend ownership](ARCHITECTURE.md#frontend-ownership)
for feature/session boundaries.

## Add panel feedback

Create one scope for the view and a dedicated host beside the action. Update that host
for the same operation rather than append notices. Keep permissions, cancellation,
request identity, and stale-response checks in the feature.

This example belongs in a module under `frontend/bridge/`. Calling it appends a retryable
error to the supplied panel and returns its cleanup function:

```ts
import { FeedbackScope } from "../shared/feedback.ts";
import { feedbackHost, glassFeedback } from "./feedback.ts";

export function showSaveFailure(panel: HTMLElement, retry: () => unknown): () => void {
    const feedback = new FeedbackScope(glassFeedback);
    const host = feedbackHost();
    panel.append(host);
    feedback.update(host, {
        message: "Saving failed. Try again.",
        severity: "error",
        details: ["Retry the save after checking your connection."],
        actions: [
            { label: "Retry", run: retry },
            { label: "Dismiss", run: () => feedback.clear(host) },
        ],
    });
    return () => {
        feedback.dispose();
        host.remove();
    };
}
```

For administrator views, pass `materialFeedback` from `frontend/admin/feedback.ts`
and use the existing native status host. Glass confirmation surfaces use
`feedbackHost("confirmation")`. Do not add feature-specific severity CSS or notification
markup. Version metadata, timing readouts, classifications, and ordinary descriptions
remain content.

## Preserve lifetime and action semantics

Release a partial view with `releaseWithin(view)` before removing its DOM.
Call `dispose()` when the scope's owner exits; it clears timers/action handlers and
hides feedback. Owners must still reject late asynchronous responses.

| State/input                       | Behavior                                            |
| --------------------------------- | --------------------------------------------------- |
| Success                           | Expires after four seconds by default               |
| Progress, warning, error          | Persists until updated, cleared, or disposed        |
| `ttl: 0`                          | Explicitly persists                                 |
| `expire`                          | Optional callback after expiry                      |
| Dismiss                           | Hides feedback without cancelling work              |
| Cancel                            | Must invoke cancellation in the originating feature |
| `disabled`, `busy`, `destructive` | Presentation only; feature owns business rules      |

Actions keep their nodes/focus when labels and positions are unchanged. Diagnostic
Details remain expanded across updates. Confirmation actions must reject on failure
or return `false`; `confirmFeedback` closes only on success. Swallowing errors would
falsely confirm success. Managed reset retains its typed RESET input outside dirty-state
tracking.

Structured request errors retain `issues` and `issueCount` for source locations.
Import preview warnings persist; final save blocks dismissal.
See [import contracts](IMPORT.md) for validation and request lifetime.

## Use playback notifications

`PlaybackNotifications` in `frontend/bridge/playback-notifications.ts` owns one collection
per visible lyrics view. Mount its overlay under `document.body`; its bounds follow the
lyrics host/visual viewport while excluding player/header controls and safe areas.
Dispose it when the view closes and create a fresh collection on song/account changes.
Panel and administrator feedback continue using their local scopes.

Call `set(identity, options)` to update an operation and `remove(identity)` when resolved.
Use stable identities such as `retrieval`, `local-pronunciation`, `job:<id>`, or the
originating action. Never infer ownership from message text or diagnostic IDs.

The collection shows two cards ordered by error, warning, progress, then info/success,
with stable creation order. Its summary expands the rest. Focused cards remain visible;
Details and scroll state persist. Success expiry is deferred while focused.
Preview playback controls remain separate chrome.

Use `secondary` for last-known operation state. A monitoring HTTP failure updates the
same job card with **Retry status check**; only confirmed job failure offers
**Retry generation**. A successful check clears the monitoring error even if progress
has not changed. Partial-source failure with usable lyrics is a warning.
A failed monitoring request does not establish that the background operation failed.

## Next steps

- [Run frontend and browser checks](CI.md#local-commands), including confirmation and feedback regressions.
- [Check architecture boundaries](ARCHITECTURE.md) when introducing asynchronous ownership.
