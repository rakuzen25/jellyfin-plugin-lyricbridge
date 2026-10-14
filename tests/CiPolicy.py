"""Deterministic selection, receipt and clean-build safety regressions; no GitHub calls."""

import copy
from datetime import datetime, timedelta, timezone
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import ci
from source_inventory import source_files

ROOT = Path(__file__).resolve().parent.parent


class IsolatedCiTestCase(unittest.TestCase):
    def setUp(self):
        # Runner context must never select a different policy path or enable real
        # GitHub calls. Individual scenarios opt into push/release context below.
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("GITHUB_")
            and key not in {"GH_TOKEN", "CI_RUN_HEAD_SHA", "CI_JOB_RESULTS"}
        }
        environment["GITHUB_EVENT_NAME"] = "pull_request"
        context = patch.dict(os.environ, environment, clear=True)
        context.start()
        self.addCleanup(context.stop)


class PolicyTests(IsolatedCiTestCase):
    def test_representative_impacts(self):
        cases = {
            "README.md": set(),
            "version.txt": {"artifacts"},
            ".editorconfig": {"frontend", "backend"},
            "scripts/format-dotnet.sh": {"backend", "tooling", "artifacts"},
            ".dockerignore": {"tooling", "artifacts"},
            "frontend/bridge/search-session.ts": {"frontend", "workflow", "artifacts"},
            "frontend/bridge/contracts.ts": {
                "frontend",
                "workflow",
                "rendering",
                "performance",
                "artifacts",
            },
            "frontend/renderer/timeline.ts": {
                "frontend",
                "rendering",
                "performance",
                "artifacts",
            },
            "src/Core/Models.cs": {
                "backend",
                "tooling",
                "artifacts",
                "workflow",
                "rendering",
            },
            "src/WebRendererIntegration.cs": {"backend", "tooling", "artifacts"},
            "scripts/package.sh": {"tooling", "artifacts"},
            ".github/workflows/validate.yml": set(ci.GROUPS),
            "catalog-repository/plugins.json": {"tooling", "artifacts"},
            "scripts/catalog_sync.py": {"tooling", "artifacts"},
            "renovate.json": {"metadata"},
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.assertEqual(ci.impacts(path), expected)

    def test_browser_inventory_is_complete_and_unique(self):
        ci.browser_inventory(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "browser-tests").mkdir()
            (root / "browser-tests/groups.json").write_text(
                json.dumps({"workflow": [], "rendering": [], "performance": []})
            )
            (root / "browser-tests/unclassified.spec.cjs").touch()
            with self.assertRaisesRegex(ValueError, "exactly one"):
                ci.browser_inventory(root)

    def test_source_inventory_excludes_generated_and_includes_policy(self):
        paths = {str(p) for p in source_files(ROOT)}
        self.assertIn("scripts/ci.py", paths)
        self.assertIn("browser-tests/groups.json", paths)
        self.assertIn(".github/workflows/validate.yml", paths)
        self.assertFalse(
            any("node_modules" in p or "/obj/" in p or "/results" in p for p in paths)
        )

    def test_version_normalization_is_narrow(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "Directory.Build.props"
            path.write_text(
                "<LyricBridgeVersion>0.1.0</LyricBridgeVersion><JellyfinTargetAbi>12.2</JellyfinTargetAbi>"
            )
            original = ci.digest(root, [Path(path.name)], True)
            path.write_text(path.read_text().replace("0.1.0", "0.1.1"))
            self.assertEqual(original, ci.digest(root, [Path(path.name)], True))
            path.write_text(path.read_text().replace("12.2", "12.3"))
            self.assertNotEqual(original, ci.digest(root, [Path(path.name)], True))

    def fixture(self) -> dict:
        return {
            "schema": ci.SCHEMA,
            "repository": "owner/repo",
            "run_id": "100",
            "commit": "commit",
            "tree": "tree",
            "release": True,
            "inputs": {g: g for g in ci.GROUPS},
            "required": list(ci.GROUPS),
            "reused": {},
            "groups": {g: "success" for g in ci.GROUPS},
            "artifacts": {"candidate.zip": "hash"},
        }

    def test_receipt_requires_source_every_gate_inputs_and_bytes(self):
        receipt = self.fixture()
        with (
            patch.object(
                ci,
                "git",
                side_effect=lambda root, *args: (
                    "tree" if "HEAD^{tree}" in args else "commit"
                ),
            ),
            patch.object(ci, "fingerprints", return_value=receipt["inputs"]),
            patch.object(ci, "artifact_hashes", return_value=receipt["artifacts"]),
        ):
            ci.verify(ROOT, receipt, "owner/repo", "100")
            for field, replacement in (
                ("commit", "moved"),
                ("tree", "different"),
                ("run_id", "101"),
                ("release", False),
                ("artifacts", {"candidate.zip": "corrupt"}),
                ("inputs", {}),
            ):
                altered = copy.deepcopy(receipt)
                altered[field] = replacement
                with self.subTest(field=field), self.assertRaises(ValueError):
                    ci.verify(ROOT, altered, "owner/repo", "100")
            for group in ci.GROUPS:
                altered = copy.deepcopy(receipt)
                altered["groups"][group] = "skipped"
                with self.subTest(group=group), self.assertRaises(ValueError):
                    ci.verify(ROOT, altered, "owner/repo", "100")

    def test_failed_artifact_gate_never_generates_release_proof(self):
        selection = self.fixture()
        jobs = {
            name: {"result": "success"}
            for name in (
                "frontend",
                "backend",
                "tooling",
                "workflow",
                "rendering",
                "performance",
                "package",
                "installation",
                "reproducibility",
                "advisories",
            )
        }
        jobs["advisories"]["result"] = "failure"
        result = ci.finish(ROOT, selection, jobs)
        self.assertEqual(result["groups"]["artifacts"], "failure")
        self.assertEqual(result["artifacts"], {})

    def test_releases_without_diff_still_can_reuse_code_checks(self):
        with (
            patch.object(ci, "git", return_value="commit"),
            patch.object(
                ci, "evidence", return_value={g: {"run_id": "100"} for g in ci.CODE}
            ),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            result = ci.plan(ROOT, "", False, True, True, False)
        self.assertEqual(result["execute"], ["artifacts"])

    def test_idle_scheduled_run_skips_but_changed_inputs_force_full(self):
        with (
            patch.object(ci, "git", return_value="commit"),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            with patch.object(
                ci, "evidence", return_value={g: {"run_id": "100"} for g in ci.CODE}
            ):
                self.assertFalse(ci.plan(ROOT, "", False, False, True, True)["execute"])
            with patch.object(ci, "evidence", return_value={}):
                self.assertEqual(
                    set(ci.plan(ROOT, "", False, False, True, True)["execute"]),
                    set(ci.GROUPS),
                )

    def test_missing_base_selects_full_and_manual_full_does_not_reuse(self):
        with patch.object(ci, "git", return_value="commit"):
            self.assertEqual(
                set(ci.plan(ROOT, "", False, False, False, False)["execute"]),
                set(ci.GROUPS),
            )
            self.assertFalse(ci.plan(ROOT, "", True, False, False, False)["reused"])

    def test_fork_or_unapproved_origin_is_rejected(self):
        run: dict = {
            "repository": {"full_name": "owner/repo"},
            "head_repository": {"full_name": "owner/repo"},
            "event": "push",
            "head_branch": "main",
        }
        self.assertTrue(ci.trusted(run, "owner/repo"))
        run["head_repository"]["full_name"] = "fork/repo"
        self.assertFalse(ci.trusted(run, "owner/repo"))

    def test_newest_matching_failure_prevents_old_green_reuse(self):
        runs = [
            {
                "id": 2,
                "path": ".github/workflows/validate.yml",
                "conclusion": "failure",
            },
            {
                "id": 1,
                "path": ".github/workflows/validate.yml",
                "conclusion": "success",
            },
        ]
        inputs = {g: g for g in ci.GROUPS}

        def receipt(repo, run):
            return {
                "policy": "policy",
                "inputs": inputs,
                "groups": {
                    g: "failure" if run["id"] == 2 else "success" for g in ci.CODE
                },
            }

        with (
            patch.object(ci, "api", return_value={"workflow_runs": runs}),
            patch.object(ci, "read_receipt", side_effect=receipt),
        ):
            self.assertEqual(ci.evidence("owner/repo", inputs, "policy"), {})

    def trusted_run(self) -> dict:
        return {
            "id": 100,
            "path": ".github/workflows/release.yml",
            "repository": {"full_name": "owner/repo"},
            "head_repository": {"full_name": "owner/repo"},
            "event": "workflow_dispatch",
            "head_branch": "main",
            "head_sha": "workflow",
            "status": "completed",
            "conclusion": "success",
        }

    def test_idle_schedule_carries_full_input_baseline_without_renewing_artifacts(self):
        inputs = {g: g for g in ci.GROUPS}
        baseline = {
            "policy": "policy",
            "inputs": {g: inputs[g] for g in ci.RUNTIME},
            "origins": {g: "100" for g in ci.RUNTIME},
        }
        run = dict(self.trusted_run(), id=200, path=".github/workflows/safety.yml")
        receipt = {
            "policy": "policy",
            "inputs": inputs,
            "full": False,
            "groups": {},
            "full_baseline": baseline,
        }
        origin_receipt = dict(
            receipt, groups={g: "success" for g in ci.RUNTIME}, full_baseline={}
        )

        def response(repository, endpoint):
            if endpoint.startswith("/actions/runs?"):
                return {"workflow_runs": [run]}
            if endpoint == "/actions/runs/100":
                return self.trusted_run()
            return {
                "jobs": [
                    {"name": name, "status": "completed", "conclusion": "success"}
                    for names in ci.GROUP_JOB_NAMES.values()
                    for name in names
                ]
            }

        with (
            patch.object(ci, "api", side_effect=response),
            patch.object(
                ci,
                "read_receipt",
                side_effect=lambda repo, source: (
                    receipt if source["id"] == 200 else origin_receipt
                ),
            ),
        ):
            proofs = ci.evidence("owner/repo", inputs, "policy", full_only=True)
        self.assertEqual(set(proofs), set(ci.RUNTIME))
        self.assertTrue(all(proof["run_id"] == "100" for proof in proofs.values()))
        self.assertNotIn("artifacts", proofs)
        receipt["full_baseline"] = dict(baseline, policy="changed")
        with (
            patch.object(ci, "api", return_value={"workflow_runs": [run]}),
            patch.object(ci, "read_receipt", return_value=receipt),
        ):
            self.assertEqual(
                ci.evidence("owner/repo", inputs, "policy", full_only=True), {}
            )

    def test_pr_evidence_requires_same_repository_exact_head_and_merge_to_main(self):
        run = dict(
            self.trusted_run(),
            event="pull_request",
            path=".github/workflows/validate.yml",
            pull_requests=[{"number": 1}],
        )
        request: dict = {
            "merged": True,
            "head": {"repo": {"full_name": "owner/repo"}, "sha": "workflow"},
            "base": {"repo": {"full_name": "owner/repo"}, "ref": "main"},
        }
        self.assertTrue(ci.trusted(run, "owner/repo"))
        with patch.object(ci, "api", return_value=request):
            self.assertTrue(ci.merged_pull_request(run, "owner/repo"))
        for field in ("unmerged", "fork", "changed_head", "other_base"):
            altered = copy.deepcopy(request)
            if field == "unmerged":
                altered["merged"] = False
            if field == "fork":
                altered["head"]["repo"]["full_name"] = "fork/repo"
            if field == "changed_head":
                altered["head"]["sha"] = "changed"
            if field == "other_base":
                altered["base"]["ref"] = "development"
            with (
                self.subTest(field=field),
                patch.object(ci, "api", return_value=altered),
            ):
                self.assertFalse(ci.merged_pull_request(run, "owner/repo"))

    def test_expired_and_duplicate_receipt_artifacts_are_not_evidence(self):
        run = self.trusted_run()
        for artifacts in (
            [{"name": "lyricbridge-validation-receipt", "expired": True}],
            [{"name": "lyricbridge-validation-receipt", "expired": False}] * 2,
            [],
        ):
            with (
                self.subTest(artifacts=artifacts),
                patch.object(ci, "api", return_value={"artifacts": artifacts}),
            ):
                self.assertIsNone(ci.read_receipt("owner/repo", run))

    def test_artifact_redirect_does_not_disclose_actions_token(self):
        request = urllib.request.Request(
            "https://api.github.com/repos/owner/repo/actions/artifacts/1/zip",
            headers={"Authorization": "Bearer synthetic"},
        )
        redirected = ci.SafeRedirect().redirect_request(
            request, None, 302, "Found", {}, "https://storage.example.invalid/signed"
        )
        self.assertIsNotNone(redirected)
        assert redirected is not None
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(ValueError):
            ci.SafeRedirect().redirect_request(
                request, None, 302, "Found", {}, "http://storage.example.invalid/signed"
            )

    def test_unavailable_evidence_executes_release_checks(self):
        with (
            patch.object(ci, "git", return_value="commit"),
            patch.object(
                ci, "evidence", side_effect=urllib.error.URLError("unavailable")
            ),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            self.assertEqual(
                set(ci.plan(ROOT, "", False, True, True, False)["execute"]),
                set(ci.GROUPS),
            )

    def test_documentation_only_does_not_query_remote_evidence(self):
        with (
            patch.object(
                ci,
                "git",
                side_effect=lambda root, *args: (
                    "README.md" if args[0] == "diff" else "commit"
                ),
            ),
            patch.object(ci, "evidence") as remote,
        ):
            self.assertEqual(
                ci.plan(ROOT, "base", False, False, True, False)["execute"], []
            )
            remote.assert_not_called()

    def test_unknown_external_inputs_fail_before_evidence_lookup(self):
        with (
            patch.object(
                ci,
                "git",
                side_effect=lambda root, *args: (
                    "unknown.config" if args[0] == "diff" else "commit"
                ),
            ),
            patch.object(ci, "evidence") as remote,
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            with self.assertRaisesRegex(ValueError, "unknown.config"):
                ci.plan(ROOT, "base", False, False, True, False)
            remote.assert_not_called()

    def test_own_version_ranges_normalize_but_external_versions_do_not(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            props = root / "Directory.Build.props"
            props.write_text("<LyricBridgeVersion>0.1.0</LyricBridgeVersion>")
            lock = root / "packages.lock.json"
            data = {
                "dependencies": {
                    "net10.0": {
                        "project": {
                            "type": "Project",
                            "dependencies": {
                                "LyricBridge.Core": "[0.1.0, )",
                                "External": "[1.0.0, )",
                            },
                        }
                    }
                }
            }
            lock.write_text(json.dumps(data))
            original = ci.digest(root, [Path(props.name), Path(lock.name)], True)
            props.write_text(props.read_text().replace("0.1.0", "0.1.1"))
            lock.write_text(lock.read_text().replace("0.1.0", "0.1.1"))
            self.assertEqual(
                original, ci.digest(root, [Path(props.name), Path(lock.name)], True)
            )
            lock.write_text(lock.read_text().replace("1.0.0", "1.0.1"))
            self.assertNotEqual(
                original, ci.digest(root, [Path(props.name), Path(lock.name)], True)
            )

    def test_upload_retry_accepts_failed_attach_but_never_failed_validation(self):
        run = self.trusted_run()
        run["conclusion"] = "failure"  # attach can fail after complete validation
        receipt = {
            "workflow_sha": "workflow",
            "validated_at": datetime.now(timezone.utc).isoformat(),
        }
        jobs = {
            "jobs": [
                {"name": "artifacts / validate / validate", "conclusion": "success"}
            ]
        }
        with patch.object(ci, "api", side_effect=[run, jobs]):
            ci.verify_run("owner/repo", "100", receipt)
        jobs["jobs"][0]["conclusion"] = "failure"
        with (
            patch.object(ci, "api", side_effect=[run, jobs]),
            self.assertRaisesRegex(ValueError, "aggregate"),
        ):
            ci.verify_run("owner/repo", "100", receipt)

    def test_invalid_run_id_is_rejected_before_external_requests(self):
        with (
            patch.object(ci, "api") as remote,
            self.assertRaisesRegex(ValueError, "numeric"),
        ):
            ci.verify_run("owner/repo", "../other", {})
        remote.assert_not_called()

    def test_old_release_receipt_requires_fresh_advisories(self):
        receipt = {
            "workflow_sha": "workflow",
            "validated_at": (
                datetime.now(timezone.utc) - timedelta(days=2)
            ).isoformat(),
        }
        with (
            patch.object(
                ci,
                "api",
                side_effect=[
                    self.trusted_run(),
                    {"jobs": [{"name": "validate", "conclusion": "success"}]},
                ],
            ),
            self.assertRaisesRegex(ValueError, "24 hours"),
        ):
            ci.verify_run("owner/repo", "100", receipt)


class CumulativeCoverageTests(IsolatedCiTestCase):
    def test_real_git_ancestry_rejects_divergent_force_push_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def command(*args):
                return ci.git(root, "-c", "commit.gpgsign=false", *args)

            command("init", "--quiet")
            command(
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "base",
            )
            ancestor = command("rev-parse", "HEAD")
            command(
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "old tip",
            )
            old_tip = command("rev-parse", "HEAD")
            command("checkout", "--quiet", "-b", "replacement", ancestor)
            command(
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "new tip",
            )
            receipt = self.receipt_fixture()
            receipt["commit"] = old_tip
            with (
                patch.object(ci, "recent_runs", return_value=[self.run_fixture()]),
                patch.object(ci, "read_receipt", return_value=receipt),
            ):
                self.assertEqual(
                    ci.validated_ancestor(root, "owner/repo", "main", "policy"), {}
                )
                receipt["commit"] = ancestor
                self.assertEqual(
                    ci.validated_ancestor(root, "owner/repo", "main", "policy")[
                        "commit"
                    ],
                    ancestor,
                )

    def test_expired_artifact_is_not_downloaded(self):
        run = PolicyTests().trusted_run()
        with patch.object(
            ci,
            "api",
            return_value={
                "artifacts": [
                    {"name": "lyricbridge-validation-receipt", "expired": True}
                ]
            },
        ) as api:
            self.assertIsNone(ci.read_receipt("owner/repo", run))
            self.assertEqual(api.call_count, 1)

    def test_unknown_failed_run_without_receipt_blocks_older_reuse(self):
        run = PolicyTests().trusted_run()
        run["conclusion"] = "failure"
        with (
            patch.object(ci, "recent_runs", return_value=[run]),
            patch.object(ci, "read_receipt", return_value=None),
        ):
            self.assertEqual(
                ci.evidence("owner/repo", {g: g for g in ci.GROUPS}, "policy"), {}
            )

    def run_fixture(self, identifier=100, conclusion="success", branch="main"):
        return {
            "id": identifier,
            "head_branch": branch,
            "conclusion": conclusion,
            "path": ".github/workflows/release-please.yml",
        }

    def receipt_fixture(self, schema=ci.SCHEMA, full=True):
        receipt = {
            "schema": schema,
            "commit": "a" * 40,
            "tree": "tree",
            "policy": "policy",
            "inputs": {g: g for g in ci.GROUPS},
            "full": full,
            "required": list(ci.GROUPS) if full else [],
            "groups": {g: "success" for g in ci.GROUPS} if full else {},
        }
        return receipt

    def test_only_successful_same_branch_ancestors_supply_baselines(self):
        runs = [
            self.run_fixture(104, "cancelled"),
            self.run_fixture(103, "failure"),
            self.run_fixture(102, branch="other"),
            self.run_fixture(101),
            self.run_fixture(),
        ]

        def ancestry(root, *args):
            if args[2] == "b" * 40:
                raise subprocess.CalledProcessError(1, "git")
            return ""

        def receipt(repo, run):
            value = self.receipt_fixture()
            if run["id"] == 101:
                value["commit"] = "b" * 40
            return value

        with (
            patch.object(ci, "recent_runs", return_value=runs),
            patch.object(ci, "read_receipt", side_effect=receipt) as read,
            patch.object(ci, "git", side_effect=ancestry),
        ):
            self.assertEqual(
                ci.validated_ancestor(ROOT, "owner/repo", "main", "policy")["run_id"],
                "100",
            )
            self.assertEqual(read.call_count, 2)

    def test_legacy_full_accepted_but_legacy_narrow_rejected(self):
        for full in (False, True):
            with (
                self.subTest(full=full),
                patch.object(ci, "recent_runs", return_value=[self.run_fixture()]),
                patch.object(
                    ci, "read_receipt", return_value=self.receipt_fixture(1, full)
                ),
                patch.object(ci, "git", return_value=""),
            ):
                self.assertEqual(
                    bool(ci.validated_ancestor(ROOT, "owner/repo", "main", "policy")),
                    full,
                )

    def test_cumulative_identity_and_policy_must_match(self):
        receipt = self.receipt_fixture(full=False)
        receipt["coverage"] = {
            "complete": True,
            "identity": ci.coverage_identity(receipt),
        }
        for invalid in (None, "identity", "policy", "failed"):
            value = copy.deepcopy(receipt)
            if invalid == "identity":
                value["coverage"]["identity"] = "invalid"
            if invalid == "policy":
                value["policy"] = "old"
            if invalid == "failed":
                value["required"] = ["backend"]
                value["groups"] = {"backend": "failure"}
            with (
                self.subTest(invalid=invalid),
                patch.object(ci, "recent_runs", return_value=[self.run_fixture()]),
                patch.object(ci, "read_receipt", return_value=value),
                patch.object(ci, "git", return_value=""),
            ):
                self.assertEqual(
                    bool(ci.validated_ancestor(ROOT, "owner/repo", "main", "policy")),
                    invalid is None,
                )

    def test_missing_or_expired_receipt_cannot_establish_baseline(self):
        with (
            patch.object(ci, "recent_runs", return_value=[self.run_fixture()]),
            patch.object(ci, "read_receipt", return_value=None),
        ):
            self.assertEqual(
                ci.validated_ancestor(ROOT, "owner/repo", "main", "policy"), {}
            )

    def test_lookup_is_bounded_to_three_pages(self):
        with patch.object(
            ci, "api", return_value={"workflow_runs": [self.run_fixture()] * 100}
        ) as api:
            self.assertEqual(len(list(ci.recent_runs("owner/repo"))), 300)
            self.assertEqual(api.call_count, 3)

    def selected(
        self, changes, baseline=True, proofs=None, unavailable=False, event="push"
    ):
        inputs = {g: g for g in ci.GROUPS}
        ancestor = (
            {
                "commit": "a" * 40,
                "run_id": "100",
                "identity": "coverage",
                "inputs": inputs,
            }
            if baseline
            else {}
        )

        def git(root, *args):
            if args[0] == "diff":
                self.assertEqual(
                    args[-2], "a" * 40 if event == "push" and baseline else "previous"
                )
                return "\n".join(changes)
            return "commit"

        with (
            patch.dict(
                os.environ,
                {
                    "GITHUB_EVENT_NAME": event,
                    "GITHUB_REF_NAME": "main",
                    "GITHUB_REPOSITORY": "owner/repo",
                    "GH_TOKEN": "synthetic",
                },
            ),
            patch.object(
                ci,
                "validated_ancestor",
                side_effect=urllib.error.URLError("offline") if unavailable else None,
                return_value=ancestor,
            ),
            patch.object(ci, "fingerprints", return_value=inputs),
            patch.object(ci, "evidence", return_value=proofs or {}),
            patch.object(ci, "git", side_effect=git),
        ):
            return ci.plan(ROOT, "previous", False, False, True, False)

    def test_cancelled_renderer_changes_survive_later_config_or_docs_pushes(self):
        for last in (".editorconfig", "README.md", "frontend/bridge/search-session.ts"):
            result = self.selected(["frontend/renderer/timeline.ts", last])
            self.assertIn("performance", result["execute"])
            self.assertIn("rendering", result["execute"])
            self.assertEqual(result["comparison"]["baseline"]["run_id"], "100")

    def test_failed_backend_and_multiple_cancelled_changes_are_cumulative(self):
        result = self.selected(
            [
                "src/Core/Models.cs",
                "frontend/renderer/timeline.ts",
                "frontend/bridge/search-session.ts",
            ]
        )
        self.assertTrue(
            {"backend", "workflow", "performance"} <= set(result["execute"])
        )

    def test_documentation_after_successful_baseline_skips_checks(self):
        self.assertEqual(self.selected(["README.md"])["execute"], [])

    def test_missing_baseline_or_api_requires_all_but_reuses_passed_groups(self):
        for unavailable in (False, True):
            result = self.selected(
                [],
                baseline=False,
                unavailable=unavailable,
                proofs={g: {"run_id": "100", "input": g} for g in ci.CODE},
            )
            self.assertEqual(set(result["required"]), set(ci.GROUPS))
            self.assertEqual(result["execute"], ["artifacts"])
            self.assertTrue(result["comparison"]["fallback_reason"])

    def test_pr_still_uses_cumulative_merge_base(self):
        result = self.selected(["frontend/renderer/timeline.ts"], event="pull_request")
        self.assertEqual(result["comparison"]["base"], "previous")
        self.assertIn("performance", result["execute"])

    def test_shared_fingerprint_change_requires_group_even_without_path_selection(self):
        original = ci.fingerprints(ROOT)
        baseline = {"commit": "a" * 40, "inputs": dict(original, backend="older")}
        with (
            patch.dict(
                os.environ,
                {
                    "GITHUB_EVENT_NAME": "push",
                    "GITHUB_REF_NAME": "main",
                    "GITHUB_REPOSITORY": "owner/repo",
                    "GH_TOKEN": "synthetic",
                },
            ),
            patch.object(ci, "validated_ancestor", return_value=baseline),
            patch.object(ci, "evidence", return_value={}),
            patch.object(
                ci,
                "git",
                side_effect=lambda root, *args: (
                    "README.md" if args[0] == "diff" else "commit"
                ),
            ),
        ):
            self.assertIn(
                "backend",
                ci.plan(ROOT, "previous", False, False, True, False)["execute"],
            )

    def test_failed_run_passed_groups_reused_but_matching_failures_block(self):
        inputs = {g: g for g in ci.GROUPS}
        runs = [self.run_fixture(101, "failure"), self.run_fixture()]

        def receipt(repo, run):
            return {
                "policy": "policy",
                "inputs": inputs,
                "groups": {
                    g: "failure" if run["id"] == 101 and g == "backend" else "success"
                    for g in ci.CODE
                },
            }

        with (
            patch.object(ci, "recent_runs", return_value=runs),
            patch.object(ci, "read_receipt", side_effect=receipt),
            patch.object(
                ci,
                "api",
                return_value={
                    "jobs": [
                        {"name": name, "status": "completed", "conclusion": "success"}
                        for names in ci.GROUP_JOB_NAMES.values()
                        for name in names
                    ]
                },
            ),
        ):
            proofs = ci.evidence("owner/repo", inputs, "policy")
        self.assertNotIn("backend", proofs)
        self.assertEqual(proofs["frontend"]["run_id"], "101")

    def test_success_extends_coverage_failure_does_not(self):
        selection = self.selected(["README.md"])
        self.assertTrue(ci.finish(ROOT, selection, {})["coverage"]["complete"])
        selection = self.selected(["src/Core/Models.cs"])
        self.assertFalse(ci.finish(ROOT, selection, {})["coverage"]["complete"])


class MetadataTests(IsolatedCiTestCase):
    def test_metadata_only_schedule_does_not_launch_full_runtime_suite(self):
        with (
            patch.object(
                ci, "evidence", return_value={g: {"run_id": "100"} for g in ci.RUNTIME}
            ),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            selection = ci.plan(ROOT, "", False, False, True, True)
        self.assertEqual(selection["execute"], ["metadata"])
        self.assertFalse(selection["full"])

    def test_all_tracked_inputs_are_classified(self):
        ci.check_classification(ROOT, [])

    def test_metadata_selection_does_not_build_web_or_artifacts(self):
        for path in (
            "renovate.json",
            ".github/CODEOWNERS",
            ".github/ISSUE_TEMPLATE/bug.yml",
            ".github/PULL_REQUEST_TEMPLATE.md",
        ):
            with (
                self.subTest(path=path),
                patch.object(
                    ci,
                    "git",
                    side_effect=lambda root, *args: (
                        path if args[0] == "diff" else "commit"
                    ),
                ),
            ):
                selected = ci.plan(ROOT, "base", False, False, False, False)
                self.assertEqual(selected["execute"], ["metadata"])
                self.assertEqual(
                    selected["classified_changes"][0]["rule"], "automation-metadata"
                )

    def test_backend_runner_inputs_invalidate_reused_evidence(self):
        for path in (
            "global.json",
            "tests/StorageTests.csproj",
            "tests/packages.lock.json",
        ):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "Directory.Build.props").write_text(
                    "<LyricBridgeVersion>0.1.1</LyricBridgeVersion>"
                )
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(
                    '{"dependencies": {"net10.0": {}}}'
                    if path.endswith(".json")
                    else "first"
                )
                before = ci.fingerprints(root)
                file.write_text(
                    '{"dependencies": {"net10.0": {}}, "changed": true}'
                    if path.endswith(".json")
                    else "second"
                )
                after = ci.fingerprints(root)
                self.assertNotEqual(before["backend"], after["backend"])

    def test_metadata_fingerprint_isolated_from_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in (
                "renovate.json",
                ".github/CODEOWNERS",
                ".github/ISSUE_TEMPLATE/bug.yml",
            ):
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("first")
                before = ci.fingerprints(root)
                file.write_text("second")
                after = ci.fingerprints(root)
                self.assertNotEqual(before["metadata"], after["metadata"])
                self.assertNotEqual(before["artifacts"], after["artifacts"])
                for group in set(ci.CODE) - {"metadata"}:
                    self.assertEqual(before[group], after[group], (path, group))

    def test_unknown_deleted_and_renamed_paths_cannot_evade_check(self):
        for changed in (
            ["deleted.config"],
            ["old.config", "frontend/renderer/new.ts"],
            ["README.md", "new.config"],
        ):
            with (
                self.subTest(changed=changed),
                self.assertRaisesRegex(ValueError, "config"),
            ):
                ci.check_classification(ROOT, changed)

    def test_unknown_tracked_file_fails_even_with_no_changes(self):
        with (
            patch.object(ci, "tracked_files", return_value=["unknown.config"]),
            self.assertRaisesRegex(ValueError, "unknown.config"),
        ):
            ci.check_classification(ROOT, [])

    def test_new_renderer_and_policy_keep_broad_coverage(self):
        self.assertIn("performance", ci.impacts("frontend/renderer/new.ts"))
        self.assertEqual(ci.impacts("scripts/ci.py"), set(ci.GROUPS))
        self.assertEqual(ci.impacts(".github/actions/setup/action.yml"), set(ci.GROUPS))

    def test_metadata_checks_reject_bad_json_and_codeowners(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "renovate.json").write_text("{broken")
            with self.assertRaises(json.JSONDecodeError):
                ci.metadata_check(root)
            (root / "renovate.json").unlink()
            (root / ".github").mkdir()
            ownerfile = root / ".github/CODEOWNERS"
            ownerfile.write_text("missing/path @owner\n")
            with self.assertRaisesRegex(ValueError, "matches no tracked"):
                ci.metadata_check(root)
            ownerfile.write_text("* invalid-owner\n")
            with self.assertRaisesRegex(ValueError, "invalid pattern or owner"):
                ci.metadata_check(root)

    def test_metadata_and_unfinished_renderer_are_both_required(self):
        with patch.object(
            ci,
            "git",
            side_effect=lambda root, *args: (
                "renovate.json\nfrontend/renderer/runtime.ts"
                if args[0] == "diff"
                else "commit"
            ),
        ):
            selection = ci.plan(ROOT, "base", False, False, False, False)
        self.assertIn("metadata", selection["required"])
        self.assertIn("performance", selection["required"])


class GroupReuseTests(IsolatedCiTestCase):
    def fixture(self, conclusion="cancelled", status="completed"):
        run = dict(
            PolicyTests().trusted_run(),
            conclusion=conclusion,
            status=status,
            run_attempt=1,
        )
        receipt = {
            "policy": "policy",
            "inputs": {g: g for g in ci.CODE},
            "groups": {g: "success" for g in ci.CODE},
        }
        jobs = [
            {
                "name": "validate / " + name,
                "status": "completed",
                "conclusion": "success",
                "run_attempt": 1,
            }
            for names in ci.GROUP_JOB_NAMES.values()
            for name in names
        ]
        return run, receipt, jobs

    def test_completed_groups_reuse_independent_of_parent_outcome(self):
        for conclusion, status in (
            ("success", "completed"),
            ("failure", "completed"),
            ("cancelled", "completed"),
            ("timed_out", "completed"),
            ("neutral", "completed"),
            (None, "in_progress"),
        ):
            run, receipt, jobs = self.fixture(conclusion, status)
            with (
                self.subTest(conclusion=conclusion),
                patch.object(ci, "recent_runs", return_value=[run]),
                patch.object(ci, "read_receipt", return_value=receipt),
                patch.object(ci, "api", return_value={"jobs": jobs}),
            ):
                proofs = ci.evidence("owner/repo", receipt["inputs"], "policy")
                self.assertEqual(set(proofs), set(ci.CODE))

    def test_unfinished_failed_and_wrong_attempt_jobs_are_not_reused(self):
        for state, conclusion, attempt in (
            ("in_progress", None, 1),
            ("completed", "cancelled", 1),
            ("completed", "failure", 1),
            ("completed", "skipped", 1),
            ("completed", "success", 2),
        ):
            run, receipt, jobs = self.fixture()
            backend = next(job for job in jobs if job["name"] == "validate / backend")
            backend.update(status=state, conclusion=conclusion, run_attempt=attempt)
            with (
                self.subTest(conclusion=conclusion, attempt=attempt),
                patch.object(ci, "recent_runs", return_value=[run]),
                patch.object(ci, "read_receipt", return_value=receipt),
                patch.object(ci, "api", return_value={"jobs": jobs}),
            ):
                proofs = ci.evidence("owner/repo", receipt["inputs"], "policy")
                self.assertNotIn("backend", proofs)
                self.assertIn("frontend", proofs)

    def test_matrix_group_requires_every_expected_job(self):
        run, receipt, jobs = self.fixture()
        jobs = [job for job in jobs if job["name"] != "validate / rendering (webkit)"]
        with patch.object(ci, "api", return_value={"jobs": jobs}):
            self.assertIsNone(
                ci.completed_group_origin(
                    "owner/repo", run, receipt, "rendering", "policy", "rendering", {}
                )
            )

    def test_reuse_chain_resolves_to_original_job_and_rejects_cycles(self):
        run, receipt, jobs = self.fixture()
        origin = dict(run, id=99)
        receipt["reused"] = {"backend": {"run_id": "99"}}
        original = dict(receipt, reused={})
        with (
            patch.object(
                ci,
                "api",
                side_effect=lambda repo, endpoint: (
                    origin if endpoint == "/actions/runs/99" else {"jobs": jobs}
                ),
            ),
            patch.object(ci, "read_receipt", return_value=original),
        ):
            self.assertEqual(
                ci.completed_group_origin(
                    "owner/repo", run, receipt, "backend", "policy", "backend", {}
                ),
                "99",
            )
            original["reused"] = {"backend": {"run_id": "99"}}
            self.assertIsNone(
                ci.completed_group_origin(
                    "owner/repo", run, receipt, "backend", "policy", "backend", {}
                )
            )

    def test_expired_missing_or_mismatched_origin_proof_cannot_reuse(self):
        run, receipt, jobs = self.fixture()
        receipt["reused"] = {"backend": {"run_id": "99"}}
        for proof in (
            None,
            dict(receipt, policy="changed"),
            dict(receipt, inputs={"backend": "different"}),
            dict(receipt, groups={"backend": "failure"}),
        ):
            with (
                self.subTest(proof=proof),
                patch.object(ci, "api", return_value=dict(run, id=99)),
                patch.object(ci, "read_receipt", return_value=proof),
            ):
                self.assertIsNone(
                    ci.completed_group_origin(
                        "owner/repo", run, receipt, "backend", "policy", "backend", {}
                    )
                )

    def test_rerun_cannot_use_previous_attempt_receipt(self):
        import io
        import zipfile

        run, receipt, jobs = self.fixture()
        run["run_attempt"] = 2
        receipt.update(
            schema=ci.SCHEMA,
            run_id="100",
            repository="owner/repo",
            run_head_sha="workflow",
            required=list(ci.CODE),
            run_attempt=1,
        )
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("validation.json", json.dumps(receipt))
        with patch.object(
            ci,
            "api",
            side_effect=[
                {
                    "artifacts": [
                        {
                            "name": "lyricbridge-validation-receipt",
                            "expired": False,
                            "id": 1,
                        }
                    ]
                },
                data.getvalue(),
            ],
        ):
            self.assertIsNone(ci.read_receipt("owner/repo", run))

    def test_in_progress_parent_can_supply_an_authenticated_receipt(self):
        import io
        import zipfile

        run, receipt, jobs = self.fixture(None, "in_progress")
        receipt.update(
            schema=ci.SCHEMA,
            run_id="100",
            repository="owner/repo",
            run_head_sha="workflow",
            required=list(ci.CODE),
            run_attempt=1,
        )
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("validation.json", json.dumps(receipt))
        with patch.object(
            ci,
            "api",
            side_effect=[
                {
                    "artifacts": [
                        {
                            "name": "lyricbridge-validation-receipt",
                            "expired": False,
                            "id": 1,
                        }
                    ]
                },
                data.getvalue(),
            ],
        ):
            self.assertIsNotNone(ci.read_receipt("owner/repo", run))


if __name__ == "__main__":
    unittest.main()
