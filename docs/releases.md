# Releases

## Public changes

For every user-facing change to `brickflow`, run:

```sh
bun run changeset
```

Select `brickflow`, choose the appropriate semantic version increment, and describe the change. Documentation, tests, and private-only refactors may omit a changeset when they do not affect the published package.

## Automated releases from `main`

After changes reach `main`, `release.yml` creates or updates a version pull request. Merge that pull request to publish the generated future version. Do not manually edit package versions.

## One-time 0.0.1 bootstrap

npm Trusted Publishing requires the npm package to exist before it can be configured. After the repository change is merged and CI passes, an authorized maintainer must run:

```sh
npm login
npm whoami
bun install --frozen-lockfile
bun run validate
cd packages/core
npm publish
```

Before publishing, verify all of the following:

- The active npm account is the intended account.
- `npm view brickflow version` still returns 404.
- The package manifest is exactly `brickflow@0.0.1`.
- Do not publish `0.0.0`, use `--force`, or store any npm credential in the repository or GitHub.

## Configure npm Trusted Publishing

Immediately after publishing `0.0.1`, configure the npm trusted publisher with these exact settings:

- Provider: GitHub Actions
- Owner: `yanncabral`
- Repository: `flow`
- Workflow: `release.yml`
- Environment: unset
- Allowed action: `npm publish`

## Publishing after bootstrap

Subsequent releases use GitHub Actions OIDC and npm provenance. Do not configure an `NPM_TOKEN`. Trusted-publisher identity or workflow mismatches fail safely instead of falling back to a stored credential.

## Unreleased: Brick plugins + durable OpenWorkflow worker + OTel tracing

User-facing behavior (add changesets for `brickflow` plus the new packages before merge to `main`):

- `brickflow`: new `BrickPlugin` contract with per-brick lifecycle hooks (`onStart`, `onSuccess`, `onFailure` for typed domain failures, `onDefect` for unexpected throws, `onSignal`, `onFinally`). Plugins wire via run options or `brick<Contract>({ plugins }, handler)`; replay defaults to `skip` (opt in with `emit`); throwing hooks are best-effort and never break execution. `EngineExecutionRequest` gains a late-bound per-brick `step` runner; durable step names are `brickflow/<node path>` (`toDurableStepName`, `DURABLE_STEP_PREFIX`).
- `@brickflow/engine-openworkflow` (new): `OpenWorkflowWorker` with sqlite (default in-memory) and postgres backends, workflow `brickflow/brick-run`, idempotency key `brickflow-run:<id>`, per-brick steps with fail-fast retry default, typed failures preserved as envelope data, defects rehydrated to the original error.
- `@brickflow/plugin-otel` (new): `createTracingPlugin(tracer)` — one span per Brick, `signal.<name>` events, `brick.failure`/`brick.defect` outcomes, replay-safe by default; zero-dependency core plus opt-in `@brickflow/plugin-otel/otel-adapter` for real OpenTelemetry tracers.
- `examples/tracing-basic` (new): end-to-end Layer-bound tracing example against the real plugin.

Durable/replay compatibility: checkpoint-skipped steps re-resolve from persisted checkpoints and emit no plugin events; step names are deterministic in `(nodeId, callId)`, so graphs replay against the same checkpoints across restarts. Param/result snippets recorded by the tracing plugin are truncated JSON — redact PII before export.
