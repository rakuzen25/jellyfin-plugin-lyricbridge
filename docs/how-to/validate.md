# Validate a change

After [toolchain setup](develop.md#prepare-the-toolchain), run checks for the boundary your change affects.
Run commands from the repository root. CI's [evidence and reuse model](../explanation/validation.md) explains how local checks relate to release acceptance.

## Check source and documentation

For maintained source and tooling, run:

```sh
pnpm check
pnpm test
pnpm build
```

All commands must exit successfully. A successful build creates the assets used by browser fixtures.
For frontend changes alone, `pnpm check frontend` runs lint, formatting, unused-code, and strict type checks for application code and tests.
For prose and link changes alone, run `pnpm check docs` for Markdown formatting and local links; review the text against the reader's task as well.
The link checker cannot establish accuracy or writing quality.

Use `pnpm check frontend`, `pnpm check backend`, or `pnpm check tooling` for targeted checks. Each verifies formatting; `pnpm format` applies formatting across maintained languages and Markdown.
Use `pnpm format docs` for root Markdown and `docs/`. Vendored notices and the generated changelog retain their own formatting; changelog links are still checked.
`pnpm check tooling` also checks TOML formatting and GitHub workflows with the pinned actionlint Docker image, including ShellCheck.
Workflow linting requires Docker; the repository mount is read-only and the container runs without network access.
`pnpm test` runs frontend, backend, and tooling unit tests. Use a target to run one boundary, for example `pnpm test backend`. Backend runs reject accidental zero-test executions.
Browser, installation, and reproducibility acceptance are explicit tasks.

## Exercise browser workflows and rendering

After building, use the pinned offline browser image for acceptance:

```sh
CI_BROWSER_GROUP=workflow pnpm test browser --project workflow-chromium --workers=2
CI_BROWSER_GROUP=rendering pnpm test browser --workers=2
```

Workflow checks exercise actions and asynchronous results; rendering checks cover the browser/viewport matrix.
Inspect the owned `tests/browser/results-run.*` directory on failure. Preserve reviewed screenshot baselines unless a visual change is intentional and reviewed.

For native browser debugging, install browsers and run from the current workspace:

```sh
pnpm --dir tests/browser exec playwright install --with-deps chromium firefox webkit
pnpm --dir tests/browser exec playwright test --list
```

The listing confirms discovery. Remove `--list` to run locally; native results do not replace pinned-image acceptance.

## Verify distributable artifacts

For packaging, dependency, installer, or release changes, build and inspect a clean candidate:

```sh
pnpm build
python3 -m tests.tooling.package_artifacts
pnpm test reproducibility
pnpm test installation
```

These checks inspect archives, rebuild independently, and install into a disposable official server.
Successful local acceptance does not publish anything or validate live provider credentials.
Retain logs with the exact artifacts under review. Do not use old archives as evidence for new source.

## Next steps

[Measure playback](measure-performance.md) for rendering performance changes or [publish a verified release](release.md).
