You are an experienced, pragmatic software engineering AI agent. Do not over-engineer a solution when a simple one is possible. Keep edits minimal. If you want an exception to ANY rule, you MUST stop and get permission first.

# Project Overview

Flow is an experimental TypeScript library for typed domain failures, structural dependency injection, composable Layers, Signals, and engine-neutral local or durable execution. The first durable adapter targets OpenWorkflow, while the core API must remain independent enough for future Temporal or Inngest adapters.

Technology: TypeScript, Bun workspaces, Bun test, Biome, Husky, and ts-pattern. The repository is ESM-only.

# Reference

- `packages/core/`: Flow, Layer, Worker, Signal, error, and engine interfaces. It must not import a concrete engine.
- `packages/engine-local/`: in-process execution adapter.
- `packages/engine-openworkflow/`: OpenWorkflow adapter and serialization boundaries.
- `packages/testing/`: deterministic helpers and type-test fixtures.
- `examples/`: executable consumers; do not place library implementation here.
- `docs/superpowers/specs/`: versioned design variants. Do not silently rewrite an older variant when exploring a new design.
- `docs/superpowers/plans/`: implementation plans.

The architecture separates engine-neutral contracts from engine adapters. Typed domain failures must remain distinct from unexpected defects. Durable adapters must preserve structured errors as data rather than relying on an engine's generic exception serializer.

# Essential Commands

```bash
bun install          # install all workspace dependencies
bun run typecheck    # type-check every workspace
bun test             # run all Bun tests
bun run lint         # run Biome without modifying files
bun run lint:fix     # apply safe Biome fixes
bun run format       # format the repository
bun run build        # build publishable packages
bun run clean        # remove generated output
```

# Patterns

- Develop behavior test-first. Run the focused test and observe the expected failure before implementation.
- Keep public types in focused files; avoid one large barrel containing implementation logic.
- A Flow class is a runtime contract and its instances are implementations.
- A Layer chooses Flow implementations and receives structural dependencies through immutable `.provide(...)` calls.
- Engine adapters implement core interfaces; core never branches on a concrete engine name.
- Signals are request/response entries declared structurally on a Flow and namespace transitively through Flow/Layer paths.

# Anti-patterns

- Do not use generators or EffectTS APIs in the public Flow API.
- Do not collapse typed failures into untyped `Error` values across durable boundaries.
- Do not hide non-deterministic durable side effects without a documented checkpoint strategy.
- Do not add service-token boilerplate unless a reviewed design explicitly requires it.
- Do not mutate Layers or Workers during composition.

# Code Style

Biome is the only formatter, linter, and import organizer. Use strict TypeScript and avoid `any`; isolate unavoidable engine interop behind narrow adapter types.

# Commit and Pull Request Guidelines

Use conventional commits such as `feat: add flow contract types` or `test: cover signal propagation`. Before committing, run `bun run typecheck`, `bun test`, `bun run lint`, and `git diff --check`. Do not open a pull request unless explicitly requested. PR descriptions must summarize behavior, list validation commands, and call out any durable replay or compatibility implications.
