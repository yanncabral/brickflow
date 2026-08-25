You are an experienced, pragmatic software engineering AI agent. Do not over-engineer a solution when a simple one is possible. Keep edits minimal. If you want an exception to ANY rule, you MUST stop and get permission first.

# Project Overview

Brick is an experimental TypeScript library for typed domain failures, structural dependency injection, composable Layers, Signals, and engine-neutral execution. Core currently implements local execution through the Worker contract. Durable adapters are planned, with OpenWorkflow targeted first, while core must remain independent enough for future Temporal or Inngest adapters.

Technology: TypeScript, Bun workspaces, Bun test, Biome, Husky, and ts-pattern. The repository is ESM-only.

# Required Context

Read `docs/architecture/agent-context.md` before changing public API, graph resolution, Layers, providers, Signals, Workers, failures, or durable identity. It defines current behavior. `docs/superpowers/specs/` records design history.

# Reference

- `packages/core/`: Brick, Layer, Worker contract, default local Worker, Signal, failure, and engine-neutral interfaces. It must not import a durable adapter.
- `packages/engine-openworkflow/`: placeholder for the planned OpenWorkflow durable adapter; no Worker or serialization implementation exists yet.
- `packages/testing/`: placeholder; current core runtime tests and all type-tests live under `packages/core/`.
- `examples/basic/`: executable API usage.
- `examples/code-agent/`: placeholder for a future durable coding-agent example.
- `docs/architecture/agent-context.md`: current operational architecture.
- `docs/superpowers/specs/`: versioned historical designs. Do not silently rewrite older variants.
- `docs/superpowers/plans/`: implementation plans.

Typed domain failures remain distinct from unexpected defects. Future durable adapters must preserve structured failures as data rather than relying on generic exception serialization.

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

- Develop behavior test-first. Run the focused runtime test or type-test and observe failure before implementation.
- Keep public types in focused files; avoid one large barrel containing implementation logic.
- A Brick interface is type-only; `brick<F>(handler)` creates a frozen executable implementation without tokens or requirement metadata.
- Direct runs supply dependencies as explicit recursive `{ brick, dependencies? }` nodes; `dependencies` is required when the selected Brick still has unresolved children. Layer-bound runs supply only unresolved branches, so a Layer-resolved node may be `{ dependencies: ... }` without `brick`. Bare Brick values are invalid.
- Layer-bound aliases resolve caller-local first, then unique-global, then supplied fallback for missing or ambiguous aliases.
- Signals mirror the selected dependency graph. Direct-run root signals are top-level; Layer-bound own signals use the full durable Brick path. Supplied dependency signals use recursive alias paths; Layer-resolved signals use durable Layer paths.
- `.provide()` adds absent effective requirements. `.override()` replaces existing effective providers. Both are immutable.
- Path segments are non-empty strings without `.`. Symbols and numeric graph keys are invalid.
- Core owns the Worker contract and default local Worker. Future durable adapters must implement core interfaces; core must never branch on an adapter name.
- Typed failures propagate separately from unexpected defects.

# Anti-patterns

- Do not use generators or EffectTS APIs in the public Brick API.
- Do not collapse typed failures into untyped `Error` values across durable boundaries.
- Do not hide non-deterministic durable side effects without a documented checkpoint strategy.
- Do not add service-token boilerplate unless a reviewed design explicitly requires it.
- Do not mutate Layers or Workers during composition.

# Code Style

Biome is the only formatter, linter, and import organizer. Use strict TypeScript and avoid `any`; isolate unavoidable engine interop behind narrow adapter types.

# Commit and Pull Request Guidelines

Use conventional commits such as `feat: add brick contract types` or `test: cover signal propagation`. Before committing, run `bun run typecheck`, `bun test`, `bun run lint`, and `git diff --check`. Do not open a pull request unless explicitly requested. PR descriptions must summarize behavior, list validation commands, and call out any durable replay or compatibility implications.
