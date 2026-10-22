"""Lyric-specific validation groups and maintained input coverage."""

import unittest

from jellyfin_plugin_toolkit.ci.policy import browser_inventory, classification, impacts
from jellyfin_plugin_toolkit.common.source_inventory import source_files
from jellyfin_plugin_toolkit.context import Context


class ConsumerPolicyTests(unittest.TestCase):
    def test_all_maintained_inputs_have_a_declared_rule(self):
        context = Context.load()
        for path in source_files(context.root):
            with self.subTest(path=path):
                classification(context, path.as_posix())
        browser_inventory(context)

    def test_toolkit_and_build_configuration_require_every_enabled_group(self):
        context = Context.load()
        for path in [
            "plugin.toml",
            "uv.lock",
            "Directory.Build.props",
            ".github/workflows/validate.yml",
        ]:
            self.assertEqual(set(context.groups), impacts(context, path))

    def test_renderer_changes_preserve_rendering_and_performance_gates(self):
        context = Context.load()
        self.assertTrue(
            {"frontend", "workflow", "rendering", "performance", "artifacts"}
            <= impacts(context, "frontend/renderer/lyrics/layout.ts")
        )
        self.assertEqual(set(), impacts(context, "docs/how-to/develop.md"))


if __name__ == "__main__":
    unittest.main()
