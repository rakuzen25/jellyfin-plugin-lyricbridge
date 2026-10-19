"""Dependency policy failures should identify the architectural boundary."""

import tempfile
import unittest
from pathlib import Path

from jellyfin_plugin_toolkit.checks.architecture import check_graph, check_projects


class ArchitectureTests(unittest.TestCase):
    def test_repository_matches_the_project_policy(self):
        check_projects(Path(__file__).resolve().parents[2])

    def test_cycles_fail_even_when_the_entry_project_is_acyclic(self):
        with self.assertRaisesRegex(ValueError, "cycle"):
            check_graph(
                {
                    "host": {"infrastructure"},
                    "infrastructure": {"core"},
                    "core": {"infrastructure"},
                }
            )
        check_graph(
            {
                "host": {"infrastructure", "core"},
                "infrastructure": {"core"},
                "core": set(),
            }
        )

    def test_core_cannot_acquire_a_host_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            import shutil

            for filename in ["plugin.toml", "version.txt"]:
                shutil.copy2(
                    Path(__file__).resolve().parents[2] / filename, root / filename
                )
            # Supply the complete declared graph before introducing a forbidden edge.
            import tomllib

            policy = tomllib.loads((root / "plugin.toml").read_text())
            for name, dependencies in policy["architecture"]["edges"].items():
                import os

                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(
                    "<Project><ItemGroup>"
                    + "".join(
                        '<ProjectReference Include="'
                        + os.path.relpath(root / dependency, target.parent)
                        + '"/>'
                        for dependency in dependencies
                    )
                    + "</ItemGroup></Project>"
                )
            project = root / "src/Core/LyricBridge.Core.csproj"
            project.parent.mkdir(parents=True, exist_ok=True)
            project.write_text(
                '<Project><ItemGroup><ProjectReference Include="../Host/LyricBridge.csproj" /></ItemGroup></Project>'
            )
            with self.assertRaisesRegex(
                ValueError, "Unexpected project dependencies.*Core"
            ):
                check_projects(root)


if __name__ == "__main__":
    unittest.main()
