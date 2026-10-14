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

### Local verification, 2026-10-13

- Strict TypeScript/source boundaries, ESLint, Prettier, Knip, frontend unit suites and web/admin bundling passed.
- Complete Chromium workflow group: 33 passed (`browser-tests/results-run.cqqgno/report/results.json`).
- Four-project feedback/layout/visual matrix: 36 passed (`browser-tests/results-run.cqkGgx/report/results.json`). Existing playback and settings screenshot baselines were unchanged.
- After final confirmation/job lifecycle cleanup: six affected workflow scenarios and twelve component/generation layout cases passed (`results-run.Md8rHH` and `results-run.9PQLQl`).
- Administrator configuration regression passed again after the final hidden-view guard.
- Final component tests with both production stylesheets loaded together: eight passed (`browser-tests/results-run.i7Km9c/report/results.json`). This covers busy controls, changed diagnostics, theme inheritance, default expiry and disposal.

Earlier checks failed on strip-only TypeScript constructor syntax, fixture module loading, an outdated administrator DOM assertion, a negative fixture targeting the wrong endpoint and a running-clock expiry boundary. Those were corrected and rerun. The old mobile assertion requiring all three labelled generation actions on one physical line was replaced with the agreed wrapping-action-area invariant after visual inspection; no snapshot was regenerated to hide a failure.

These are local UI checks. No release-artifact, hosted CI or live-server verification is claimed for this styling change.

### Follow-up completeness audit

The first migration missed the direct `lb-local-status` banner for backend local-pronunciation generation. It also left preview loading and import reading/validation/import progress as direct text writes. These paths now use the shared glass status presentation, including the rotating progress indicator. The manually triggered local-generation status now has progress severity as well.

The administrator adapter deliberately retains native text-based Material statuses; it is covered by the shared lifecycle without adopting glass icons. Instrumental labels, timing readouts, version metadata and request-history rows are ordinary content rather than transient operation feedback. A generic HTTP failure beside a running background operation does not, by itself, establish that the background operation failed; request ownership and server state remain authoritative.

### Icon/text alignment

Feedback SVGs use a flex wrapper matching the 21px message line box; they align with the first line of wrapped notices. Shared buttons, accordion headings, version-row summaries and timing controls center icons against their text blocks. Twelve alignment/feedback cases passed across desktop/mobile Chromium, Firefox and WebKit after this adjustment; the dedicated geometry assertion checks offsets within one CSS pixel.

### Grouped playback verification

The final notification/shared-feedback matrix passed all 28 cases across desktop/mobile Chromium, Firefox and WebKit (`browser-tests/results-run.Mr3aJv/report/results.json`). It covers priority, deduplication, expansion, diagnostic/focus preservation, four-second expiry, monitor failure/recovery, disposal, and bounds down to a 320×180 viewport. The bounded mobile screenshot was reviewed. The affected saved-original/workflow rerun passed 23 cases; preview controls passed seven matrix cases and the remaining WebKit case passed on an isolated rerun after a parallel-run timeout. That timeout is recorded rather than treated as a clean first-pass result. Existing playback/settings visual baselines passed without replacement in the preceding rendering run.

Final TypeScript/boundary checks, ESLint, Prettier, all 19 frontend test files, and bundling passed. Knip reports an unused `embeddedText` export in concurrent auxiliary-lyrics work outside this notification change. No hosted CI, release or live-server evidence is claimed.

### Import warnings and structured source errors

Import preview uses the existing glass feedback adapter for persistent warnings, with expanded source locations; it adds no bespoke notification surface. Structured request errors preserve import `issues` and `issueCount` through API and display normalization so Details contains the server's native row, XML location or JSON path. The import panel disposes preview requests with its owning view and blocks dialog dismissal during final saving. See [IMPORT.md](IMPORT.md) for format and timing behavior.
