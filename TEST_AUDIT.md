# Brooks-Lint Review

**Mode:** Test Quality Review
**Scope:** All maintained frontend, browser, backend and Python/Node tooling suites; focused on leftover historical assertions and implementation-coupled checks.
**Health Score:** 90/100 before this cleanup (two Warning findings; not an overall coverage or runtime score).

The obsolete assertions were concentrated in UI migration regressions. Their surrounding tests already exercise the supported behavior, so the redundant checks can be removed without deleting scenarios.

## Test Suite Map

| Group | Maintained files | Test declarations |
| --- | ---: | ---: |
| Frontend unit | 17 | 41 |
| Browser functional/rendering/performance | 18 | 69 |
| Node tooling | 3 | 5 |
| Backend attributed tests | 19 | 89 |
| Python tooling/artifact/installed-plugin scripts | 9 | 82 named methods plus standalone script assertions |

Counts are source declarations, not expanded theory, parameterized or browser-project totals. Backend support/scenario files without attributes were also searched. Installed-plugin and reproducibility scripts protect different boundaries from unit tests. Performance sessions remain risk-selected; this audit does not change CI selection or release requirements.

## Findings

### Warning

**T2 — Historical UI/storage absence assertions [quick-fix]**

Symptom: Tests assert absence of retired labels, controls, nested markup and the undo-only `previous` storage bucket, even though adjacent assertions already validate current metadata, automatic ordering, available actions and transactional rollback.
Source: *xUnit Test Patterns* — over-specified tests; *The Art of Unit Testing* — implementation coupling.
Consequence: Supported UI changes carry obsolete wording and layout knowledge forward, creating maintenance work without protecting additional behavior.
Remedy: Remove those assertions from the browser regression owners and `SelectionRepositoryTests`; retain their positive behavior checks. Remove the retired bucket name from the controller boundary token list while retaining the actual persistence-boundary checks. **Applied.**

**T2 — Comparing SVG internals to prove distinct actions [quick-fix]**

Symptom: The improvement-offer test compares raw SVG `innerHTML` for Preview and Dismiss.
Source: *xUnit Test Patterns* — over-specification; *The Pragmatic Programmer* — orthogonality.
Consequence: An icon-library representation change can break a test despite unchanged actions, accessible labels and behavior.
Remedy: Verify Preview is available and Dismiss removes the offer without changing selection or resurfacing after refresh. Those behavioral checks remain; the SVG-string comparison is removed. **Applied.**

## Removal inventory

Thirteen assertions were removed; no test scenario or execution group was deleted.

| Removed assertion | Maintained replacement / reason |
| --- | --- |
| `Why it’s better:` must be absent | Actual translation/pronunciation comparison remains visible in the candidate. |
| `Sort by best match` must be absent | Received results are reordered automatically by ranking; focus and preview survive. |
| `Revert previous selection` must be absent | Current original-version actions, selection and classification are exercised. Undo is no longer supported. |
| `Import to save` must be absent, two locations | Saved/current originals are present and usable, with correct enabled/disabled actions. |
| Model must not occur in provenance subtitle | Labelled Model/Saved metadata rows are checked positively. |
| Generation setup must not have an outer summary | The generation group and its action toggle, fields and lifecycle are exercised. |
| Saved metadata must not contain nested details | Version expansion state, geometry and focused refresh behavior remain covered. |
| Search footer must be absent | Current search controls and top-level advanced provider-ID placement are tested. |
| `rendererRuntime.` must be absent | Renderer result, mechanism and web-root values are verified positively. |
| `.material-icons` must be absent | Rendered SVG dimensions and pointer/keyboard source reordering remain covered. |
| Preview/Dismiss SVG markup must differ | Named Preview availability and Dismiss persistence/selection behavior remain covered. |
| Undo-only `previous` bucket must be empty | Failed selection retains the serialized selection unchanged and preserves rejected state. |

The Unicode payload test was renamed around its actual invariant: control characters remain literal unless an explicit supported background prefix is present. Its Unicode and background-prefix assertions remain.

## Retained negative checks

Permission restrictions, cancelled/stale request results, disposal, bounded DOM/resources, literal Unicode handling, unsupported database schemas, old receipt trust rejection, moved tags, non-clobbering uploads, demo exclusions, scoped injection cleanup and failed-write rollback all describe current safety or behavior contracts. They were not removed just because they contain `not`, `legacy` or `previous`.

## Summary

Prefer assertions about supported output and state transitions. A regression test should explain the failure it prevents; absence of historical wording or implementation markup is insufficient on its own. No production behavior, test-selection policy, dependency or release gate changes are included.

## Verification

- Frontend unit suites: all 17 files passed.
- Node tooling suites: all three files passed.
- Locked .NET restoration and complete backend suite: 139 passed, zero failed/skipped; TRX retained in `dist/evidence/backend.trx`.
- Python CI policy/catalog/release automation/local-Jellyfin suites: 82 passed, plus standalone source-boundary checks.
- Affected browser workflows: 24 passed; affected layouts across desktop/mobile Chromium, Firefox and WebKit: 12 passed.
- ESLint, Prettier, Knip, changed Python Ruff formatting/linting and `git diff --check` passed.

No test scenarios, browser groups, snapshots, release gates or production code were changed by this cleanup. Artifact reproducibility, installed-plugin verification and five-minute performance sessions were retained but not rerun for these assertion-only changes.
