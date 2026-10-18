"""Enforce maintained assembly dependencies and host-free test boundaries."""

import xml.etree.ElementTree as ET
from pathlib import Path


def check_graph(graph: dict[str, set[str]]) -> None:
    active: set[str] = set()
    complete: set[str] = set()

    def visit(node: str) -> None:
        if node in active:
            raise ValueError("Project dependency cycle: " + node)
        if node in complete:
            return
        active.add(node)
        for dependency in graph.get(node, set()):
            visit(dependency)
        active.remove(node)
        complete.add(node)

    for node in graph:
        visit(node)


def check_projects(root: Path) -> None:
    core = "src/Core/LyricBridge.Core.csproj"
    infrastructure = "src/Infrastructure/LyricBridge.Infrastructure.csproj"
    host = "src/Host/LyricBridge.csproj"
    vendor = "vendor/Lyricify.Lyrics.Helper/Lyricify.Lyrics.Helper.csproj"
    allowed = {
        core: set(),
        infrastructure: {core, vendor},
        host: {core, infrastructure, vendor},
        "tests/backend/Core/LyricBridge.Core.Tests.csproj": {core},
        "tests/backend/Infrastructure/LyricBridge.Infrastructure.Tests.csproj": {
            infrastructure
        },
        "tests/backend/Host/LyricBridge.Host.Tests.csproj": {host},
    }
    graph: dict[str, set[str]] = {}
    for name, dependencies in allowed.items():
        project = root / name
        tree = ET.parse(project)
        actual = {
            (project.parent / item.attrib["Include"])
            .resolve()
            .relative_to(root.resolve())
            .as_posix()
            for item in tree.findall(".//ProjectReference")
        }
        if actual != dependencies:
            raise ValueError("Unexpected project dependencies: " + name)
        graph[name] = actual
        if (name == core or name.startswith("tests/backend/Core/")) and (
            tree.findall(".//Reference") or tree.findall(".//FrameworkReference")
        ):
            raise ValueError("Host/runtime references in Core boundary: " + name)
    check_graph(graph)
    for boundary, forbidden in {
        "Core": (
            "Microsoft.Data.Sqlite",
            "MediaBrowser.",
            "Jellyfin.",
            "System.Net.Http",
            "Plugin.Instance",
        ),
        "Infrastructure": ("MediaBrowser.", "Jellyfin.", "Plugin.Instance"),
    }.items():
        for source in (root / "src" / boundary).rglob("*.cs"):
            if {"bin", "obj"}.intersection(source.parts):
                continue
            text = source.read_text()
            for token in forbidden:
                if token in text:
                    raise ValueError(
                        "Forbidden dependency "
                        + token
                        + ": "
                        + str(source.relative_to(root))
                    )


def main() -> None:
    check_projects(Path(__file__).resolve().parents[2])
    print(
        "PASS: production project graph and independent Core/Infrastructure/Host test boundaries."
    )


if __name__ == "__main__":
    main()
