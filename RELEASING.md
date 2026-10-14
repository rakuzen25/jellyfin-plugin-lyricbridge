# Automated releases

LyricBridge uses release-please for one repository-wide version and changelog. It updates `version.txt`, the authoritative version in `Directory.Build.props`, and only the LyricBridge project-reference versions in .NET lockfiles. Third-party dependency versions and hashes are preserved. Packaging reads the matching changelog section and its committed release date for the catalog; notes and URLs are not left at the initial release defaults.

The flow is: Conventional Commits on `main` → release PR → passing PR checks and your merge → draft release and tag → risk-based code validation plus mandatory final artifact/reproducibility/installed-plugin checks → tested assets attached → your final Publish click. The draft workflow never installs on a live server; catalog updates begin only after stable publication. A draft without a green artifact workflow is not ready to publish.

## One-time GitHub setup

Use the shared GitHub App documented in [CATALOG.md](CATALOG.md): install it on this repository, configure `PLUGIN_APP_CLIENT_ID` and `PLUGIN_APP_PRIVATE_KEY`, and retain the required `validate` check on `main`. The App creates Release Please PRs that trigger ordinary CI. No long-lived release PAT is required; remove the obsolete `RELEASE_PLEASE_TOKEN` after confirming the migration.

Artifact upload still uses the ordinary workflow token. The attaching job also has narrowly scoped OIDC and attestation permissions to sign the verified public receipt. External actions remain pinned to reviewed commits.

`Prepare release` owns validation for pushes to `main`: ordinary pushes call candidate validation, while newly created releases call artifact validation once against the release commit. PRs and manual validation remain independently available; there is no second standalone push-validation run.

## Prepare the next release

Keep published tags and assets unchanged. Commit the implementation with a Conventional
Commit title. Release-please determines the next version; use a one-time `Release-As:`
footer only when deliberately selecting a different version. Do not manually bump
metadata or project lockfile references: the generated release PR updates them together.

Review and merge that PR after its required checks pass. The workflow creates a draft
and tag, verifies the exact candidate and attaches six assets:

- `lyricbridge-VERSION.zip` — plugin, embedded renderer, dependencies, dictionaries and notices.
- `lyricbridge-web-VERSION.zip` — optional separately installed web enhancement.
- `lyricbridge-source-VERSION.zip` — matching editable/licensed source and build inputs.
- `manifest.json` — this plugin's catalog entry.
- `SHA256SUMS` — all three ZIPs and the manifest.
- `validation.json` — the authenticated validation receipt, separately attested and excluded from its own artifact hashes.

A matching unpublished draft at the exact current commit can be resumed if release-please
already created it. Duplicate or mismatched tags fail rather than being recreated.

Keep the plugin/web/source archives together for corresponding-source availability. After the artifact workflow is green, download all six assets, verify `sha256sum -c SHA256SUMS`, review the manifest's version/GUID/ABI/URLs and publish the draft. Confirm unauthenticated downloads after publishing. Do not publish an empty draft while validation is running. Publication and live installation remain owner actions. Publication automatically proposes a verified shared-catalog addition after the catalog/App setup is complete.

## Future releases and retries

Use Conventional Commit messages (or squash PR titles): `fix:` for fixes, `feat:` for features, and `feat!:` or a `BREAKING CHANGE:` footer for breaking changes. Before 1.0, breaking changes bump the minor version and nonbreaking features/fixes bump the patch under this configuration. Use a one-time `Release-As:` footer when choosing a specific version; do not add a permanent `release-as` setting.

Release-please keeps a release PR updated. Review and merge it when ready. No manual version edits, tags or ZIP uploads are needed; publishing remains an explicit final click.

If artifact validation/upload fails, leave the release as a draft. After resolving the failure, run **Build draft release artifacts** from Actions with the existing tag (the unpublished `vVERSION` tag). It verifies new tagged artifacts again and reuses code checks only when their inputs match trusted evidence. Identical existing assets are accepted; conflicting files, moved tags or published releases are rejected. It never overwrites existing assets. A source fix belongs in a new reviewed release commit/version rather than silently replacing a published artifact. For an unpublished failed draft whose source must change, resolve the draft/tag deliberately before recreating that version; this workflow will not delete or move tags for you.

## Shared Jellyfin catalog

After stable publication, **Notify shared plugin catalog** triggers a verified catalog PR. The catalog checks the approved source, attested receipt, aggregate/artifact gates and public archive hashes, then enables auto-merge behind its required check. It also reconciles daily and supports manual retry. Explicit withdrawals and restorations are requested through the manifest repository’s maintenance Action and merge after its required checks. See [CATALOG.md](CATALOG.md) for setup and operating instructions.

For an upload-only manual retry, set `validated_run_id` to a previous successful release
validation run (the number in its Actions URL), including one whose later attach failed. The downloaded candidate must carry a
complete receipt for the exact tag/source, every required gate and identical artifact
hashes. Missing/expired artifacts, old receipt-free candidates and mismatched sources
fail safely. Evidence older than 24 hours requires fresh advisory validation. Leave it blank to build and verify a new candidate; code checks can reuse
matching trusted evidence, but artifact installation, reproducibility, inventory and
fresh advisories always execute. See [CI.md](CI.md) for execution groups and manual full
validation. Upload-only retry does not bypass release acceptance.

Once a draft contains `validation.json`, use an upload-only retry with the original validated run ID to retain identical receipt bytes. Fresh validation creates a different receipt even when archives reproduce; existing receipt assets are never overwritten. Keep the original candidate/evidence available until publication.
