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
                classification(path.as_posix(), context.root)
        browser_inventory(context.root)

    def test_toolkit_and_build_configuration_require_every_enabled_group(self):
        context = Context.load()
        for path in [
            "plugin.toml",
            "toolkit.lock.json",
            "Directory.Build.props",
            ".github/workflows/validate.yml",
        ]:
            self.assertEqual(set(context.groups), impacts(path, context.root))

    def test_renderer_changes_preserve_rendering_and_performance_gates(self):
        context = Context.load()
        self.assertTrue(
            {"frontend", "workflow", "rendering", "performance", "artifacts"}
            <= impacts("frontend/renderer/lyrics/layout.ts", context.root)
        )
        self.assertEqual(set(), impacts("docs/how-to/develop.md", context.root))


if __name__ == "__main__":
    unittest.main()
