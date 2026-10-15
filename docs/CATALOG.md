# Shared Jellyfin catalog integration

Catalog implementation, history, maintenance workflows and their tests live in [rakuzen25/jellyfin-plugin-manifest](https://github.com/rakuzen25/jellyfin-plugin-manifest). Its [operating instructions](https://github.com/rakuzen25/jellyfin-plugin-manifest/blob/main/OPERATIONS.md) cover repository protection, withdrawals, restoration and onboarding other plugins. Change catalog behavior there; LyricBridge no longer maintains an exporter or duplicate catalog implementation.

Users subscribe to:

```text
https://raw.githubusercontent.com/rakuzen25/jellyfin-plugin-manifest/main/manifest.json
```

## LyricBridge credentials

Use the shared GitHub App installed on both `jellyfin-plugin-lyricbridge` and `jellyfin-plugin-manifest`. Its repository permissions are Contents, Pull requests and Issues read/write, plus Actions and Attestations read-only; Metadata read is automatic. No webhook server or OAuth flow is needed.

In LyricBridge's Actions settings, configure:

- Variable `PLUGIN_APP_CLIENT_ID`: the App's Client ID.
- Secret `PLUGIN_APP_PRIVATE_KEY`: its complete PEM private key.

Release Please mints a short-lived token scoped to this plugin with Contents, Pull requests and Issues write. Catalog notification mints a separate token scoped only to the manifest repository with Contents write, required for repository dispatch. Keep the required `validate` check on LyricBridge's main branch. Remove the old `RELEASE_PLEASE_TOKEN` only after confirming App-created release PRs trigger CI.

## Release contract and retries

The existing draft/tag, artifact validation and final manual Publish flow remain documented in [RELEASING.md](RELEASING.md). Each release keeps its three archives, `manifest.json`, `SHA256SUMS` and `validation.json`.

The per-release manifest describes one exact plugin version. The shared catalog combines verified release entries. The attested validation receipt binds the original five artifact hashes; it is excluded from its own hash inventory and `SHA256SUMS`. Archive verification and attestation remain part of LyricBridge's release workflow.

Publishing a stable release triggers **Notify shared plugin catalog**. Drafts and prereleases are excluded. The receiving repository revalidates release identity and public artifacts before proposing its catalog update. If notification fails, rerun that workflow with the published tag; the manifest repository also reconciles daily and supports manual refresh. Repeated notifications are safe.

For withdrawal or restoration, use **Withdraw or restore version** in the manifest repository, with the plugin repository, exact four-component version and reason. These operations do not delete releases or uninstall existing plugins. All catalog maintenance tests and runtime checks belong to that repository rather than LyricBridge's CI.
