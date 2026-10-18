# Release and publish LyricBridge

Use release-please to prepare a versioned draft, verify its exact artifacts, and publish
it to the shared Jellyfin catalog. Start with the [development toolchain](DEVELOPMENT.md)
and retain [distribution licenses and corresponding source](LICENSES.md).

## Configure GitHub

Install the shared GitHub App on both `jellyfin-plugin-lyricbridge` and
`jellyfin-plugin-manifest`. Grant Contents, Pull requests, and Issues read/write,
plus Actions and Attestations read-only; Metadata read is automatic.

In LyricBridge's Actions settings, configure:

| Setting                         | Value                    |
| ------------------------------- | ------------------------ |
| Variable `PLUGIN_APP_CLIENT_ID` | App Client ID            |
| Secret `PLUGIN_APP_PRIVATE_KEY` | Complete PEM private key |

Release Please mints a short-lived token scoped to this plugin with Contents,
Pull requests, and Issues write. Catalog notification uses a separate token scoped
to the manifest repository with Contents write for dispatch. No webhook server,
OAuth flow, or long-lived release PAT is required.

Require aggregate `validate` on `main`. App-created PRs trigger ordinary CI.
Artifact upload uses the workflow token with narrowly scoped OpenID Connect (OIDC)
and attestation permissions for the public validation receipt.
**Prepare release** owns main-push validation: ordinary pushes validate candidates;
new drafts validate release artifacts. PR/manual validation remains available.

## Prepare the release PR

Commit changes with Conventional Commit titles, or use them as squash PR titles:

| Commit type                           | Before-1.0 version effect |
| ------------------------------------- | ------------------------- |
| `fix:` or `feat:`                     | Patch                     |
| `feat!:` or `BREAKING CHANGE:` footer | Minor                     |

Release-please maintains one release PR and changelog. It updates `version.txt`,
the authoritative version in `Directory.Build.props`, and only LyricBridge
project-reference versions in .NET lockfiles. Third-party versions/hashes stay intact.
Use a one-time `Release-As:` footer only for a deliberate version override;
do not manually bump metadata or configure permanent `release-as`.

Review the PR's release notes for meaningful reader-facing changes. Packaging reads
the matching changelog section and committed release date, so preserve version
headings/dates and avoid duplicate sections.

## Verify and publish the draft

After the release PR passes required checks, merge it. The workflow creates the draft
and tag, runs [validation gates](CI.md), and attaches six assets:

| Asset                            | Contents                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `lyricbridge-VERSION.zip`        | Plugin, embedded renderer, dependencies, dictionaries, notices                         |
| `lyricbridge-web-VERSION.zip`    | Optional separately installed web renderer                                             |
| `lyricbridge-source-VERSION.zip` | Matching editable source, licenses, build inputs                                       |
| `manifest.json`                  | This plugin's exact catalog version                                                    |
| `SHA256SUMS`                     | Hashes of the three ZIPs and manifest                                                  |
| `validation.json`                | Attested validation receipt binding those five artifacts; excluded from its own hashes |

Replace `VERSION` with the release version when locating archives.
A matching unpublished draft at the exact current commit can be resumed. Mismatched
or duplicate tags fail rather than being recreated.

Before publishing:

1. Confirm the artifact workflow is green; leave incomplete releases as drafts.
2. Download all six assets to one directory and verify its checksums:

    ```sh
    sha256sum -c SHA256SUMS
    ```

3. Review manifest version, GUID, ABI, repository URL, and download URLs.
4. Publish the draft, then confirm unauthenticated downloads.

Keep plugin/web/source archives available together for corresponding-source compliance.
Publication and live installation are separate owner actions.
Published tags/assets must remain unchanged.

## Recover a failed artifact upload

Leave the release as a draft. In Actions, run **Build draft release artifacts** with
the existing unpublished `vVERSION` tag. Identical existing assets are accepted;
conflicting bytes, moved tags, and published releases are rejected.

| Situation                                               | Retry                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| No receipt is attached; build/validation must run again | Leave `validated_run_id` blank                                                                                                  |
| Upload failed after successful validation               | Set `validated_run_id` to that run's numeric Actions ID                                                                         |
| Draft already has `validation.json`                     | Reuse the original validated run ID to preserve identical receipt bytes                                                         |
| Tagged source needs a fix                               | Prepare a reviewed release commit/version; deliberately resolve an unpublished draft/tag before attempting to reuse its version |

Upload-only retry requires the exact tag/source, complete successful receipt, and
identical downloaded bytes. A run whose later attach failed can qualify.
Missing/expired artifacts or receipts fail; evidence older than 24 hours requires
fresh release validation/advisories. Fresh validation produces a different receipt
even if archives reproduce, and existing receipt assets are never overwritten.
Retain original candidate/evidence until publication.

## Build local release artifacts

For a local release-mode build, complete [toolchain setup](DEVELOPMENT.md) and set
the intended HTTPS repository/download URLs:

```sh
LYRICBRIDGE_REPOSITORY_URL=https://github.com/OWNER/REPOSITORY \
LYRICBRIDGE_DOWNLOAD_BASE_URL=https://github.com/OWNER/REPOSITORY/releases/download/vVERSION \
  scripts/build/package.sh --release
```

Replace `OWNER`, `REPOSITORY`, and `VERSION` with the intended public repository and
release version. The default non-release manifest uses loopback test URLs.
Packaging writes files without publishing. Standalone packaging does not establish a
clean source root; use [clean package acceptance](CI.md#local-commands) for that.

## Notify and maintain the shared catalog

Publishing a stable release triggers **Notify shared plugin catalog**.
Drafts and prereleases are excluded. The manifest repository verifies release identity,
the attested receipt, aggregate/artifact gates, and public hashes before proposing a
catalog PR. Its auto-merge remains behind required validation.

If notification fails, rerun that workflow with the published tag. Repeated
notifications are safe; the catalog also reconciles daily and supports manual refresh.
Users subscribe through the [installation catalog URL](DEPLOYMENT.md#install-from-the-catalog).

For withdrawal/restoration, use **Withdraw or restore version** in
[jellyfin-plugin-manifest](https://github.com/rakuzen25/jellyfin-plugin-manifest), supplying
the plugin repository, exact four-component version, and reason. This changes catalog
availability without deleting releases or uninstalling plugins. Catalog implementation,
maintenance tests, protection, and onboarding belong to that repository; see its
[operating instructions](https://github.com/rakuzen25/jellyfin-plugin-manifest/blob/main/OPERATIONS.md).

## Next steps

- [Install the published plugin](DEPLOYMENT.md) and verify its web/storage status.
- [Inspect validation evidence](CI.md) when troubleshooting failed gates or reuse.
