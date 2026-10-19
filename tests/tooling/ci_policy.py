"""Deterministic selection, receipt and clean-build safety regressions; no GitHub calls."""

import copy
import json
import os
import runpy
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import scripts.ci.evidence as ci_evidence
import scripts.ci.planning as ci_planning
import scripts.ci.policy as ci_policy
from scripts.common import artifacts as artifact_inputs
from scripts.common.source_inventory import source_files

ROOT = Path(__file__).resolve().parents[2]


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
    def test_previous_archives_do_not_contaminate_current_candidate_proof(self):
        preserve = runpy.run_path(str(ROOT / "scripts/build/clean_package.py"))[
            "preserve_previous_archives"
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "dist"
            output.mkdir()
            current = output / "lyricbridge-0.1.3.zip"
            current.write_bytes(b"current")
            old = output / "lyricbridge-0.1.2.zip"
            old.write_bytes(b"previous")
            (output / "unrelated.txt").write_text("keep")
            preserve(output, {current.name})
            self.assertEqual(set(artifact_inputs.artifact_hashes(root)), {current.name})
            self.assertEqual(current.read_bytes(), b"current")
            self.assertEqual(
                next(output.glob("previous-*/*.zip")).read_bytes(), b"previous"
            )
            self.assertEqual((output / "unrelated.txt").read_text(), "keep")
            preserve(output, {current.name})
            self.assertEqual(len(list(output.glob("previous-*"))), 1)

    def test_added_validation_inputs_select_their_check_groups(self):
        self.assertEqual(set(), ci_policy.impacts("AGENTS.md"))
        self.assertIn("frontend", ci_policy.impacts("frontend/tsconfig.tests.json"))
        self.assertIn("tooling", ci_policy.impacts("pyproject.toml"))
        self.assertEqual(
            set(ci_policy.GROUPS), ci_policy.impacts("scripts/common/images.json")
        )

    def test_validation_configuration_changes_invalidate_reused_evidence(self):
        for path, groups in (
            ("frontend/tsconfig.tests.json", {"frontend"}),
            ("pyproject.toml", {"tooling"}),
            ("scripts/common/images.json", set(ci_policy.GROUPS)),
            (".github/actionlint.yaml", set(ci_policy.GROUPS)),
        ):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("first")
                before = ci_policy.fingerprints(root)
                file.write_text("second")
                after = ci_policy.fingerprints(root)
                for group in groups:
                    self.assertNotEqual(before[group], after[group])

    def test_representative_impacts(self):
        cases = {
            "README.md": set(),
            "version.txt": {"artifacts"},
            ".editorconfig": {"frontend", "backend"},
            "scripts/checks/format-dotnet.sh": {"backend", "tooling", "artifacts"},
            ".dockerignore": {"tooling", "artifacts"},
            "frontend/bridge/search/search-session.ts": {
                "frontend",
                "workflow",
                "artifacts",
            },
            "frontend/bridge/transcription/state.ts": {
                "frontend",
                "workflow",
                "artifacts",
            },
            "src/Host/Transcription/TranscriptionApi.cs": {
                "backend",
                "tooling",
                "artifacts",
                "workflow",
                "rendering",
            },
            "src/Infrastructure/Storage/Store.Jobs.cs": {
                "backend",
                "tooling",
                "artifacts",
                "workflow",
                "rendering",
            },
            "src/Core/Transcription/BoundaryReviewPlanning.cs": {
                "backend",
                "tooling",
                "artifacts",
                "workflow",
                "rendering",
            },
            "src/Host/Transcription/AudioPreparation.cs": {
                "backend",
                "tooling",
                "artifacts",
                "workflow",
                "rendering",
            },
            "frontend/bridge/session/contracts.ts": {
                "frontend",
                "workflow",
                "rendering",
                "performance",
                "artifacts",
            },
            "frontend/renderer/playback/timeline.ts": {
                "frontend",
                "rendering",
                "performance",
                "artifacts",
            },
            "src/Core/Lyrics/Models.cs": {
                "backend",
                "tooling",
                "artifacts",
                "workflow",
                "rendering",
            },
            "src/Host/Web/WebRendererIntegration.cs": {
                "backend",
                "tooling",
                "artifacts",
            },
            "scripts/build/package.sh": {"tooling", "artifacts"},
            # Deletions can remain in the cumulative diff against a validated ancestor.
            "catalog-repository/plugins.json": {"tooling", "artifacts"},
            ".github/workflows/validate.yml": set(ci_policy.GROUPS),
            "renovate.json": {"metadata"},
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.assertEqual(ci_policy.impacts(path), expected)

    def test_browser_inventory_is_complete_and_unique(self):
        ci_policy.browser_inventory(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tests/browser").mkdir(parents=True)
            (root / "tests/browser/groups.json").write_text(
                json.dumps({"workflow": [], "rendering": [], "performance": []})
            )
            (root / "tests/browser/unclassified.spec.cjs").touch()
            with self.assertRaisesRegex(ValueError, "exactly one"):
                ci_policy.browser_inventory(root)

    def test_source_inventory_excludes_generated_and_includes_policy(self):
        paths = {str(p) for p in source_files(ROOT)}
        self.assertIn("scripts/ci/policy.py", paths)
        self.assertIn("docs/explanation/architecture.md", paths)
        self.assertIn("tests/browser/groups.json", paths)
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
            original = artifact_inputs.digest(root, [Path(path.name)], True)
            path.write_text(path.read_text().replace("0.1.0", "0.1.1"))
            self.assertEqual(
                original, artifact_inputs.digest(root, [Path(path.name)], True)
            )
            path.write_text(path.read_text().replace("12.2", "12.3"))
            self.assertNotEqual(
                original, artifact_inputs.digest(root, [Path(path.name)], True)
            )

    def fixture(self) -> dict:
        return {
            "schema": ci_policy.SCHEMA,
            "repository": "owner/repo",
            "run_id": "100",
            "commit": "commit",
            "tree": "tree",
            "release": True,
            "inputs": {g: g for g in ci_policy.GROUPS},
            "required": list(ci_policy.GROUPS),
            "reused": {},
            "groups": {g: "success" for g in ci_policy.GROUPS},
            "artifacts": {"candidate.zip": "hash"},
        }

    def test_receipt_requires_source_every_gate_inputs_and_bytes(self):
        receipt = self.fixture()
        with (
            patch.object(
                ci_policy,
                "git",
                side_effect=lambda root, *args: (
                    "tree" if "HEAD^{tree}" in args else "commit"
                ),
            ),
            patch.object(ci_policy, "fingerprints", return_value=receipt["inputs"]),
            patch.object(
                artifact_inputs, "artifact_hashes", return_value=receipt["artifacts"]
            ),
        ):
            ci_evidence.verify(ROOT, receipt, "owner/repo", "100")
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
                    ci_evidence.verify(ROOT, altered, "owner/repo", "100")
            for group in ci_policy.GROUPS:
                altered = copy.deepcopy(receipt)
                altered["groups"][group] = "skipped"
                with self.subTest(group=group), self.assertRaises(ValueError):
                    ci_evidence.verify(ROOT, altered, "owner/repo", "100")

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
        result = ci_planning.finish(ROOT, selection, jobs)
        self.assertEqual(result["groups"]["artifacts"], "failure")
        self.assertEqual(result["artifacts"], {})

    def test_releases_without_diff_still_can_reuse_code_checks(self):
        with (
            patch.object(ci_policy, "git", return_value="commit"),
            patch.object(
                ci_evidence,
                "evidence",
                return_value={g: {"run_id": "100"} for g in ci_policy.CODE},
            ),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            result = ci_planning.plan(ROOT, "", False, True, True, False)
        self.assertEqual(result["execute"], ["artifacts"])

    def test_idle_scheduled_run_skips_but_changed_inputs_force_full(self):
        with (
            patch.object(ci_policy, "git", return_value="commit"),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            with patch.object(
                ci_evidence,
                "evidence",
                return_value={g: {"run_id": "100"} for g in ci_policy.CODE},
            ):
                self.assertFalse(
                    ci_planning.plan(ROOT, "", False, False, True, True)["execute"]
                )
            with patch.object(ci_evidence, "evidence", return_value={}):
                self.assertEqual(
                    set(
                        ci_planning.plan(ROOT, "", False, False, True, True)["execute"]
                    ),
                    set(ci_policy.GROUPS),
                )

    def test_missing_base_selects_full_and_manual_full_does_not_reuse(self):
        with patch.object(ci_policy, "git", return_value="commit"):
            self.assertEqual(
                set(ci_planning.plan(ROOT, "", False, False, False, False)["execute"]),
                set(ci_policy.GROUPS),
            )
            self.assertFalse(
                ci_planning.plan(ROOT, "", True, False, False, False)["reused"]
            )

    def test_fork_or_unapproved_origin_is_rejected(self):
        run: dict = {
            "repository": {"full_name": "owner/repo"},
            "head_repository": {"full_name": "owner/repo"},
            "event": "push",
            "head_branch": "main",
        }
        self.assertTrue(ci_evidence.trusted(run, "owner/repo"))
        run["head_repository"]["full_name"] = "fork/repo"
        self.assertFalse(ci_evidence.trusted(run, "owner/repo"))

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
        inputs = {g: g for g in ci_policy.GROUPS}

        def receipt(repo, run):
            return {
                "policy": "policy",
                "inputs": inputs,
                "groups": {
                    g: "failure" if run["id"] == 2 else "success"
                    for g in ci_policy.CODE
                },
            }

        with (
            patch.object(ci_evidence, "api", return_value={"workflow_runs": runs}),
            patch.object(ci_evidence, "read_receipt", side_effect=receipt),
        ):
            self.assertEqual(ci_evidence.evidence("owner/repo", inputs, "policy"), {})

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
        inputs = {g: g for g in ci_policy.GROUPS}
        baseline = {
            "policy": "policy",
            "inputs": {g: inputs[g] for g in ci_policy.RUNTIME},
            "origins": {g: "100" for g in ci_policy.RUNTIME},
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
            receipt, groups={g: "success" for g in ci_policy.RUNTIME}, full_baseline={}
        )

        def response(repository, endpoint):
            if endpoint.startswith("/actions/runs?"):
                return {"workflow_runs": [run]}
            if endpoint == "/actions/runs/100":
                return self.trusted_run()
            return {
                "jobs": [
                    {"name": name, "status": "completed", "conclusion": "success"}
                    for names in ci_policy.GROUP_JOB_NAMES.values()
                    for name in names
                ]
            }

        with (
            patch.object(ci_evidence, "api", side_effect=response),
            patch.object(
                ci_evidence,
                "read_receipt",
                side_effect=lambda repo, source: (
                    receipt if source["id"] == 200 else origin_receipt
                ),
            ),
        ):
            proofs = ci_evidence.evidence(
                "owner/repo", inputs, "policy", full_only=True
            )
        self.assertEqual(set(proofs), set(ci_policy.RUNTIME))
        self.assertTrue(all(proof["run_id"] == "100" for proof in proofs.values()))
        self.assertNotIn("artifacts", proofs)
        receipt["full_baseline"] = dict(baseline, policy="changed")
        with (
            patch.object(ci_evidence, "api", return_value={"workflow_runs": [run]}),
            patch.object(ci_evidence, "read_receipt", return_value=receipt),
        ):
            self.assertEqual(
                ci_evidence.evidence("owner/repo", inputs, "policy", full_only=True), {}
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
        self.assertTrue(ci_evidence.trusted(run, "owner/repo"))
        with patch.object(ci_evidence, "api", return_value=request):
            self.assertTrue(ci_evidence.merged_pull_request(run, "owner/repo"))
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
                patch.object(ci_evidence, "api", return_value=altered),
            ):
                self.assertFalse(ci_evidence.merged_pull_request(run, "owner/repo"))

    def test_expired_and_duplicate_receipt_artifacts_are_not_evidence(self):
        run = self.trusted_run()
        for artifacts in (
            [{"name": "lyricbridge-validation-receipt", "expired": True}],
            [{"name": "lyricbridge-validation-receipt", "expired": False}] * 2,
            [],
        ):
            with (
                self.subTest(artifacts=artifacts),
                patch.object(ci_evidence, "api", return_value={"artifacts": artifacts}),
            ):
                self.assertIsNone(ci_evidence.read_receipt("owner/repo", run))

    def test_artifact_redirect_does_not_disclose_actions_token(self):
        request = urllib.request.Request(
            "https://api.github.com/repos/owner/repo/actions/artifacts/1/zip",
            headers={"Authorization": "Bearer synthetic"},
        )
        redirected = ci_evidence.SafeRedirect().redirect_request(
            request, None, 302, "Found", {}, "https://storage.example.invalid/signed"
        )
        self.assertIsNotNone(redirected)
        assert redirected is not None
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(ValueError):
            ci_evidence.SafeRedirect().redirect_request(
                request, None, 302, "Found", {}, "http://storage.example.invalid/signed"
            )

    def test_unavailable_evidence_executes_release_checks(self):
        with (
            patch.object(ci_policy, "git", return_value="commit"),
            patch.object(
                ci_evidence,
                "evidence",
                side_effect=urllib.error.URLError("unavailable"),
            ),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            self.assertEqual(
                set(ci_planning.plan(ROOT, "", False, True, True, False)["execute"]),
                set(ci_policy.GROUPS),
            )

    def test_documentation_only_does_not_query_remote_evidence(self):
        with (
            patch.object(
                ci_policy,
                "git",
                side_effect=lambda root, *args: (
                    "README.md" if args[0] == "diff" else "commit"
                ),
            ),
            patch.object(ci_evidence, "evidence") as remote,
        ):
            self.assertEqual(
                ci_planning.plan(ROOT, "base", False, False, True, False)["execute"], []
            )
            remote.assert_not_called()

    def test_unknown_external_inputs_fail_before_evidence_lookup(self):
        with (
            patch.object(
                ci_policy,
                "git",
                side_effect=lambda root, *args: (
                    "unknown.config" if args[0] == "diff" else "commit"
                ),
            ),
            patch.object(ci_evidence, "evidence") as remote,
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            with self.assertRaisesRegex(ValueError, "unknown.config"):
                ci_planning.plan(ROOT, "base", False, False, True, False)
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
            original = artifact_inputs.digest(
                root, [Path(props.name), Path(lock.name)], True
            )
            props.write_text(props.read_text().replace("0.1.0", "0.1.1"))
            lock.write_text(lock.read_text().replace("0.1.0", "0.1.1"))
            self.assertEqual(
                original,
                artifact_inputs.digest(root, [Path(props.name), Path(lock.name)], True),
            )
            lock.write_text(lock.read_text().replace("1.0.0", "1.0.1"))
            self.assertNotEqual(
                original,
                artifact_inputs.digest(root, [Path(props.name), Path(lock.name)], True),
            )

    def test_upload_retry_accepts_failed_attach_but_never_failed_validation(self):
        run = self.trusted_run()
        run["conclusion"] = "failure"  # attach can fail after complete validation
        receipt = {
            "run_head_sha": "workflow",
            "validated_at": datetime.now(UTC).isoformat(),
        }
        jobs = {
            "jobs": [
                {"name": "artifacts / validate / validate", "conclusion": "success"}
            ]
        }
        with patch.object(ci_evidence, "api", side_effect=[run, jobs]):
            ci_evidence.verify_run("owner/repo", "100", receipt)
        jobs["jobs"][0]["conclusion"] = "failure"
        with (
            patch.object(ci_evidence, "api", side_effect=[run, jobs]),
            self.assertRaisesRegex(ValueError, "aggregate"),
        ):
            ci_evidence.verify_run("owner/repo", "100", receipt)

    def test_invalid_run_id_is_rejected_before_external_requests(self):
        with (
            patch.object(ci_evidence, "api") as remote,
            self.assertRaisesRegex(ValueError, "numeric"),
        ):
            ci_evidence.verify_run("owner/repo", "../other", {})
        remote.assert_not_called()

    def test_old_release_receipt_requires_fresh_advisories(self):
        receipt = {
            "run_head_sha": "workflow",
            "validated_at": (datetime.now(UTC) - timedelta(days=2)).isoformat(),
        }
        with (
            patch.object(
                ci_evidence,
                "api",
                side_effect=[
                    self.trusted_run(),
                    {"jobs": [{"name": "validate", "conclusion": "success"}]},
                ],
            ),
            self.assertRaisesRegex(ValueError, "24 hours"),
        ):
            ci_evidence.verify_run("owner/repo", "100", receipt)


class CumulativeCoverageTests(IsolatedCiTestCase):
    def test_real_git_ancestry_rejects_divergent_force_push_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def command(*args):
                return ci_policy.git(root, "-c", "commit.gpgsign=false", *args)

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
                patch.object(
                    ci_evidence, "recent_runs", return_value=[self.run_fixture()]
                ),
                patch.object(ci_evidence, "read_receipt", return_value=receipt),
            ):
                self.assertEqual(
                    ci_evidence.validated_ancestor(
                        root, "owner/repo", "main", "policy"
                    ),
                    {},
                )
                receipt["commit"] = ancestor
                self.assertEqual(
                    ci_evidence.validated_ancestor(
                        root, "owner/repo", "main", "policy"
                    )["commit"],
                    ancestor,
                )

    def test_expired_artifact_is_not_downloaded(self):
        run = PolicyTests().trusted_run()
        with patch.object(
            ci_evidence,
            "api",
            return_value={
                "artifacts": [
                    {"name": "lyricbridge-validation-receipt", "expired": True}
                ]
            },
        ) as api:
            self.assertIsNone(ci_evidence.read_receipt("owner/repo", run))
            self.assertEqual(api.call_count, 1)

    def test_unknown_failed_run_without_receipt_blocks_older_reuse(self):
        run = PolicyTests().trusted_run()
        run["conclusion"] = "failure"
        with (
            patch.object(ci_evidence, "recent_runs", return_value=[run]),
            patch.object(ci_evidence, "read_receipt", return_value=None),
        ):
            self.assertEqual(
                ci_evidence.evidence(
                    "owner/repo", {g: g for g in ci_policy.GROUPS}, "policy"
                ),
                {},
            )

    def run_fixture(self, identifier=100, conclusion="success", branch="main"):
        return {
            "id": identifier,
            "head_branch": branch,
            "conclusion": conclusion,
            "path": ".github/workflows/release-please.yml",
        }

    def receipt_fixture(self, schema=ci_policy.SCHEMA, full=True):
        receipt = {
            "schema": schema,
            "commit": "a" * 40,
            "tree": "tree",
            "policy": "policy",
            "inputs": {g: g for g in ci_policy.GROUPS},
            "full": full,
            "required": list(ci_policy.GROUPS) if full else [],
            "groups": {g: "success" for g in ci_policy.GROUPS} if full else {},
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
            patch.object(ci_evidence, "recent_runs", return_value=runs),
            patch.object(ci_evidence, "read_receipt", side_effect=receipt) as read,
            patch.object(ci_policy, "git", side_effect=ancestry),
        ):
            self.assertEqual(
                ci_evidence.validated_ancestor(ROOT, "owner/repo", "main", "policy")[
                    "run_id"
                ],
                "100",
            )
            self.assertEqual(read.call_count, 2)

    def test_unsupported_schemas_are_rejected_for_full_and_narrow_receipts(self):
        for full in (False, True):
            with (
                self.subTest(full=full),
                patch.object(
                    ci_evidence, "recent_runs", return_value=[self.run_fixture()]
                ),
                patch.object(
                    ci_evidence,
                    "read_receipt",
                    return_value=self.receipt_fixture(1, full),
                ),
                patch.object(ci_policy, "git", return_value=""),
            ):
                self.assertEqual(
                    bool(
                        ci_evidence.validated_ancestor(
                            ROOT, "owner/repo", "main", "policy"
                        )
                    ),
                    False,
                )

    def test_cumulative_identity_and_policy_must_match(self):
        receipt = self.receipt_fixture(full=False)
        receipt["coverage"] = {
            "complete": True,
            "identity": ci_evidence.coverage_identity(receipt),
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
                patch.object(
                    ci_evidence, "recent_runs", return_value=[self.run_fixture()]
                ),
                patch.object(ci_evidence, "read_receipt", return_value=value),
                patch.object(ci_policy, "git", return_value=""),
            ):
                self.assertEqual(
                    bool(
                        ci_evidence.validated_ancestor(
                            ROOT, "owner/repo", "main", "policy"
                        )
                    ),
                    invalid is None,
                )

    def test_missing_or_expired_receipt_cannot_establish_baseline(self):
        with (
            patch.object(ci_evidence, "recent_runs", return_value=[self.run_fixture()]),
            patch.object(ci_evidence, "read_receipt", return_value=None),
        ):
            self.assertEqual(
                ci_evidence.validated_ancestor(ROOT, "owner/repo", "main", "policy"), {}
            )

    def test_lookup_is_bounded_to_three_pages(self):
        with patch.object(
            ci_evidence,
            "api",
            return_value={"workflow_runs": [self.run_fixture()] * 100},
        ) as api:
            self.assertEqual(len(list(ci_evidence.recent_runs("owner/repo"))), 300)
            self.assertEqual(api.call_count, 3)

    def selected(
        self, changes, baseline=True, proofs=None, unavailable=False, event="push"
    ):
        inputs = {g: g for g in ci_policy.GROUPS}
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
                ci_evidence,
                "validated_ancestor",
                side_effect=urllib.error.URLError("offline") if unavailable else None,
                return_value=ancestor,
            ),
            patch.object(ci_policy, "fingerprints", return_value=inputs),
            patch.object(ci_evidence, "evidence", return_value=proofs or {}),
            patch.object(ci_policy, "git", side_effect=git),
        ):
            return ci_planning.plan(ROOT, "previous", False, False, True, False)

    def test_cancelled_renderer_changes_survive_later_config_or_docs_pushes(self):
        for last in (
            ".editorconfig",
            "README.md",
            "frontend/bridge/search/search-session.ts",
        ):
            result = self.selected(["frontend/renderer/playback/timeline.ts", last])
            self.assertIn("performance", result["execute"])
            self.assertIn("rendering", result["execute"])
            self.assertEqual(result["comparison"]["baseline"]["run_id"], "100")

    def test_failed_backend_and_multiple_cancelled_changes_are_cumulative(self):
        result = self.selected(
            [
                "src/Core/Lyrics/Models.cs",
                "frontend/renderer/playback/timeline.ts",
                "frontend/bridge/search/search-session.ts",
            ]
        )
        self.assertTrue(
            {"backend", "workflow", "performance"} <= set(result["execute"])
        )

    def test_documentation_after_successful_baseline_skips_checks(self):
        self.assertEqual(
            self.selected(["README.md", "docs/how-to/configure.md", "docs/SETUP.md"])[
                "execute"
            ],
            [],
        )

    def test_missing_baseline_or_api_requires_all_but_reuses_passed_groups(self):
        for unavailable in (False, True):
            result = self.selected(
                [],
                baseline=False,
                unavailable=unavailable,
                proofs={g: {"run_id": "100", "input": g} for g in ci_policy.CODE},
            )
            self.assertEqual(set(result["required"]), set(ci_policy.GROUPS))
            self.assertEqual(result["execute"], ["artifacts"])
            self.assertTrue(result["comparison"]["fallback_reason"])

    def test_pr_still_uses_cumulative_merge_base(self):
        result = self.selected(
            ["frontend/renderer/playback/timeline.ts"], event="pull_request"
        )
        self.assertEqual(result["comparison"]["base"], "previous")
        self.assertIn("performance", result["execute"])

    def test_shared_fingerprint_change_requires_group_even_without_path_selection(self):
        original = ci_policy.fingerprints(ROOT)
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
            patch.object(ci_evidence, "validated_ancestor", return_value=baseline),
            patch.object(ci_evidence, "evidence", return_value={}),
            patch.object(
                ci_policy,
                "git",
                side_effect=lambda root, *args: (
                    "README.md" if args[0] == "diff" else "commit"
                ),
            ),
        ):
            self.assertIn(
                "backend",
                ci_planning.plan(ROOT, "previous", False, False, True, False)[
                    "execute"
                ],
            )

    def test_failed_run_passed_groups_reused_but_matching_failures_block(self):
        inputs = {g: g for g in ci_policy.GROUPS}
        runs = [self.run_fixture(101, "failure"), self.run_fixture()]

        def receipt(repo, run):
            return {
                "policy": "policy",
                "inputs": inputs,
                "groups": {
                    g: "failure" if run["id"] == 101 and g == "backend" else "success"
                    for g in ci_policy.CODE
                },
            }

        with (
            patch.object(ci_evidence, "recent_runs", return_value=runs),
            patch.object(ci_evidence, "read_receipt", side_effect=receipt),
            patch.object(
                ci_evidence,
                "api",
                return_value={
                    "jobs": [
                        {"name": name, "status": "completed", "conclusion": "success"}
                        for names in ci_policy.GROUP_JOB_NAMES.values()
                        for name in names
                    ]
                },
            ),
        ):
            proofs = ci_evidence.evidence("owner/repo", inputs, "policy")
        self.assertNotIn("backend", proofs)
        self.assertEqual(proofs["frontend"]["run_id"], "101")

    def test_success_extends_coverage_failure_does_not(self):
        selection = self.selected(["README.md"])
        self.assertTrue(ci_planning.finish(ROOT, selection, {})["coverage"]["complete"])
        selection = self.selected(["src/Core/Lyrics/Models.cs"])
        self.assertFalse(
            ci_planning.finish(ROOT, selection, {})["coverage"]["complete"]
        )


class MetadataTests(IsolatedCiTestCase):
    def test_metadata_only_schedule_does_not_launch_full_runtime_suite(self):
        with (
            patch.object(
                ci_evidence,
                "evidence",
                return_value={g: {"run_id": "100"} for g in ci_policy.RUNTIME},
            ),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            selection = ci_planning.plan(ROOT, "", False, False, True, True)
        self.assertEqual(selection["execute"], ["metadata"])
        self.assertFalse(selection["full"])

    def test_all_tracked_inputs_are_classified(self):
        ci_policy.check_classification(ROOT, [])

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
                    ci_policy,
                    "git",
                    side_effect=lambda root, *args, path=path: (
                        path if args[0] == "diff" else "commit"
                    ),
                ),
            ):
                selected = ci_planning.plan(ROOT, "base", False, False, False, False)
                self.assertEqual(selected["execute"], ["metadata"])
                self.assertEqual(
                    selected["classified_changes"][0]["rule"], "automation-metadata"
                )

    def test_every_ci_module_invalidates_policy_and_group_fingerprints(self):
        for path in (
            "scripts/ci/__main__.py",
            "scripts/ci/policy.py",
            "scripts/ci/evidence.py",
            "scripts/ci/planning.py",
        ):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                file = root / path
                file.parent.mkdir(parents=True)
                file.write_text("first")
                before = ci_policy.fingerprints(root)
                policy_before = artifact_inputs.digest(root, [Path(path)])
                file.write_text("second")
                after = ci_policy.fingerprints(root)
                self.assertIn(path, ci_policy.POLICY)
                self.assertEqual(ci_policy.impacts(path), set(ci_policy.GROUPS))
                self.assertNotEqual(
                    policy_before, artifact_inputs.digest(root, [Path(path)])
                )
                for group in ci_policy.GROUPS:
                    self.assertNotEqual(before[group], after[group], (path, group))

    def test_web_receipt_cli_preserves_fields_and_rejects_changed_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "dist/web"
            assets.mkdir(parents=True)
            for name in (
                "lyricbridge.js",
                "jellyfin-lyric-motion.js",
                "config.html",
                "lyricbridge.css",
                "jellyfin-lyric-motion.css",
            ):
                (assets / name).write_text("fixture")
            command = [sys.executable, "-m", "scripts.ci", "--root", str(root)]
            subprocess.run([*command, "web-record"], check=True, capture_output=True)
            receipt = json.loads((root / "dist/web-build.json").read_text())
            self.assertEqual(set(receipt), {"input", "files"})
            self.assertEqual(receipt, artifact_inputs.web_inputs(root))
            subprocess.run([*command, "web-verify"], check=True, capture_output=True)
            (assets / "lyricbridge.js").write_text("changed")
            result = subprocess.run(
                [*command, "web-verify"], check=False, capture_output=True, text=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "Prepared frontend inputs or asset hashes changed", result.stderr
            )

    def test_backend_runner_inputs_invalidate_reused_evidence(self):
        for path in (
            "global.json",
            "tests/backend/Host/LyricBridge.Host.Tests.csproj",
            "tests/backend/Host/packages.lock.json",
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
                before = ci_policy.fingerprints(root)
                file.write_text(
                    '{"dependencies": {"net10.0": {}}, "changed": true}'
                    if path.endswith(".json")
                    else "second"
                )
                after = ci_policy.fingerprints(root)
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
                before = ci_policy.fingerprints(root)
                file.write_text("second")
                after = ci_policy.fingerprints(root)
                self.assertNotEqual(before["metadata"], after["metadata"])
                self.assertNotEqual(before["artifacts"], after["artifacts"])
                for group in set(ci_policy.CODE) - {"metadata"}:
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
                ci_policy.check_classification(ROOT, changed)

    def test_unknown_tracked_file_fails_even_with_no_changes(self):
        with (
            patch.object(ci_policy, "tracked_files", return_value=["unknown.config"]),
            self.assertRaisesRegex(ValueError, "unknown.config"),
        ):
            ci_policy.check_classification(ROOT, [])

    def test_new_renderer_and_policy_keep_broad_coverage(self):
        self.assertIn("performance", ci_policy.impacts("frontend/renderer/new.ts"))
        self.assertEqual(
            ci_policy.impacts("scripts/ci/policy.py"), set(ci_policy.GROUPS)
        )
        self.assertEqual(
            ci_policy.impacts(".github/actions/setup/action.yml"), set(ci_policy.GROUPS)
        )

    def test_metadata_checks_reject_bad_json_and_codeowners(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "renovate.json").write_text("{broken")
            with self.assertRaises(json.JSONDecodeError):
                ci_policy.metadata_check(root)
            (root / "renovate.json").unlink()
            (root / ".github").mkdir()
            ownerfile = root / ".github/CODEOWNERS"
            ownerfile.write_text("missing/path @owner\n")
            with self.assertRaisesRegex(ValueError, "matches no tracked"):
                ci_policy.metadata_check(root)
            ownerfile.write_text("* invalid-owner\n")
            with self.assertRaisesRegex(ValueError, "invalid pattern or owner"):
                ci_policy.metadata_check(root)

    def test_metadata_and_unfinished_renderer_are_both_required(self):
        with patch.object(
            ci_policy,
            "git",
            side_effect=lambda root, *args: (
                "renovate.json\nfrontend/renderer/runtime.ts"
                if args[0] == "diff"
                else "commit"
            ),
        ):
            selection = ci_planning.plan(ROOT, "base", False, False, False, False)
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
            "inputs": {g: g for g in ci_policy.CODE},
            "groups": {g: "success" for g in ci_policy.CODE},
        }
        jobs = [
            {
                "name": "validate / " + name,
                "status": "completed",
                "conclusion": "success",
                "run_attempt": 1,
            }
            for names in ci_policy.GROUP_JOB_NAMES.values()
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
                patch.object(ci_evidence, "recent_runs", return_value=[run]),
                patch.object(ci_evidence, "read_receipt", return_value=receipt),
                patch.object(ci_evidence, "api", return_value={"jobs": jobs}),
            ):
                proofs = ci_evidence.evidence("owner/repo", receipt["inputs"], "policy")
                self.assertEqual(set(proofs), set(ci_policy.CODE))

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
                patch.object(ci_evidence, "recent_runs", return_value=[run]),
                patch.object(ci_evidence, "read_receipt", return_value=receipt),
                patch.object(ci_evidence, "api", return_value={"jobs": jobs}),
            ):
                proofs = ci_evidence.evidence("owner/repo", receipt["inputs"], "policy")
                self.assertNotIn("backend", proofs)
                self.assertIn("frontend", proofs)

    def test_matrix_group_requires_every_expected_job(self):
        run, receipt, jobs = self.fixture()
        jobs = [job for job in jobs if job["name"] != "validate / rendering (webkit)"]
        with patch.object(ci_evidence, "api", return_value={"jobs": jobs}):
            self.assertIsNone(
                ci_evidence.completed_group_origin(
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
                ci_evidence,
                "api",
                side_effect=lambda repo, endpoint: (
                    origin if endpoint == "/actions/runs/99" else {"jobs": jobs}
                ),
            ),
            patch.object(ci_evidence, "read_receipt", return_value=original),
        ):
            self.assertEqual(
                ci_evidence.completed_group_origin(
                    "owner/repo", run, receipt, "backend", "policy", "backend", {}
                ),
                "99",
            )
            original["reused"] = {"backend": {"run_id": "99"}}
            self.assertIsNone(
                ci_evidence.completed_group_origin(
                    "owner/repo", run, receipt, "backend", "policy", "backend", {}
                )
            )

    def test_expired_missing_or_mismatched_origin_proof_cannot_reuse(self):
        run, receipt, _jobs = self.fixture()
        receipt["reused"] = {"backend": {"run_id": "99"}}
        for proof in (
            None,
            dict(receipt, policy="changed"),
            dict(receipt, inputs={"backend": "different"}),
            dict(receipt, groups={"backend": "failure"}),
        ):
            with (
                self.subTest(proof=proof),
                patch.object(ci_evidence, "api", return_value=dict(run, id=99)),
                patch.object(ci_evidence, "read_receipt", return_value=proof),
            ):
                self.assertIsNone(
                    ci_evidence.completed_group_origin(
                        "owner/repo", run, receipt, "backend", "policy", "backend", {}
                    )
                )

    def test_rerun_cannot_use_previous_attempt_receipt(self):
        import io
        import zipfile

        run, receipt, _jobs = self.fixture()
        run["run_attempt"] = 2
        receipt.update(
            schema=ci_policy.SCHEMA,
            run_id="100",
            repository="owner/repo",
            run_head_sha="workflow",
            required=list(ci_policy.CODE),
            run_attempt=1,
        )
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("validation.json", json.dumps(receipt))
        with patch.object(
            ci_evidence,
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
            self.assertIsNone(ci_evidence.read_receipt("owner/repo", run))

    def test_in_progress_parent_can_supply_an_authenticated_receipt(self):
        import io
        import zipfile

        run, receipt, _jobs = self.fixture(None, "in_progress")
        receipt.update(
            schema=ci_policy.SCHEMA,
            run_id="100",
            repository="owner/repo",
            run_head_sha="workflow",
            required=list(ci_policy.CODE),
            run_attempt=1,
        )
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("validation.json", json.dumps(receipt))
        with patch.object(
            ci_evidence,
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
            self.assertIsNotNone(ci_evidence.read_receipt("owner/repo", run))


if __name__ == "__main__":
    unittest.main()
