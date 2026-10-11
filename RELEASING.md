# Automated releases

LyricBridge uses release-please for one repository-wide version and changelog. It updates `version.txt`, the authoritative version in `Directory.Build.props`, and only the LyricBridge project-reference versions in .NET lockfiles. Third-party dependency versions and hashes are preserved. Packaging reads the matching changelog section and its committed release date for the catalog; notes and URLs are not left at the initial release defaults.

The flow is: Conventional Commits on `main` → release PR → passing PR checks and your merge → draft release and tag → full validation/reproducibility/installed-plugin checks → tested assets attached → your final Publish click. The workflow never installs on a live server or changes a shared catalog. A draft without a green artifact workflow is not ready to publish.

## One-time GitHub setup

1. Create a fine-grained personal access token with resource owner `rakuzen25` and repository access limited to **only** `jellyfin-plugin-lyricbridge`. Give it repository permissions **Contents: Read and write**, **Pull requests: Read and write**, and **Issues: Read and write** (release labels). Metadata read access is included automatically; no other repository or account permissions are needed.
2. In this repository's **Settings → Secrets and variables → Actions**, create the repository secret `RELEASE_PLEASE_TOKEN` with that token. Never commit it. Choose an expiration and renew the secret before the token expires.
3. Require the `validate` check on release PRs using a rule for `main`. Merge a release PR only after its CI is green. Keep release tags immutable once published.

The personal access token lets release PRs trigger normal PR CI; PRs created with the default workflow token do not trigger it. Artifact upload uses the repository's ordinary workflow token with write access limited to the attaching job. The personal access token is supplied only to release-please, and external actions are pinned to commit SHAs.

`Prepare release` owns validation for pushes to `main`: ordinary pushes call candidate validation, while newly created releases call artifact validation once against the release commit. PRs and manual validation remain independently available; there is no second standalone push-validation run.

## Prepare 0.1.1

0.1.0 is already published. Keep its tag and assets unchanged, and leave the bookkeeping manifest at the last released version until release-please updates it.

Commit the reviewed automatic-injection changes through your normal PR flow. Use a Conventional Commit with the one-time footer `Release-As: 0.1.1` (retain this footer in the squash commit if applicable). Do not bump metadata or project lockfile references manually: release-please creates a release PR updating them together.

Review and merge the generated 0.1.1 release PR only after its checks pass. The workflow creates a draft with an actual `v0.1.1` tag, validates the exact commit and attaches:

- `lyricbridge-0.1.1.zip` — plugin, embedded renderer, dependencies, dictionaries and notices.
- `lyricbridge-web-0.1.1.zip` — optional separately installed web enhancement.
- `lyricbridge-source-0.1.1.zip` — matching editable/licensed source and build inputs.
- `manifest.json` — this plugin's catalog entry.
- `SHA256SUMS` — all three ZIPs and the manifest.

Keep the plugin/web/source archives together for corresponding-source availability. After the artifact workflow is green, download all five assets, verify `sha256sum -c SHA256SUMS`, review the manifest's version/GUID/ABI/URLs and publish the draft. Confirm unauthenticated downloads after publishing. Do not publish an empty draft while validation is running. Publication, shared-catalog changes and live installation are performed by the repository owner.

## Future releases and retries

Use Conventional Commit messages (or squash PR titles): `fix:` for fixes, `feat:` for features, and `feat!:` or a `BREAKING CHANGE:` footer for breaking changes. Before 1.0, breaking changes bump the minor version and nonbreaking features/fixes bump the patch under this configuration. Use a one-time `Release-As:` footer when choosing a specific version; do not add a permanent `release-as` setting.

Release-please keeps a release PR updated. Review and merge it when ready. No manual version edits, tags or ZIP uploads are needed; publishing remains an explicit final click.

If artifact validation/upload fails, leave the release as a draft. After resolving the failure, run **Build draft release artifacts** from Actions with the existing tag (for example `v0.1.0`). It validates the tagged source again. Identical existing assets are accepted; conflicting files, moved tags or published releases are rejected. It never overwrites existing assets. A source fix belongs in a new reviewed release commit/version rather than silently replacing a published artifact. For an unpublished failed draft whose source must change, resolve the draft/tag deliberately before recreating that version; this workflow will not delete or move tags for you.

## Shared Jellyfin catalog

After publication, download this release's `manifest.json` and verify its public asset URLs and checksums. Merge it into the separate shared catalog using:

```sh
python3 scripts/catalog.py --catalog-input /path/to/shared-manifest.json \
  --entry dist/manifest.json --catalog-output /path/to/candidate-manifest.json
```

Use the manifest downloaded from the public release as the entry (copy it to `dist/manifest.json` or supply its actual path). Review and publish the catalog change separately. Each plugin retains its own repository, GUID and version; unrelated plugin releases are preserved. Cross-repository catalog PR automation can be added once the catalog repository and its authorization are configured.

For an upload-only manual retry, set `validated_run_id` to the previous run ID whose full `validate` job passed (the number in its Actions URL). This skips validation and downloads that run’s tested candidate artifact. The source run must match the tag’s checked-out commit and contain a successful validation job; missing/expired artifacts fail the retry. Leave it blank to run full validation. Automatic releases always run full validation.
