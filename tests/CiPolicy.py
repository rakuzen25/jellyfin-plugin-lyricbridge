"""Deterministic selection, receipt and clean-build safety regressions; no GitHub calls."""

import copy
from datetime import datetime, timedelta, timezone
import json
import os
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


class PolicyTests(unittest.TestCase):
    def test_representative_impacts(self):
        cases = {
            "README.md": set(),
            "version.txt": {"artifacts"},
            ".editorconfig": {"frontend"},
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
            "unclassified.config": set(ci.GROUPS),
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
            "inputs": {g: inputs[g] for g in ci.CODE},
            "origins": {g: "100" for g in ci.CODE},
        }
        run = dict(self.trusted_run(), id=200, path=".github/workflows/safety.yml")
        receipt = {
            "policy": "policy",
            "inputs": inputs,
            "full": False,
            "groups": {},
            "full_baseline": baseline,
        }
        with (
            patch.object(ci, "api", return_value={"workflow_runs": [run]}),
            patch.object(ci, "read_receipt", return_value=receipt),
        ):
            proofs = ci.evidence("owner/repo", inputs, "policy", full_only=True)
        self.assertEqual(set(proofs), set(ci.CODE))
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

    def test_unknown_external_inputs_force_full_without_reuse(self):
        with (
            patch.object(
                ci,
                "git",
                side_effect=lambda root, *args: (
                    "unknown.config" if args[0] == "diff" else "commit"
                ),
            ),
            patch.object(ci, "evidence", return_value={g: {} for g in ci.CODE}),
            patch.dict(
                os.environ, {"GITHUB_REPOSITORY": "owner/repo", "GH_TOKEN": "synthetic"}
            ),
        ):
            self.assertEqual(
                set(ci.plan(ROOT, "base", False, False, True, False)["execute"]),
                set(ci.GROUPS),
            )

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


if __name__ == "__main__":
    unittest.main()
