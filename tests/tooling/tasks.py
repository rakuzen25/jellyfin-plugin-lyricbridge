"""Task selection and failure/argument propagation are the public developer interface."""

import subprocess
import unittest
from unittest.mock import call, patch

from scripts import tasks
from scripts.__main__ import main


class TaskTests(unittest.TestCase):
    def test_docs_check_formats_before_links_and_propagates_failures(self):
        with patch.object(tasks, "run") as run:
            tasks.check("docs")
        self.assertEqual("--check", run.call_args_list[0].args[3])
        self.assertEqual(tuple(tasks.DOCS_FORMAT), run.call_args_list[0].args[4:])
        self.assertEqual("scripts.checks.docs", run.call_args_list[1].args[-1])
        with (
            patch.object(
                tasks, "run", side_effect=subprocess.CalledProcessError(1, "prettier")
            ) as run,
            self.assertRaises(subprocess.CalledProcessError),
        ):
            tasks.check("docs")
        self.assertEqual(1, run.call_count)

    def test_default_format_includes_docs_and_target_is_available(self):
        with patch.object(tasks, "format_target") as format:
            main(["format"])
            self.assertEqual(
                [
                    call(target, True)
                    for target in ("frontend", "backend", "tooling", "docs")
                ],
                format.call_args_list,
            )
            format.reset_mock()
            main(["format", "docs"])
            format.assert_called_once_with("docs", True)

    def test_frontend_check_runs_application_and_test_compilers(self):
        with patch.object(tasks, "run") as run:
            tasks.check("frontend")
        compilers = [
            invocation.args
            for invocation in run.call_args_list
            if "tsc" in invocation.args
        ]
        self.assertEqual(2, len(compilers))
        self.assertNotIn("--project", compilers[0])
        self.assertIn("tsconfig.tests.json", compilers[1])

    def test_tooling_checks_toml_and_pinned_workflows_without_installing(self):
        with (
            patch.object(tasks, "run") as run,
            patch.object(tasks, "python_checks", return_value="python"),
        ):
            tasks.check("tooling")
        invocations = [invocation.args for invocation in run.call_args_list]
        self.assertTrue(
            any("taplo" in args and "--check" in args for args in invocations)
        )
        docker = next(args for args in invocations if args[0] == "docker")
        self.assertIn(str(tasks.ROOT) + ":/work:ro", docker)
        self.assertEqual("none", docker[docker.index("--network") + 1])
        self.assertRegex(docker[-1], r"^rhysd/actionlint:[0-9.]+@sha256:[a-f0-9]{64}$")
        self.assertFalse(any("install" in args for args in invocations))

    def test_dev_watch_flag_defaults_and_parsing(self):
        with patch("scripts.dev.local_jellyfin.dev") as dev:
            main(["dev"])
            self.assertFalse(dev.call_args.args[0].no_watch)
            main(["dev", "--no-watch", "--port", "18097"])
            self.assertTrue(dev.call_args.args[0].no_watch)
            self.assertEqual(18097, dev.call_args.args[0].port)

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
