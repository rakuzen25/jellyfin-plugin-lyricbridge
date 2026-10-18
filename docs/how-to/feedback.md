# Add feedback to a view

Use shared feedback when a contributor adds progress, errors, or confirmations to a view.
First identify the operation's owner using the [architecture boundaries](../explanation/architecture.md#keep-asynchronous-work-with-its-owner).
Presentation must not take over request orchestration.

## Add a local feedback host

Create one scope for the view and reuse a host for updates to the same operation.
This example belongs in a module directly under `frontend/bridge/`:

```ts
import { FeedbackScope } from "../shared/feedback.ts";
import { feedbackHost, glassFeedback } from "./ui/feedback.ts";

export function showSaveFailure(panel: HTMLElement, retry: () => unknown): () => void {
    const feedback = new FeedbackScope(glassFeedback);
    const host = feedbackHost();
    panel.append(host);
    feedback.update(host, {
        message: "Saving failed. Try again.",
        severity: "error",
        actions: [{ label: "Retry", run: retry }],
    });
    return () => {
        feedback.dispose();
        host.remove();
    };
}
```

Calling it displays a retryable error. Invoke the returned cleanup when the view exits.
For administrator views, use the [Material adapter](../../frontend/admin/ui/feedback.ts) and an existing native status host.
Keep feature-specific error markup and severity styles out of the view.

## Preserve actions and lifetime

Use the feature's cancellation command for **Cancel**. **Dismiss** only hides feedback.
Keep captured identities and stale-response checks in the operation owner even after disposing the feedback scope.
For partial DOM replacement, release feedback within that subtree before removing it.

A confirmation action must reject on failure or return `false`; swallowing its error would falsely confirm success.
Busy and disabled presentation does not enforce permissions, cancellation, or save locks.
See [shared feedback](../../frontend/shared/feedback.ts) for the command interface and lifecycle behavior rather than copying its defaults into the feature.

## Choose the right surface

Keep panel feedback beside its action. Use the [playback notification collection](../../frontend/bridge/ui/playback-notifications.ts) for operations that remain relevant while panels are closed.
Use stable operation/job identities, never message text, to update a notification.
A failed status request does not establish a failed background job.

Use the shared workflow shell for search, import, export, and transcription.
Navigation must restore the launching control, panel scroll position, and any preview baseline.
Wire those effects through existing navigation and preview owners rather than independently restoring DOM from a feedback callback.

## Next steps

[Validate the workflow and layout](validate.md#exercise-browser-workflows-and-rendering) and [review asynchronous ownership](../explanation/architecture.md).
