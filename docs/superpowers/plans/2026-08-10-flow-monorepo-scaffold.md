# Flow Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an isolated Git repository containing a Bun workspace monorepo ready for implementation of the Flow, Layer, Worker, Signal, and engine-adapter architecture.

**Architecture:** Keep engine-neutral contracts and execution semantics in `@flow/core`; isolate local and durable engine adapters in separate packages; provide a dedicated type-test package and executable examples. Shared TypeScript, Biome, Husky, and Bun scripts live at the repository root.

**Tech Stack:** TypeScript 5.x, Bun 1.3+, Bun workspaces, Bun test, Biome 2.4, Husky 9, ts-pattern 5.x.

---

### Task 1: Initialize repository and root workspace

**Files:**
- Create: `flow/package.json`
- Create: `flow/tsconfig.json`
- Create: `flow/tsconfig.base.json`
- Create: `flow/.gitignore`
- Create: `flow/README.md`
- Create: `flow/AGENTS.md`

- [ ] Create the `flow/` directory and initialize Git with `main` as the initial branch.
- [ ] Add the Bun workspace root manifest and strict shared TypeScript configuration.
- [ ] Add repository documentation and contribution instructions.

### Task 2: Add repository quality tooling

**Files:**
- Create: `flow/biome.jsonc`
- Create: `flow/.husky/pre-commit`
- Create: `flow/.vscode/extensions.json`
- Create: `flow/.vscode/settings.json`

- [ ] Install root development dependencies with Bun.
- [ ] Configure Biome as formatter, linter, and import organizer.
- [ ] Configure Husky to run a non-mutating Biome check before commits.
- [ ] Configure VS Code for the monorepo Biome extension.

### Task 3: Create workspace package boundaries

**Files:**
- Create package manifests and source/test directories under `flow/packages/`.
- Create example manifests and source directories under `flow/examples/`.

- [ ] Create `@flow/core` for Flow, Layer, Worker interfaces, errors, signals, and engine-neutral types.
- [ ] Create `@flow/engine-local` for in-process execution.
- [ ] Create `@flow/engine-openworkflow` for the first durable adapter.
- [ ] Create `@flow/testing` for deterministic test helpers and compile-time fixtures.
- [ ] Create `examples/basic` and `examples/code-agent` consumers.

### Task 4: Preserve design artifacts

**Files:**
- Move: `docs/superpowers/specs/2026-08-10-flow-library-design-v1.md` → `flow/docs/superpowers/specs/2026-08-10-flow-library-design-v1.md`
- Move: `docs/superpowers/plans/2026-08-10-flow-monorepo-scaffold.md` → `flow/docs/superpowers/plans/2026-08-10-flow-monorepo-scaffold.md`

- [ ] Preserve the approved conservative-contract design as the immutable v1 baseline.
- [ ] Keep the scaffold plan beside future versioned design variants.

### Task 5: Validate scaffold

- [ ] Run `bun install` and confirm the lockfile is generated.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun test`.
- [ ] Run `bun run lint`.
- [ ] Run `git diff --check`.
- [ ] Inspect workspace discovery and repository status.
