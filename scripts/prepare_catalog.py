"""Export a self-contained catalog repository without creating or publishing one."""

import argparse
from pathlib import Path
import shutil


def prepare(root: Path, destination: Path) -> None:
    if destination.exists():
        raise ValueError(
            "Destination must not exist; existing repositories are never overwritten"
        )
    shutil.copytree(root / "catalog-repository", destination)
    shutil.copyfile(root / "CATALOG.md", destination / "OPERATIONS.md")
    shutil.copyfile(root / "LICENSE", destination / "LICENSE")
    shutil.copyfile(
        root / ".github/actionlint.yaml", destination / ".github/actionlint.yaml"
    )
    (destination / "scripts").mkdir()
    for name in ("catalog.py", "catalog_sync.py", "catalog_maintenance.py"):
        shutil.copyfile(root / "scripts" / name, destination / "scripts" / name)
    (destination / "tests").mkdir()
    shutil.copyfile(
        root / "tests/CatalogMaintenance.py",
        destination / "tests/CatalogMaintenance.py",
    )
    shutil.copyfile(
        root / "tests/CatalogDiscovery.py", destination / "tests/CatalogDiscovery.py"
    )
    shutil.copyfile(
        root / "tests/CatalogPublication.py",
        destination / "tests/CatalogPublication.py",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    prepare(Path(__file__).resolve().parent.parent, args.destination)
