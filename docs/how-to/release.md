# Release and publish LyricBridge

Use release-please to prepare a draft, verify its artifacts, and publish to the shared Jellyfin catalog.
Start with a working [development environment](develop.md) and understand the [distribution obligations](../reference/distribution.md).

## Configure repository access

Install the shared GitHub App on the plugin and manifest repositories.
It needs Contents, Pull requests, and Issues read/write, plus Actions and Attestations read access.
In the plugin's Actions settings, set variable `PLUGIN_APP_CLIENT_ID` and secret `PLUGIN_APP_PRIVATE_KEY` to the App credentials.
Keep private keys out of the checkout.

Require the aggregate `validate` check on `main`. App-created PRs must trigger ordinary validation.
The [release preparation workflow](../../.github/workflows/release-please.yml) defines token scopes and execution; grant only the permissions it requires.
Catalog notification uses separately scoped access to the manifest repository.

## Prepare the release PR

Use Conventional Commit messages or squash PR titles so release-please can derive the version and changelog.
Review its proposed release notes for meaningful reader-facing changes.
Let automation update version metadata and lockfile references together; do not make an unrelated manual version bump.
For a deliberate override, use a one-time `Release-As:` footer rather than permanent configuration.

Packaging reads the versioned changelog section and its date. Preserve their structure and remove duplicate sections before merging the release PR.

## Verify and publish the draft

After the release PR passes required checks, merge it. Leave the resulting release as a draft until its artifact workflow is green.

1. Download the plugin, web, and source archives together with `manifest.json`, `SHA256SUMS`, and `validation.json`.
2. From that download directory, verify the checksums:

    ```sh
    sha256sum -c SHA256SUMS
    ```

3. Confirm every listed artifact reports `OK` and the manifest names the intended repository, version, host compatibility, and download URLs.
4. Check that validation refers to these exact artifacts.
5. Publish the draft and confirm its downloads work without authentication.

Keep matching archives available together. Published tags and assets are immutable; a correction needs a new reviewed release.
Publication and installation into a live server are separate operator actions.

## Recover an upload failure

Keep the release unpublished. Run **Build draft release artifacts** with its existing tag.
Leave `validated_run_id` blank when validation must run again; provide the successful run ID for an upload-only retry.
If the draft already has a receipt, reuse its original validated run to preserve identical receipt bytes.

Upload-only recovery requires current, complete evidence and identical artifacts.
If evidence expired or bytes conflict, inspect the workflow failure rather than overwriting assets or moving tags.
A tagged source fix needs a new reviewed release/version. The [workflow inputs](../../.github/workflows/release.yml) define the recovery interface.

## Build release artifacts locally

For an unpublished local release build, set the intended public URLs:

```sh
LYRICBRIDGE_REPOSITORY_URL=https://github.com/OWNER/REPOSITORY \
LYRICBRIDGE_DOWNLOAD_BASE_URL=https://github.com/OWNER/REPOSITORY/releases/download/vVERSION \
  pnpm build --release
```

Replace `OWNER`, `REPOSITORY`, and `VERSION` with the intended destination and version.
This writes artifacts without publishing. Use [clean package acceptance](validate.md#verify-distributable-artifacts) before treating them as release evidence.

## Maintain catalog availability

Publishing a stable release triggers catalog notification. If notification fails, rerun **Notify shared plugin catalog** with the published tag.
The manifest repository verifies public artifacts before proposing its catalog update; notification alone does not establish installation availability.

For withdrawal or restoration, use **Withdraw or restore version** in the manifest repository.
Follow its [operating instructions](https://github.com/rakuzen25/jellyfin-plugin-manifest/blob/main/OPERATIONS.md).
Withdrawing a version changes catalog availability without deleting releases or uninstalling existing plugins.

## Next steps

[Install the published plugin](install.md) or [investigate validation evidence](../explanation/validation.md).
