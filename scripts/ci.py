"""Conservative check selection and authenticated, input-bound validation evidence.

Caches never attest tests. GitHub evidence is accepted only from successful trusted
main/release-please and merged same-repository PR runs with matching inputs.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse
import zipfile
from source_inventory import source_files

GROUPS = (
    "frontend",
    "backend",
    "tooling",
    "workflow",
    "rendering",
    "performance",
    "artifacts",
)
CODE = GROUPS[:-1]
SCHEMA = 1
POLICY = ("scripts/ci.py", "scripts/source_inventory.py", "browser-tests/groups.json")


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def impacts(path: str, root: Path | None = None) -> set[str]:
    all_groups = set(GROUPS)
    if path.endswith(".md") or path in {
        "LICENSE",
        "NOTICE",
    }:
        return {"tooling", "artifacts"} if path in {"LICENSE", "NOTICE"} else set()
    if path == ".editorconfig":
        return {"frontend"}
    if path in {".gitignore", ".dockerignore"}:
        return {"tooling", "artifacts"}
    if path in {"version.txt", ".release-please-manifest.json"}:
        return {"artifacts"}
    if path == "Directory.Build.props":
        return {"backend", "frontend", "tooling", "workflow", "rendering", "artifacts"}
    if path.startswith(".github/") or path in POLICY:
        return all_groups
    if path.startswith("frontend/renderer") or path.startswith("frontend/assets/"):
        return {"frontend", "rendering", "performance", "artifacts"}
    if path.startswith("frontend/bridge/"):
        name = Path(path).name.removesuffix(".test.ts").removesuffix(".ts")
        if name in {
            "preferences",
            "generation-state",
            "search-session",
            "search-models",
            "source-usage",
        }:
            return {"frontend", "workflow", "artifacts"}
        if name in {
            "controls",
            "display-panel",
            "search-panel",
            "version-panel",
            "version-rows",
        }:
            return {"frontend", "workflow", "rendering", "artifacts"}
        return {"frontend", "workflow", "rendering", "performance", "artifacts"}
    if path.startswith("frontend/"):
        return {"frontend", "workflow", "rendering", "performance", "artifacts"}
    if path.startswith("browser-tests/"):
        if path.endswith(".spec.cjs"):
            groups = json.loads(
                (
                    (root or Path(__file__).resolve().parent.parent)
                    / "browser-tests/groups.json"
                ).read_text()
            )
            matches = {
                name for name, files in groups.items() if Path(path).name in files
            }
            return (
                (matches | ({"rendering"} if "workflow" in matches else set()))
                if len(matches) == 1
                else all_groups
            )
        return {"frontend", "workflow", "rendering", "performance"}
    if (
        path.startswith("src/")
        or path.startswith("vendor/")
        or path.startswith("tests/")
        and path.endswith((".cs", ".csproj", "lock.json"))
    ):
        result = {"backend", "tooling", "artifacts"}
        if (
            path.startswith("src/Core/")
            or path in {"src/Api.cs", "src/LyricPayload.cs"}
            or "Service.cs" in path
        ):
            result |= {"workflow", "rendering"}
        return result
    if (
        path.startswith("scripts/")
        or path.startswith("tests/")
        and path.endswith((".py", ".sh"))
    ):
        if path.endswith("test-browser.sh"):
            return {"frontend", "workflow", "rendering", "performance"}
        if path.endswith(("bootstrap-references.sh", "reference-cache.py")):
            return {"backend", "tooling", "artifacts"}
        return {"tooling", "artifacts"}
    if path in {"pyproject.toml", "requirements-check.txt"}:
        return {"tooling", "artifacts"}
    if path in {"global.json"}:
        return {"backend", "artifacts"}
    if path in {
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        ".node-version",
    }:
        return {"frontend", "workflow", "rendering", "performance", "artifacts"}
    if path in {
        "knip.json",
        "eslint.config.mjs",
        ".prettierrc.json",
        ".prettierignore",
    }:
        return {"frontend"}
    return all_groups


def browser_inventory(root: Path) -> None:
    groups = json.loads((root / "browser-tests/groups.json").read_text())
    entries = [file for files in groups.values() for file in files]
    actual = {path.name for path in (root / "browser-tests").glob("*.spec.cjs")}
    if (
        set(groups) != {"workflow", "rendering", "performance"}
        or len(entries) != len(set(entries))
        or set(entries) != actual
    ):
        raise ValueError("Every browser spec must belong to exactly one known group")


def digest(root: Path, paths: list[Path], normalize_version: bool = False) -> str:
    value = hashlib.sha256()
    for path in sorted(paths):
        data = (root / path).read_bytes()
        # Only the authoritative release version is non-behavioral. ABI, identity,
        # build options and external dependency versions are never normalized.
        if normalize_version and str(path) == "Directory.Build.props":
            data = re.sub(
                rb"<LyricBridgeVersion>\d+\.\d+\.\d+</LyricBridgeVersion>",
                b"<LyricBridgeVersion>RELEASE</LyricBridgeVersion>",
                data,
            )
        if normalize_version and path.name == "packages.lock.json":
            lock = json.loads(data)
            match = re.search(
                r"<LyricBridgeVersion>(\d+\.\d+\.\d+)</LyricBridgeVersion>",
                (root / "Directory.Build.props").read_text(),
            )
            if not match:
                raise ValueError("Invalid authoritative version")
            for framework in lock["dependencies"].values():
                for dependency in framework.values():
                    if dependency.get("type") == "Project":
                        for name, requested in dependency.get(
                            "dependencies", {}
                        ).items():
                            if (
                                name
                                in {"LyricBridge.Core", "LyricBridge.Infrastructure"}
                                and requested == f"[{match[1]}, )"
                            ):
                                dependency["dependencies"][name] = "[RELEASE, )"
            data = json.dumps(lock, sort_keys=True).encode()
        value.update(str(path).encode() + b"\0" + data + b"\0")
    return value.hexdigest()


def fingerprints(root: Path) -> dict[str, str]:
    files = source_files(root)
    shared = {Path(p) for p in POLICY} | {
        p for p in files if str(p).startswith(".github/")
    }
    shared |= {
        Path(p)
        for p in (
            ".node-version",
            "global.json",
            "pnpm-lock.yaml",
            "requirements-check.txt",
            "Directory.Build.props",
            "scripts/test-browser.sh",
            "scripts/bootstrap-references.sh",
            "scripts/reference-cache.py",
        )
    }
    classified = {path: impacts(str(path), root) for path in files}
    return {
        group: digest(
            root,
            [
                p
                for p in files
                if group == "artifacts" or p in shared or group in classified[p]
            ],
            group != "artifacts",
        )
        for group in GROUPS
    }


def artifact_hashes(root: Path) -> dict[str, str]:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((root / "dist").iterdir())
        if p.suffix == ".zip" or p.name in {"manifest.json", "SHA256SUMS"}
    }


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward the Actions token to the signed artifact-storage origin."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != "https":
            raise ValueError("Artifact redirect must use HTTPS")
        request = super().redirect_request(req, fp, code, msg, headers, newurl)
        if request and urlparse(req.full_url).netloc != urlparse(newurl).netloc:
            request.remove_header("Authorization")
        return request


def api(repository: str, endpoint: str, binary: bool = False):
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
        raise ValueError("Invalid repository identity")
    request = urllib.request.Request(
        "https://api.github.com/repos/" + repository + endpoint,
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.build_opener(SafeRedirect()).open(
        request, timeout=30
    ) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("Evidence response exceeds size limit")
    return data if binary else json.loads(data)


def trusted(run: dict, repository: str) -> bool:
    return (
        (run.get("repository") or {}).get("full_name") == repository
        and (run.get("head_repository") or {}).get("full_name") == repository
        and run.get("event")
        in {"push", "workflow_dispatch", "schedule", "pull_request"}
        and (
            (
                run.get("event") == "pull_request"
                and run.get("path") == ".github/workflows/validate.yml"
            )
            or run.get("head_branch") == "main"
            or str(run.get("head_branch", "")).startswith("release-please--")
            or (
                run.get("event") == "workflow_dispatch"
                and run.get("path") == ".github/workflows/release.yml"
                and re.fullmatch(r"v\d+\.\d+\.\d+", str(run.get("head_branch", "")))
                is not None
            )
        )
    )


def merged_pull_request(run: dict, repository: str) -> bool:
    if run.get("event") != "pull_request":
        return True
    requests = run.get("pull_requests", [])
    if len(requests) != 1:
        return False
    request = api(repository, f"/pulls/{requests[0]['number']}")
    return (
        request.get("merged") is True
        and (request.get("head", {}).get("repo") or {}).get("full_name") == repository
        and request.get("head", {}).get("sha") == run.get("head_sha")
        and (request.get("base", {}).get("repo") or {}).get("full_name") == repository
        and request.get("base", {}).get("ref") == "main"
    )


def read_receipt(repository: str, run: dict) -> dict | None:
    # No cache, fork or caller-controlled URL is an evidence source.
    if (
        not trusted(run, repository)
        or run.get("status") != "completed"
        or not merged_pull_request(run, repository)
    ):
        return None
    artifacts = api(repository, f"/actions/runs/{run['id']}/artifacts?per_page=100")[
        "artifacts"
    ]
    matches = [
        a
        for a in artifacts
        if a["name"] == "lyricbridge-validation-receipt" and not a["expired"]
    ]
    if len(matches) != 1:
        return None
    data = api(repository, f"/actions/artifacts/{matches[0]['id']}/zip", binary=True)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.getinfo("validation.json").file_size > 1_000_000:
            raise ValueError("Receipt exceeds size limit")
        receipt = json.loads(archive.read("validation.json"))
    if (
        receipt.get("schema") != SCHEMA
        or receipt.get("run_id") != str(run["id"])
        or receipt.get("repository") != repository
    ):
        return None
    # head_sha is the orchestrating source; a receipt also records the checked tag.
    if receipt.get("run_head_sha", receipt.get("workflow_sha")) != run.get("head_sha"):
        return None
    return receipt


def evidence(
    repository: str, inputs: dict[str, str], policy: str, full_only: bool = False
) -> dict[str, dict]:
    result = {}
    seen = set()
    runs = api(repository, "/actions/runs?per_page=30")["workflow_runs"]
    for run in runs:  # newest first: a matching failure must block older green reuse
        if run.get("path") not in {
            ".github/workflows/validate.yml",
            ".github/workflows/release-please.yml",
            ".github/workflows/release.yml",
            ".github/workflows/safety.yml",
        }:
            continue
        receipt = read_receipt(repository, run)
        if not receipt:
            if (
                trusted(run, repository)
                and merged_pull_request(run, repository)
                and run.get("conclusion")
                in {
                    "failure",
                    "cancelled",
                    "timed_out",
                }
            ):
                break  # missing failure evidence cannot justify falling back to older green
            continue
        if receipt.get("policy") != policy:
            continue
        baseline = receipt.get("full_baseline", {})
        carried_full = (
            run.get("path") == ".github/workflows/safety.yml"
            and run.get("conclusion") == "success"
            and baseline.get("policy") == policy
            and baseline.get("inputs")
            == {g: receipt.get("inputs", {}).get(g) for g in CODE}
            and set(baseline.get("origins", {})) == set(CODE)
        )
        if full_only and not receipt.get("full") and not carried_full:
            continue
        for group in CODE:
            if group in seen or receipt.get("inputs", {}).get(group) != inputs[group]:
                continue
            status = receipt.get("groups", {}).get(group)
            if status is None and carried_full:
                status = "success"
            if status not in {"success", "failure"}:
                continue
            seen.add(group)
            if status == "success" and (
                run.get("conclusion") == "success"
                or not full_only
                and run.get("conclusion") == "failure"
            ):
                result[group] = {
                    "run_id": baseline["origins"][group]
                    if carried_full
                    else str(run["id"]),
                    "input": inputs[group],
                }
        if all(group in seen for group in CODE):
            break
    return result


def plan(
    root: Path, base: str, full: bool, release: bool, reuse: bool, scheduled: bool
) -> dict:
    browser_inventory(root)
    inputs = fingerprints(root)
    policy = digest(
        root,
        [Path(p) for p in POLICY]
        + [p for p in source_files(root) if str(p).startswith(".github/")],
    )
    changed: list[str] = []
    if base:
        try:
            changed = git(
                root, "diff", "--name-only", "--diff-filter=ACDMRTUXB", base, "HEAD"
            ).splitlines()
        except subprocess.CalledProcessError:
            full = True
    elif not scheduled and not release:
        full = True
    inventory = {str(path) for path in source_files(root)}
    if any(p not in inventory and impacts(p, root) == set(GROUPS) for p in changed):
        full = True  # unclassified external inputs cannot reuse a fingerprint that omits them
    required = (
        set(GROUPS)
        if full or release
        else set().union(*(impacts(p, root) for p in changed))
    )
    proofs: dict[str, dict] = {}
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if reuse and (required or scheduled) and repository and os.environ.get("GH_TOKEN"):
        try:
            proofs = evidence(repository, inputs, policy, scheduled)
        except (
            urllib.error.URLError,
            KeyError,
            ValueError,
            zipfile.BadZipFile,
            OSError,
        ):
            print("Evidence unavailable; required checks will run", file=sys.stderr)
    full_baseline = {}
    if scheduled:
        # All meaningful groups must match a full run, never merely a narrow pass.
        required = set() if all(g in proofs for g in CODE) else set(GROUPS)
        full = bool(required)
        if not required:
            # Carry authenticated input evidence forward across idle schedules.
            # It is code evidence only: no artifact/advisory gate is renewed.
            full_baseline = {
                "policy": policy,
                "inputs": {g: inputs[g] for g in CODE},
                "origins": {g: proofs[g]["run_id"] for g in CODE},
            }
        proofs = {}  # a safety run deliberately tests selector coverage
    elif full:
        proofs = {}  # explicit full always executes
    execute = required - proofs.keys()
    return {
        "schema": SCHEMA,
        "commit": git(root, "rev-parse", "HEAD"),
        "tree": git(root, "rev-parse", "HEAD^{tree}"),
        "workflow_sha": os.environ.get("GITHUB_SHA", git(root, "rev-parse", "HEAD")),
        "repository": repository,
        "run_head_sha": os.environ.get(
            "CI_RUN_HEAD_SHA",
            os.environ.get("GITHUB_SHA", git(root, "rev-parse", "HEAD")),
        ),
        "run_id": os.environ.get("GITHUB_RUN_ID", "local"),
        "policy": policy,
        "inputs": inputs,
        "changed": changed,
        "required": sorted(required),
        "execute": sorted(execute),
        "reused": {g: proofs[g] for g in required if g in proofs},
        "full": full or execute == set(GROUPS),
        "release": release,
        "full_baseline": full_baseline,
    }


def finish(root: Path, selection: dict, jobs: dict) -> dict:
    mapping = {
        "frontend": ("frontend",),
        "backend": ("backend",),
        "tooling": ("tooling",),
        "workflow": ("workflow",),
        "rendering": ("rendering",),
        "performance": ("performance",),
        "artifacts": ("package", "installation", "reproducibility", "advisories"),
    }
    results = {}
    for group in selection["required"]:
        if group in selection["reused"]:
            results[group] = "success"
        else:
            results[group] = (
                "success"
                if all(
                    jobs.get(job, {}).get("result") == "success"
                    for job in mapping[group]
                )
                else "failure"
            )
    receipt = dict(
        selection,
        groups=results,
        validated_at=datetime.now(timezone.utc).isoformat(),
        artifacts=artifact_hashes(root)
        if results.get("artifacts") == "success"
        else {},
    )
    return receipt


def verify(root: Path, receipt: dict, repository: str, run_id: str) -> None:
    if (
        receipt.get("schema") != SCHEMA
        or receipt.get("repository") != repository
        or receipt.get("run_id") != run_id
        or receipt.get("commit") != git(root, "rev-parse", "HEAD")
        or receipt.get("tree") != git(root, "rev-parse", "HEAD^{tree}")
    ):
        raise ValueError(
            "Receipt does not match repository, run and checked release source"
        )
    if not receipt.get("release") or any(
        receipt.get("groups", {}).get(g) != "success" for g in GROUPS
    ):
        raise ValueError("Receipt lacks complete successful release gates")
    if receipt.get("inputs") != fingerprints(root):
        raise ValueError("Validation input fingerprints changed")
    if not receipt.get("artifacts") or receipt["artifacts"] != artifact_hashes(root):
        raise ValueError("Tested artifact hashes do not match")


def verify_run(repository: str, run_id: str, receipt: dict) -> None:
    if not re.fullmatch(r"[0-9]+", run_id):
        raise ValueError("Validation run ID must be numeric")
    run = api(repository, f"/actions/runs/{run_id}")
    current = run_id == os.environ.get("GITHUB_RUN_ID")
    if (
        not trusted(run, repository)
        or run.get("event") == "pull_request"
        or run.get("path")
        not in {
            ".github/workflows/validate.yml",
            ".github/workflows/release.yml",
            ".github/workflows/release-please.yml",
            ".github/workflows/safety.yml",
        }
        or (
            not current
            and (
                run.get("status") != "completed"
                or run.get("conclusion") not in {"success", "failure"}
            )
        )
    ):
        raise ValueError("Validation run is not a trusted completed repository run")
    jobs = api(repository, f"/actions/runs/{run_id}/jobs?per_page=100")["jobs"]
    if not any(
        job["name"].split(" / ")[-1] == "validate"
        and job.get("conclusion") == "success"
        for job in jobs
    ):
        raise ValueError("Run has not completed the aggregate validation gate")
    if receipt.get("run_head_sha", receipt.get("workflow_sha")) != run.get("head_sha"):
        raise ValueError("Receipt does not identify the authenticated workflow source")
    # Upload-only retries remain fast, but old advisory observations are not fresh.
    observed = datetime.fromisoformat(receipt["validated_at"])
    if (datetime.now(timezone.utc) - observed).total_seconds() > 86400:
        raise ValueError(
            "Release evidence is older than 24 hours; rebuild with fresh advisory checks"
        )


def main() -> None:
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument(
        "command", choices=("plan", "finish", "verify", "web-record", "web-verify")
    )
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    parser.add_argument("--base", default="")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--release", action="store_true")
    parser.add_argument("--scheduled", action="store_true")
    parser.add_argument("--reuse", action="store_true")
    parser.add_argument("--run-id", default="")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "plan":
        result = plan(
            root, args.base, args.full, args.release, args.reuse, args.scheduled
        )
        (root / "dist").mkdir(exist_ok=True)
        (root / "dist/plan.json").write_text(json.dumps(result, indent=2) + "\n")
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a") as stream:
                for group in GROUPS:
                    stream.write(f"{group}={str(group in result['execute']).lower()}\n")
                stream.write(
                    "web="
                    + str(
                        bool(
                            set(result["execute"])
                            & {
                                "frontend",
                                "backend",
                                "workflow",
                                "rendering",
                                "performance",
                                "artifacts",
                            }
                        )
                    ).lower()
                    + "\n"
                )
        summary = (
            "Selected: "
            + ", ".join(result["execute"])
            + "\nReused: "
            + ", ".join(result["reused"])
            + "\nNot required: "
            + ", ".join(set(GROUPS) - set(result["required"]))
            + "\n"
        )
        print(summary)
        if output := os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(output, "a") as stream:
                stream.write(
                    "### Validation impact\n\n" + summary.replace("\n", "\n\n")
                )
    elif args.command == "finish":
        result = finish(
            root,
            json.loads((root / "dist/plan.json").read_text()),
            json.loads(os.environ["CI_JOB_RESULTS"]),
        )
        (root / "dist/validation.json").write_text(json.dumps(result, indent=2) + "\n")
        if any(value != "success" for value in result["groups"].values()):
            raise SystemExit("Required validation groups failed")
    elif args.command == "verify":
        receipt = json.loads((root / "dist/validation.json").read_text())
        verify_run(os.environ["GITHUB_REPOSITORY"], args.run_id, receipt)
        verify(root, receipt, os.environ["GITHUB_REPOSITORY"], args.run_id)
    else:
        path = root / "dist/web-build.json"
        current = {
            "input": digest(
                root,
                [
                    p
                    for p in source_files(root)
                    if str(p).startswith("frontend/")
                    or str(p)
                    in {
                        "Directory.Build.props",
                        "package.json",
                        "pnpm-lock.yaml",
                        "pnpm-workspace.yaml",
                        ".node-version",
                    }
                ],
            ),
            "files": {
                p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted((root / "dist/web").glob("*"))
                if p.is_file()
            },
        }
        if args.command == "web-record":
            if not all(
                name in current["files"]
                for name in (
                    "lyricbridge.js",
                    "jellyfin-lyric-motion.js",
                    "config.html",
                    "lyricbridge.css",
                    "jellyfin-lyric-motion.css",
                )
            ):
                raise ValueError("Prepared web assets are incomplete")
            path.write_text(json.dumps(current, indent=2) + "\n")
        elif json.loads(path.read_text()) != current:
            raise ValueError("Prepared frontend inputs or asset hashes changed")


if __name__ == "__main__":
    main()
