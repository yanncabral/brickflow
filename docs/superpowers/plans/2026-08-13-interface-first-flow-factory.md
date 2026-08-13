# Interface-First Flow Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace class-based runtime Flow contracts with structural Flow interfaces and the `flow<F>(handler)` factory while preserving execution, failure, matching, signals, Layer, Worker, and LocalEngine behavior.

**Architecture:** `Flow` becomes a type-only interface with defaults supplied by extraction utilities. `flow()` returns a branded immutable implementation containing only its handler. Layer composition keeps durable entry paths and resolves dependency aliases structurally by public entry key in the caller's Layer scope, while runtime handlers receive the complete effective provider environment because direct requirement keys no longer exist at runtime.

**Tech Stack:** TypeScript 5.9, Bun 1.3, Bun test, Biome, ts-pattern.

---

### Task 1: Establish failing interface-first API fixtures

**Files:**
- Modify: `packages/core/type-tests/flow.ts`
- Modify: `packages/core/test/flow.test.ts`
- Modify: `packages/core/test/worker.test.ts`

- [x] Add compile-time examples for `interface X extends Flow`, omitted defaults, inferred handler arguments, alternate implementations, and rejected params/results/errors.
- [x] Add runtime tests for `flow()` success/failure and dependency alias lookup, including nested, missing, and ambiguous entries.
- [x] Run focused tests and `bun run --filter @flow/core typecheck`; confirm failures reference missing factory/interface behavior.

### Task 2: Replace Flow class contracts with structural types and factory

**Files:**
- Modify: `packages/core/src/flow/contract.ts`
- Modify: `packages/core/src/flow/types.ts`
- Modify: `packages/core/src/flow/implementation.ts`
- Modify: `packages/core/src/index.ts`

- [x] Define exported base `Flow` interface and default-aware property extractors.
- [x] Define `FlowHandler<F>`, `FlowImplementation<F>`, dependency calls, effective errors/requirements/signals, and execution results over structural Flow interfaces.
- [x] Implement `flow<F>(handler)` as a branded immutable implementation without contract, dependency, or requirement runtime metadata.
- [x] Run focused Flow tests and typecheck until green.

### Task 3: Migrate Layer and Worker structural resolution

**Files:**
- Modify: `packages/core/src/layer/types.ts`
- Modify: `packages/core/src/layer/composition.ts`
- Modify: `packages/core/src/worker/types.ts`
- Modify: `packages/core/src/worker/worker.ts`
- Modify dependent core engine/signal/matching types as required.

- [x] Change Layer type utilities to extract requirements from `FlowImplementation<F>`.
- [x] Resolve each declared dependency alias by public entry key in the caller's relevant Layer scope; retain clear missing/ambiguous diagnostics.
- [x] Pass the complete effective provider environment to handlers and remove runtime provider-key validation/projection.
- [x] Preserve child signal handlers, durable paths, failure propagation, matching, cancellation, and Worker/FlowRun types.
- [x] Run core runtime tests and typecheck until green.

### Task 4: Migrate all consumers and regressions

**Files:**
- Modify: `packages/core/test/**/*.ts`
- Modify: `packages/core/type-tests/**/*.ts`
- Modify: `packages/engine-local/test/local-engine.test.ts`
- Modify: `examples/basic/src/index.ts`
- Modify: `examples/basic/test/basic.test.ts`

- [x] Replace Flow spec aliases/classes/constructors with interfaces and `flow()` calls.
- [x] Preserve existing assertions for Layer immutability, signals, matching, FlowRun, LocalEngine, cancellation, and typed failures.
- [x] Run `bun test` and `bun run typecheck` until green.

### Task 5: Update public documentation and verify

**Files:**
- Modify: `README.md`
- Modify: `examples/basic/README.md`
- Modify: `AGENTS.md`

- [x] Document interface-first syntax, structural dependency aliases, durable rename implications, and static-only missing-provider validation.
- [x] Remove obsolete public exports and class/token terminology.
- [x] Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, and `git diff --check`.
- [x] Create conventional commits, push current feature branch, and open a PR to `main` whose description includes `Fixes #1` and validation evidence.
