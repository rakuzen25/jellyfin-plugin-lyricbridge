# Distribution obligations

Distribute LyricBridge binaries with their matching notices and corresponding source.
This reference is for release maintainers; follow [release publication](../how-to/release.md) for the procedure.

## Keep matching material together

The plugin, web, and editable-source archives form one distribution.
Keep them available together so recipients can obtain the source and build inputs corresponding to the binaries they downloaded.
An unrelated upstream revision or a newer checkout is not a substitute for matching source.

Original plugin code and the modified Lyricify helper use Apache 2.0.
The LyricMotion-derived renderer uses MPL 2.0, including derived modules and styles.
Preserve source notices and supply their complete matching editable sources and build inputs.

The pronunciation dependencies include dynamically linked LGPL material and dictionary copying terms.
Retain the corresponding upstream source archive, notices permitting replacement/modification, and dictionary COPYING/AUTHORS files.
Do not remove these as apparent duplicates or prose-cleanup candidates.

## Use authoritative inventories

[Upstream provenance](../../vendor/UPSTREAM.md) records pinned origins and local adaptations.
The packaged `dependency-inventory.json` identifies shipped files and matching notices.
[Project NOTICE](../../NOTICE) and the preserved vendor license texts state the attribution and licensing material; this page does not restate every package version or hash.

[Artifact validation](../../tests/tooling/PackageArtifacts.py) checks matching source and notices in the archives.
Build/test dependencies restored from lockfiles are not shipped as `node_modules`.
Host-provided assemblies must not be confused with plugin-owned payloads when assessing a distribution.
