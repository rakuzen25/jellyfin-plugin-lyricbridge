"""Concrete source/release boundary checks; no provider or running-server calls."""

from pathlib import Path

root = Path(__file__).resolve().parent.parent
core = "\n".join(p.read_text() for p in (root / "src/Core").glob("*.cs"))
infra = "\n".join(p.read_text() for p in (root / "src/Infrastructure").glob("*.cs"))
for token in ("Plugin.Instance", "Microsoft.Data.Sqlite", "MediaBrowser.", "Jellyfin."):
    assert token not in core, "Core boundary violation: " + token
assert "Plugin.Instance" not in infra, "Infrastructure configuration must be injected"
controller = (root / "src/Api.cs").read_text()
for token in ("store.Get<", "store.Set(", '"selected"', '"variants"'):
    assert token not in controller, (
        "Controller contains generic persistence workflow: " + token
    )
assert (
    "installLyricTransport" not in (root / "frontend/renderer/runtime.ts").read_text()
)
assert not list((root / "dist" / "web").glob("*.ts")), (
    "Generated assets must preserve the distributed JavaScript filenames"
)
print(
    "PASS: Core/Infrastructure/controller boundaries, one transport owner, public asset filenames."
)
