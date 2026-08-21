# Direct Flow Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Flow directly executable, expose Layer-bound Flow views as `layer.flow.run(...)`, default execution to an in-core local Worker, and remove the standalone local-engine package.

**Architecture:** Extract the current Worker orchestration into a shared graph execution module that can execute either an explicit Layer graph or a direct anonymous graph assembled from flattened dependency aliases. Add a Worker execution contract plus in-core local implementation, then attach immutable run methods to direct and Layer-bound Flow views. Preserve the existing `FlowRun` recovery, signal, cancellation, provider, and durable-path behavior.

**Tech Stack:** TypeScript 5.9, Bun workspaces/tests, ts-pattern, Biome.

---

## File structure

- `packages/core/src/worker/contract.ts`: Worker execution contract and default-worker selection.
- `packages/core/src/worker/local-worker.ts`: current-event-loop Worker implementation and local run errors.
- `packages/core/src/worker/execution.ts`: graph construction, dependency resolution, execution context, and run creation shared by direct and Layer-bound calls.
- `packages/core/src/flow/types.ts`: direct-run configuration, flattened dependency/requirement types, and executable Flow implementation shape.
- `packages/core/src/flow/contract.ts`: attach direct `.run` to immutable implementations.
- `packages/core/src/layer/types.ts`: represent entries as bound executable views and calculate unresolved configuration.
- `packages/core/src/layer/layer.ts`: create immutable bound views for direct and nested Layer properties.
- `packages/core/src/index.ts`: export the new public Worker API and local errors.
- `packages/core/test/direct-run.test.ts`: runtime behavior for direct and Layer-bound execution.
- `packages/core/type-tests/direct-run.ts`: required/optional run configuration and incompatibility checks.
- `examples/basic/src/index.ts`: demonstrate `layer.flow.run(...)`.
- `examples/basic/package.json`, `tsconfig.json`, `bun.lock`: remove the local-engine workspace dependency/reference.
- Remove `packages/engine-local/` after equivalent core coverage exists.

### Task 1: Define executable Flow and Worker contracts

**Files:**
- Create: `packages/core/src/worker/contract.ts`
- Modify: `packages/core/src/flow/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/type-tests/direct-run.ts`

- [ ] **Step 1: Write failing type tests**

Add contracts covering these calls:

```ts
const plain = flow<PlainFlow>(async ({ value }) => value)
plain.run({ value: 1 })

configured.run(
  { id: 'ada' },
  {
    requirements: { repository },
    dependencies: { child }
  }
)

// @ts-expect-error missing required direct configuration
configured.run({ id: 'ada' })
```

Also assert that a custom `Worker` can be supplied and that incompatible/missing dependency aliases fail.

- [ ] **Step 2: Verify the type tests fail**

Run: `bun run --cwd packages/core typecheck`
Expected: failures because `FlowImplementation` has no `run` and `Worker` is not the new execution contract.

- [ ] **Step 3: Add the public types**

Define a Worker contract that accepts an `EngineExecutionRequest` and returns an `EngineExecutionHandle`. Add flattened effective dependency types, direct `requirements`/`dependencies`/`signals` configuration, optional controls, and a conditional run-options tuple. Extend `FlowImplementation<F>` with:

```ts
run(
  params: ParamsOf<F>,
  ...options: FlowRunOptionArgs<F>
): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>>
```

Avoid runtime imports from the type-only files.

- [ ] **Step 4: Verify type tests compile**

Run: `bun run --cwd packages/core typecheck`
Expected: PASS for the new declarations and expected compile-time failures.

### Task 2: Move local execution into core

**Files:**
- Create: `packages/core/src/worker/local-worker.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/direct-run.test.ts`

- [ ] **Step 1: Write failing local Worker tests**

Cover queued/running/completed/failed/cancelled states, duplicate explicit IDs, typed result preservation, unexpected rejection, and signal delegation using the Worker contract directly.

- [ ] **Step 2: Verify focused tests fail**

Run: `bun test packages/core/test/direct-run.test.ts`
Expected: FAIL because the core default local Worker does not exist.

- [ ] **Step 3: Implement the local Worker**

Move the behavior of `LocalEngine` and `LocalRun` into focused core classes implementing the new Worker contract. Keep `queueMicrotask`, cooperative cancellation, and duplicate-ID tracking. Export the default local Worker singleton/factory and `DuplicateLocalRunIdError`/`LocalRunCancelledError` from core.

- [ ] **Step 4: Verify focused tests pass**

Run: `bun test packages/core/test/direct-run.test.ts`
Expected: local Worker tests PASS.

### Task 3: Implement shared direct graph execution

**Files:**
- Create: `packages/core/src/worker/execution.ts`
- Modify: `packages/core/src/flow/contract.ts`
- Modify: `packages/core/src/worker/worker.ts`
- Test: `packages/core/test/direct-run.test.ts`

