# Why ownership boundaries matter

LyricBridge separates policy, external effects, and host integration so each can change without importing the others' assumptions.
This explanation is for contributors deciding where behavior belongs. Start with [development setup](../how-to/develop.md) for commands.

## Separate policy from its execution

Core owns decisions that should be testable without Jellyfin, HTTP, or SQLite.
Infrastructure executes those decisions through storage, providers, formats, and workers.
Host adapts Jellyfin configuration, authentication, library access, and lifecycle into those services.

This direction lets domain tests run without constructing a plugin and lets adapters change without redefining selection or generation policy.
The [project boundary check](../../scripts/checks/architecture.py) enforces the dependency graph; it is the authority for permitted project references.

Storage transactions stay behind repositories because admission, selection, deletion, and late completion must agree on the same data.
Splitting related writes across request handlers would allow work admitted before deletion to recreate removed content.
Deletion therefore fences later completion as well as removing current records. Cancellation follows commit rather than interrupting the transaction.

## Keep asynchronous work with its owner

A view, a track, and an admitted background job have different lifetimes.
Closing a view should stop its uploads, reads, and previews while leaving admitted work available under its captured track identity.
Changing tracks releases track-owned monitors. Accepted preference writes retain their captured account/song even after playback changes.

Cancellation alone cannot prevent a late response from updating the wrong view.
Owners also validate captured identity and the revision relevant to the operation.
Draft navigation, AI proposals, and saved-entry refreshes have separate revisions because refreshing metadata must not discard edits or undo history.

Reversible playback previews need one baseline owner. Multiple independent restoration callbacks could restore stale lyrics, lose focus, or overwrite a newer retrieval result.
The same principle keeps settings transactions separate from their DOM: a save result must not erase edits made while it was pending.

## Compose applications through ports

Bridge, renderer, and administrator applications own their feature state and expose named commands with read-only views.
Installation modules connect effects and dispose resources; they do not become another shared mutable state owner.

Cross-application contracts describe payloads and capabilities independently of implementations.
The bridge uses a narrow renderer port so partial installation or stock-TV bypass does not require the full desktop implementation.
Diagnostics can read broader snapshots without granting other applications write access.

The renderer's frame loop reads stable owner views instead of allocating snapshots or broadcasting state on every frame.
One scheduler coordinates frame work; feature owners retain the state needed to process it.
The [frontend boundary rules](../../frontend/contract-boundaries.mjs) define allowed imports and reject implementation coupling and cycles.

## Retain results independently of work history

Saved lyrics, transcripts, and review entries are durable results. Notifications and finished-request history are operational records.
Removing the latter must not remove results or restore request quota.
Shared immutable content remains until its last dependency is released; an association and its content are not interchangeable ownership units.

These distinctions explain why deletion can report blocked dependencies and why a completed proposal survives dismissal.
See [data management](../how-to/manage-data.md) for operator consequences and [validation design](validation.md) for how the boundaries are checked.

## Convert persisted state at one boundary

Runtime services consume current settings and storage models. The startup coordinator initializes settings before storage and gates workers, APIs, native lyric integration, and scheduled work until both are ready.
Failures leave Jellyfin and the independent administrator status endpoints available.

Settings and SQLite have independent schema versions. Each domain can register one explicit predecessor with one direct upgrade to current; conversion never falls through to runtime readers or chains across releases.
The baseline ships an empty registry. Replace the predecessor step when advancing that domain's supported upgrade boundary.

The upgrade runner journals intent and creates a private backup before conversion. XML replacement is atomic; database conversion and version stamping share one transaction.
Each domain commits independently. Startup reconstructs interrupted completion from persisted schema markers, so a completed conversion doesn't run twice.
Completed-upgrade notices survive restart and acknowledgement; backup files expire after 30 days. Their journal and lifecycle belong to the upgrade boundary rather than ordinary lyric retention.
