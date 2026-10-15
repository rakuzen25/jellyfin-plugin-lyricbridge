# Feedback components

Feedback shares behavior, not a visual theme. `frontend/shared/feedback.ts` owns updates, expiry, live regions, action state, diagnostics and disposal. `frontend/bridge/feedback.ts` presents lyrics feedback using glass controls. `frontend/admin/feedback.ts` presents configuration feedback using Jellyfin Material controls. The two style families remain in their existing CSS/HTML assets; no new public asset or backend contract is required.

## Adding a feature

Create a feedback scope with the appropriate adapter and a dedicated host beside the action. For glass notices use `feedbackHost()` from the glass adapter; for glass confirmations use `feedbackHost("confirmation")`. These factories own the shared card surfaces. Plain status hosts remain beside their operation. Update that host for the same operation rather than appending another notice. Keep permissions, cancellation, request identity and stale-response checks in the feature. Do not add feature-specific notification markup or severity CSS.

```ts
const feedback = new FeedbackScope(glassFeedback); // materialFeedback on the admin page
feedback.update(host, { message: "Saving…", severity: "progress" });
feedback.update(host, { message: "Saved", severity: "success" });
feedback.update(host, {
    message: "Saving failed. Try again.",
    severity: "error",
    details: ["Reference: supplied diagnostic identifier"],
    actions: [
        { label: "Retry", run: retry, disabled: false },
        { label: "Dismiss", run: () => feedback.clear(host) },
    ],
});
```

Use `releaseWithin(view)` before removing a view and `dispose()` when its owner exits. Disposal clears timers and component action handlers and hides feedback; returning views render their current state again. Owners must still reject late asynchronous results. Success defaults to four seconds; warnings, errors and progress do not expire. `ttl: 0` explicitly preserves a status. An optional expiry callback can remove completed playback chrome. Dismiss hides feedback; it does not cancel work. Use an explicitly labelled Cancel action for cancellation.

Actions retain their nodes and focus across updates with the same labels and positions. Details stay expanded across changed diagnostics. `disabled`, `busy` and `destructive` are presentation inputs; business rules stay in the feature. Confirmation actions must reject on failure or return `false`; swallowed errors must not be treated as success. `confirmFeedback` closes only on success. Existing reset confirmation retains its transient typed RESET input and native controls.

## Consumer inventory

Playback overlays use `PlaybackNotifications` from `frontend/bridge/playback-notifications.ts`. Give each operation an explicit stable identity (`retrieval`, `local-pronunciation`, `job:<id>`, `improvement`, or an originating action). Call `set(identity, options)` to replace that operation's feedback and `remove(identity)` when resolved. Never infer ownership from message text or diagnostic IDs. Panel feedback continues to use its local scope; administrator feedback continues to use the Material adapter.

The collection shows two cards ordered by error, warning, progress, then information/success, with stable creation order within each level. Its summary expands the remaining cards until explicitly collapsed. Focused cards remain visible and stay in place during interaction; Details expansion and list scroll are preserved. Success expires after four seconds, deferred while focused. Dismiss hides feedback; Cancel requests cancellation through the originating feature.

Use `secondary` for a short operation state beneath the main message. A failed monitoring request updates the same job card with "Last known state" and "Retry status check"; a confirmed generation failure offers "Retry generation". A successful check clears its monitoring error even if progress did not change. Partial-source failures with usable lyrics are warnings. Unattributed errors remain independent cards.

The transparent overlay is mounted under `document.body` to avoid transformed or clipping lyrics ancestors, but bounded to the intersection of its lyrics host and visual viewport, excluding header/player controls and safe areas. Expanded cards scroll internally; the collapse control remains outside that scroll area. Resize, visibility, viewport and diagnostic changes schedule coalesced measurements. Preview playback controls remain separate control chrome and do not consume notification slots. Dispose the collection when the view closes; song/account changes create a fresh collection.

```ts
notifications.set("job:" + job.id, {
    message: "Could not check pronunciation progress",
    secondary: "Last known state: running · 18%",
    severity: "error",
    details: [diagnostic],
    actions: [{ label: "Retry status check", run: retryCheck }],
});
```

| Consumer | Element / presentation | Ownership |
| --- | --- | --- |
| Playback retrieval / missing lyrics | Status, glass | Track scope |
| Provider failures / local pronunciation failure | Notice with Details, glass | Track scope and dismissal identity |
| Improvement offer | Notice with Preview / Dismiss, glass | Administrator-only, track offer identity |
| Generation submission / progress / completion | Status and separate action row, glass | Existing job monitor |
| Generation failures | Notice, glass | Job identity; Dismiss never cancels |
| Search progress / stopped search / provider-ID validation | Status, glass | Search session |
| Search / preview / import failures | Notice, glass | Originating panel and request scope |
| Preference / shared timing / version save feedback | Status or failure notice, glass | Account, track and originating panel |
| Version deletion / classification | Confirmation and local failure notice, glass | Administrator action and track scope |
| Configuration loading / saving | Status or failure notice, Material | Configuration page |
| Web renderer status / repair | Severity status or failure notice, Material | Configuration page; first result line bold |
| Service connection tests | Status or failure notice with diagnostics, Material | Service row |
| Managed-library reset | Native confirmation, status / failure notice, Material | Maintenance region; transient input excluded from dirty state |
| Request-history load / actions / errors | Status or failure notice, Material | Request panel |

Version metadata, source-result disclosures and ordinary settings descriptions are content, not notifications. They retain their existing controls.

## Validation

`pnpm test` includes confirmation outcome regressions. `feedback.spec.cjs` exercises both adapters across the rendering matrix: focus and expanded Details preservation, action placement, replacing expiry, independent messages and disposal. Workflow regressions cover generation recovery, repeated status icons, search cancellation, imports, versions and administrator dirty-state handling. The strict source-boundary check rejects new bespoke bridge feedback/confirmation markup outside the existing integration owner.

## Presentation details

Administrator feedback uses native text-based Material statuses. Playback uses shared
glass feedback. Instrumental labels, timing readouts, version metadata and request-history
rows are ordinary content. A generic HTTP failure beside a background operation does
not establish that the operation failed; request ownership and server state remain authoritative.

Feedback SVGs use a flex wrapper matching the 21px message line box and align with the
first line of wrapped notices. Buttons, accordions, version-row summaries and timing
controls center icons against their text blocks. Geometry regressions cover alignment.

Import preview uses persistent warnings with expandable source locations. Structured
request errors retain `issues` and `issueCount` so Details can show native rows, XML
locations and JSON paths. Preview requests belong to the dialog's view; final saving
blocks dismissal. See [lyric imports](IMPORT.md) for timing and format behavior.