- [ ] **Step 1: Write failing direct-run runtime tests**

Cover:

```ts
await plain.run({ value: 1 })
await configured.run(params, {
  requirements: { repository },
  dependencies: { child, grandchild }
})
```

Assert flattened alias resolution, dependency failure propagation, `.with(...)`, signals, custom Worker selection, generated/explicit IDs, and defects.

- [ ] **Step 2: Verify focused tests fail**

Run: `bun test packages/core/test/direct-run.test.ts`
Expected: FAIL because `.run` is not attached or direct graph resolution is absent.

- [ ] **Step 3: Implement shared execution**

Create one executor that receives a root entry, provider map, dependency resolver, boundary signals, identity, metadata, and Worker. Reuse it from the legacy Worker wrapper and from direct Flow `.run`. Build direct entries from the root plus the flattened `dependencies` option and resolve aliases exactly once; reject absent or ambiguous runtime aliases defensively.

Attach `.run` when `flow()` constructs an implementation, freeze the final implementation, and use the core local Worker when no custom Worker is supplied.

- [ ] **Step 4: Verify direct tests pass**

Run: `bun test packages/core/test/direct-run.test.ts packages/core/test/worker.test.ts`
Expected: PASS with unchanged recovery behavior.

### Task 4: Implement Layer-bound executable views

**Files:**
- Modify: `packages/core/src/layer/types.ts`
- Modify: `packages/core/src/layer/layer.ts`
- Modify: `packages/core/src/layer/composition.ts`
- Test: `packages/core/test/direct-run.test.ts`
- Test: `packages/core/type-tests/direct-run.ts`

- [ ] **Step 1: Write failing bound-view tests**

Cover `users.getUser.run(...)`, nested `app.users.getUser.run(...)`, partial `.provide(...)`, one implementation bound to different Layers, durable IDs observed by a custom Worker, and immutability of the original implementation.

- [ ] **Step 2: Verify tests fail**

Run: `bun test packages/core/test/direct-run.test.ts && bun run --cwd packages/core typecheck`
Expected: FAIL because Layer properties expose unbound implementations.

- [ ] **Step 3: Create bound views**

When constructing a Layer, expose each Flow property as a frozen wrapper carrying the original handler and a `.run` bound to the complete root Layer/path. Expose nested Layer properties as bound nested views so navigation retains the outer path. Ensure `.provide()` and `.override()` create fresh views with new effective providers while never mutating original Flows or Layers.

Calculate run options from effective requirements/dependencies/signals minus what the bound Layer resolves. Keep runtime Layer flattening based on the underlying implementation identity rather than wrapper identity.

- [ ] **Step 4: Verify bound-view tests pass**

Run: `bun test packages/core/test/direct-run.test.ts packages/core/test/layer.test.ts packages/core/test/worker.test.ts && bun run --cwd packages/core typecheck`
Expected: PASS.

### Task 5: Migrate examples and remove engine-local

**Files:**
- Modify: `examples/basic/src/index.ts`
- Modify: `examples/basic/package.json`
- Modify: `tsconfig.json`
- Modify: `bun.lock`
- Remove: `packages/engine-local/**`
- Test: `examples/basic/test/basic.test.ts`

- [ ] **Step 1: Migrate the example**

Replace explicit `Worker`/`LocalEngine` construction with:

```ts
const users = new Layer('users', { getUser, getGreeting, approveGreeting }).provide({
  userRepository
})

const success = await users.getGreeting
  .run({ id: 'ada' })
  .with('user-not-found', recoverGreeting)
```

Keep the signal example using namespaced boundary handlers required by the bound Flow type.

- [ ] **Step 2: Remove workspace references**

Delete `packages/engine-local`, remove its TypeScript project reference and example dependency, then run `bun install` to update `bun.lock`.

- [ ] **Step 3: Verify package migration**

Run: `bun test examples/basic/test/basic.test.ts && bun run typecheck`
Expected: PASS and no `@flow/engine-local` references.

### Task 6: Full compatibility and quality validation

**Files:**
- Modify tests or implementation only when a validation command reveals a regression.

- [ ] **Step 1: Search for obsolete APIs**

Run: `grep -R "@flow/engine-local\|new LocalEngine\|new Worker" --exclude-dir=node_modules --exclude-dir=.git .`
Expected: no production/example usage; historical design documents may retain old snippets.

- [ ] **Step 2: Run all validation**

Run:

```bash
bun run typecheck
bun test
bun run lint
bun run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Review the public API**

Confirm the final exported surface supports direct `flow.run`, nested `layer.flow.run`, custom Workers, local defaults, typed configuration, signals, and exhaustive failure recovery without importing a concrete durable adapter.
