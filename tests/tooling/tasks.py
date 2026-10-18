"""Task selection and failure/argument propagation are the public developer interface."""

import subprocess
import unittest
from unittest.mock import call, patch

from scripts import tasks
from scripts.__main__ import main


class TaskTests(unittest.TestCase):
    def test_backend_check_never_installs_dependencies(self):
        with (
            patch.object(tasks, "run") as run,
            patch.object(tasks, "ensure") as ensure,
            patch.object(tasks, "verify", return_value=True),
            patch("pathlib.Path.exists", return_value=True),
        ):
            tasks.check("backend")
        self.assertTrue(run.call_args_list)
        self.assertTrue(
            all(
                "format" in invocation.args and "--no-restore" in invocation.args
                for invocation in run.call_args_list
            )
        )
        ensure.assert_not_called()

    def test_node_tests_are_all_selected_once_across_unit_boundaries(self):
        with patch.object(tasks, "run") as run, patch.object(tasks, "UNIT_MODULES", ()):
            tasks.test("frontend", [])
            tasks.test("tooling", [])
        selected = [
            argument
            for invocation in run.call_args_list
            for argument in invocation.args
            if argument.endswith(".test.mjs")
        ]
        discovered = sorted(
            str(path.relative_to(tasks.ROOT))
            for path in (tasks.ROOT / "tests/tooling").glob("*.test.mjs")
        )
        self.assertEqual(discovered, sorted(selected))
        self.assertEqual(len(selected), len(set(selected)))

    def test_default_tests_exclude_acceptance_and_cover_all_unit_boundaries(self):
        with patch.object(tasks, "test") as run:
            main(["test"])
            self.assertEqual(
                [call("frontend", []), call("backend", []), call("tooling", [])],
                run.call_args_list,
            )

    def test_browser_arguments_are_forwarded_without_interpretation(self):
        with patch.object(tasks, "test") as run:
            main(["test", "browser", "--project", "workflow-chromium", "--workers=2"])
            run.assert_called_once_with(
                "browser", ["--project", "workflow-chromium", "--workers=2"]
            )

    def test_failure_stops_remaining_tasks(self):
        with patch.object(
            tasks, "check", side_effect=subprocess.CalledProcessError(1, "check")
        ) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                main(["check"])
            run.assert_called_once_with("frontend")

    def test_targeted_check_and_format_remain_separate(self):
        with (
            patch.object(tasks, "check") as check,
            patch.object(tasks, "format_target") as format,
        ):
            main(["check", "tooling"])
            check.assert_called_once_with("tooling")
            format.assert_not_called()
            main(["format", "frontend"])
            format.assert_called_once_with("frontend", True)

    def test_invalid_targets_and_flags_are_rejected(self):
        for argv in (
            ["check", "unknown"],
            ["build", "frontend", "--release"],
            ["dev", "--port", "0"],
            ["check", "--fix"],
        ):
            with self.subTest(argv=argv), self.assertRaises(SystemExit):
                main(argv)

    def test_build_default_selects_clean_packaging(self):
        with (
            patch("scripts.build.clean_package.clean_package") as build,
            patch("scripts.dev.references.ensure"),
        ):
            main(["build", "--prepared-web"])
            build.assert_called_once_with(False, True)


if __name__ == "__main__":
    unittest.main()
