# Flow Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the engine-neutral `@flow/core` package with class-based Flow contracts, immutable Layers, typed failures, structural signals, pattern matching, Engine interfaces, Workers, and run handles.

**Architecture:** A `Flow<Spec>` subclass is both the runtime contract class and the constructor for immutable Flow implementations. A `Layer` assigns stable names to implementations, composes nested Layers, and accumulates structurally provided dependencies. A `Worker` resolves a root entry from a Layer and delegates execution to an `Engine`; matching and signal behavior remain defined in core so every engine shares one interface.

**Tech Stack:** TypeScript 5.9, Bun test, ts-pattern 5.x, Biome.

---

## File map

- `flow/contract.ts`: `Flow` base class and constructor overloads.
- `flow/implementation.ts`: immutable implementation records and runtime guards.
- `flow/failure.ts`: private typed-failure signal and helpers.
- `flow/types.ts`: Flow specs, extraction utilities, handlers, calls, effective requirements/errors/signals.
- `layer/layer.ts`: immutable Layer with stable ID, entries, nested Layers, `.provide`, and `.override`.
- `layer/provide.ts`: provider merge and conflict helpers.
- `layer/composition.ts`: flattening, lookup, namespacing, and facade creation.
- `layer/types.ts`: Layer entry/provider/facade type utilities.
- `signal/types.ts`: structural request/response declarations and effective handler types.
- `signal/namespace.ts`: nested signal namespace and durable path helpers.
- `signal/handler.ts`: hierarchical signal-handler lookup and propagation.
- `matching/types.ts`: supported pattern, matched-error, recovery, and remaining-error utilities.
- `matching/builder.ts`: immutable `.with(...)` builder and execution memoization.
- `engine/types.ts`: engine execution request/result/status/options contracts.
- `engine/execution-context.ts`: engine-neutral Flow execution context passed through nested calls.
- `engine/engine.ts`: Engine interface and runtime type guard.
- `worker/types.ts`: Worker and run option extraction types.
- `worker/run.ts`: FlowRun handle with `.with`, status, cancellation, and valid/poisoned `then`.
- `worker/worker.ts`: Worker lookup, validation, run creation, and Engine delegation.
- `index.ts`: curated public exports.

### Task 1: Flow contracts and failures

- [ ] Write failing runtime and compile-time tests for subclass construction, multiple implementations, typed handler arguments, success, and `fail`.
- [ ] Implement `Flow`, `FlowImplementation`, Flow type utilities, and the private typed-failure signal.
- [ ] Run focused tests and typecheck until green.

### Task 2: Immutable Layers

- [ ] Write failing tests for `new Layer(id, entries)`, nested Layers, stable flow IDs, `.provide`, `.override`, immutability, and duplicate/conflict diagnostics.
- [ ] Implement Layer types, provider operations, flattening, lookup, and callable facades.
- [ ] Run focused tests and typecheck until green.

### Task 3: Signals and matching

- [ ] Write failing tests for structural signal handlers, namespaced lookup, `undefined` propagation, literal/object `.with`, async recoveries, and first-match behavior.
- [ ] Implement signal utilities and immutable matching builders using public `ts-pattern` matching.
- [ ] Run focused tests and typecheck until green.

### Task 4: Engine and Worker interfaces

- [ ] Write a fake Engine in tests and failing tests for Worker delegation, root lookup, run IDs, signal forwarding, status, cancel, exhaustive results, and unhandled typed failures.
- [ ] Implement engine contracts, execution context, Worker, and FlowRun.
- [ ] Run focused tests and typecheck until green.

### Task 5: Public surface and verification

- [ ] Replace the placeholder barrel with curated exports.
- [ ] Add a compile-only API fixture demonstrating Flow, Layer, Worker, signals, and matching.
- [ ] Run `bun test packages/core`, `bun run --filter @flow/core typecheck`, `bun run lint`, `bun run build`, and `git diff --check`.
