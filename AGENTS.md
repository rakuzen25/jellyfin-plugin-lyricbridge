# LyricBridge for Jellyfin

## Documentation policy

- Treat documentation as a durable source of truth,
  not a record of agent activity.
- Do not create documentation files as a routine
  byproduct of coding, refactoring, or auditing.
- Inspect existing docs before writing new ones.
  Prefer updating the canonical existing document.
- Create a new file only for a distinct, enduring
  reader need, or when explicitly requested.
- Keep audit findings, test results, implementation
  summaries, and task receipts in the chat response.
- Document current behavior, not implementation history.
- Keep writing concise, navigable, and non-repetitive.
- Reserve CHANGELOGs for meaningful release changes
  and ADRs for significant architectural decisions.
- Update documentation when code changes invalidate it,
  without unnecessarily expanding it.
- During audits, identify obsolete or redundant docs
  and recommend consolidation or deletion.
- Preserve useful information before removing files.

Default for ordinary coding tasks:
zero new documentation files.
