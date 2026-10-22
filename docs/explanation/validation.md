# Why validation binds evidence to artifacts

A green test run is useful only when it covers the source and artifacts being reviewed.
LyricBridge separates change selection, reusable code evidence, and fresh release acceptance to preserve that relationship.
For execution commands, use [validate a change](../how-to/validate.md).

## Select work conservatively

Different checks protect different boundaries: domain decisions, storage transactions, browser workflows, visual rendering, and installed-server behavior.
Repeating the same assertion at every layer adds maintenance without necessarily adding confidence.
A test belongs at multiple boundaries only when those boundaries can fail independently.

CI compares cumulative changes with trustworthy coverage, including deleted paths and both sides of renames.
Missing history, unknown paths, or unavailable evidence must not silently reduce coverage.
Documentation changes still run the local documentation check without needing application suites solely for prose.
The rules in [plugin.toml](../../plugin.toml) define maintained inputs and group selection; the toolkit implements classification.

## Reuse evidence without laundering failures

Reuse avoids repeating equivalent code checks; it cannot turn untrusted or incomplete work into a successful baseline.
Evidence must identify matching inputs, execution, and successful jobs from an accepted source.
A newer matching failure prevents choosing an older success merely because it is green.
Fork and unmerged-PR results cannot establish trusted release evidence.

A partially failed workflow can contain a reusable successful group, while establishing a cumulative baseline requires complete coverage.
Reuse records point directly to their original successful execution.
The locked toolkit owns receipt fields and trust rules. Its locked wheel hash, configuration and native toolchain pins participate in fingerprints. Python dev-only lock changes do not invalidate fixture-only stress results when consumed assets and execution settings stay identical. Consumer workflows supply event triggers and explicit permissions around immutable reusable-workflow references.

## Keep release acceptance fresh

Code-equivalent inputs do not establish current dependency advisories or prove what was packaged.
Release acceptance checks exact archives, rebuilds independently, and installs into a disposable official server.
It validates the bytes offered to users, not an earlier development directory.

Matching source and notices ship with binaries because reproducibility and distribution obligations depend on them.
Upload recovery can reuse completed validation only while the evidence and downloaded bytes still qualify.
A published artifact must not be replaced after its receipt was issued. See [release recovery](../how-to/release.md#recover-an-upload-failure) for the operator procedure.

## Understand the limits of a pass

Mocked providers isolate deterministic behavior; they do not verify paid credentials, region access, or a provider's current service.
Headless browser tests do not establish physical-device thermal or power behavior.
Architecture checks enforce declared boundaries but cannot prove that a responsibility was assigned well.

Keep test results and measurement reports with the relevant run/artifacts rather than recording them as permanent documentation.
Use [performance measurements](../how-to/measure-performance.md) when a device-specific conclusion needs evidence beyond functional acceptance.
