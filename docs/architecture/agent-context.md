# Brick: Agent Context

Current behavior. Read after `AGENTS.md`. Specs are history.

## Model

| Term | Role |
|---|---|
| Brick | Typed executable contract |
| Layer | Immutable Brick group and reusable configuration |
| Worker | Execution mechanism |
| Signal | Request/response call during execution |
| Failure | Declared domain outcome |
| Defect | Unexpected thrown error |

## Implementation status

- `packages/core` is published as `brickflow` and implements direct and Layer-bound execution with the default local Worker.
- `@brickflow/engine-openworkflow` is a placeholder; no durable Worker or serialization exists.
- `@brickflow/testing` and `examples/code-agent` are placeholders.
- Core runtime tests and all type-tests live under `packages/core/`; basic example runtime test lives under `examples/basic/test/`.

## Brick

```ts
type UseCase = Brick<{
  params: Input
  result: Output
  errors: DomainFailure
  requires: Requirements
  depends: { child: ChildBrick }
  signals: {
    approve: { request: Request; response: Response }
  }
}>

const useCase = brick<UseCase>(handler)
```

`Brick<{ ... }>` provides autocomplete for `params`, `result`, `errors`, `requires`, `depends`, and `signals`. `params` and `result` are required. The other fields are optional and default respectively to `never`, an empty requirements object, an empty dependencies object, and an empty signals object.

Rules:

- A named Brick contract is a reusable, erased TypeScript type; multiple implementations may share it.
- `brick<Contract>(handler)` returns a frozen callable implementation. `implementation(params, options)` and `implementation.run(params, options)` share the same execution entry point.
- No tokens or runtime requirement metadata.
- Typed direct runs and Layer composition require missing providers statically. Runtime does not prevalidate provider keys because implementations carry no requirement metadata.

## Validated domain types

Core is schema-neutral: it imports no schema library and does not automatically parse or validate Brick inputs or outputs. Validate unknown data at application, transport, persistence, queue, or other untrusted boundaries, infer the schema library's validated output type, and use that branded, refined, transformed, or otherwise narrowed type directly in `Brick<{ ... }>`.

Validated values may pass through the trusted Brick graph without repeated validation. Revalidate whenever data crosses a runtime boundary that invalidates type trust. In particular, brands are erased TypeScript information and must not be assumed to survive persistence, messaging, or a future durable serialization boundary without validation on the receiving side. Zod, TypeBox, ArkType, and Standard Schema-compatible libraries may be used through their output inference; the inferred type depends on the library and schema, and Brick does not provide or require a shared brand type.

## Execution

### Direct

```ts
await parent.run(params, {
  requirements: { repository },
  dependencies: {
    child: {
      brick: child,
      dependencies: {
        repositoryWorker: { brick: repositoryWorker }
      }
    }
  },
  signals: {
    child: { approve: handleApproval }
  },
  worker,
  id,
  metadata
})
```

Dependency nodes are always explicit:

```ts
dependencies: { child: { brick: child } }
```

Bare Brick values are invalid. Direct runs require recursive `dependencies` for every selected Brick child. Layer-bound runs supply only unresolved branches; a Layer-resolved node may contain `dependencies` without repeating `brick`.

### Layer-bound

```ts
const users = new Layer('users', {
  getUser,
  getGreeting
}).provide({ repository })

await users.getGreeting.run({ id: 'ada' })
```

Nested path defines durable identity:

```ts
await app.users.getUser.run({ id })
// brickId: app.users.getUser
```

Nested Layer entry keys organize access. Durable paths use nested Layer `id`, then Brick entry key.

Bound runs require only unresolved configuration. Bound Bricks are also callable: `users.getGreeting({ id: 'ada' })` is equivalent to `users.getGreeting.run({ id: 'ada' })`, preserving provider and dependency resolution, signal paths, execution controls, and durable identity.

## Dependency resolution

Layer-bound order:

1. caller Layer scope;
2. unique global entry;
3. supplied node for missing or ambiguous alias;
4. error.

Branches are independent:

```text
primary.repository
secondary.repository
```

Same alias in different branches is valid. Incompatible contract at same path is a type error.

Depth limit: 16. Fallback is conservative; required configuration never disappears.

## Providers

| API | Meaning |
|---|---|
| `.provide()` | Add requirement absent from effective graph |
| `.override()` | Replace provider present in effective graph |
| `.providers` | Providers owned by this Layer |
| effective providers | Owned + nested; outer value wins |

```ts
const users = new Layer('users', { getUser }).provide({ repository })
const app = new Layer('app', { users })

app.provide({ repository: memory }) // type error: already provided
const testApp = app.override({ repository: memory }) // valid
```

Rules:

- Operations return new frozen Layers.
- Outer override may replace nested provider.
- Originals remain unchanged.
- Requirements include transitive Bricks and nested Layers.
- Conflicting nested providers need outer override or composition change.

## Signals

Signal tree mirrors selected dependency graph.

```ts
signals: {
  approve: rootHandler,
  primary: {
    approve: primaryHandler,
    repository: { refresh: refreshHandler }
  },
  secondary: { approve: secondaryHandler }
}
```

Rules:

- Direct-run root signals are top-level.
- Layer-bound own signals use full durable Brick path.
- Supplied dependency signals use recursive alias paths.
- Layer-resolved dependency signals use absolute durable Layer paths.
- Only selected branches require handlers.
- No final-name fallback.
- Call-local handler overrides boundary handler for immediate callee signal.

## Worker

```ts
interface Worker {
  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure>
}
```

Core exports `Worker`, `LocalWorker`, and default `localWorker`. Core uses standard ECMAScript and Web APIs, including `crypto.randomUUID()` for generated execution IDs and `queueMicrotask` for local scheduling. It has no Node built-in imports and can be bundled for browsers and Cloudflare Workers without Node compatibility flags.

Local Worker:

- current process/event loop; `queueMicrotask` scheduling;
- queued, running, completed, failed, cancelled status;
- signals unless run was cancelled;
- immediate cancellation rejection; running work is not interrupted;
- permanent ID reservation for lifetime of Worker instance;
- no CPU isolation or preemptive cancellation.

Brick execution forwards ID, optional metadata, and optional Layer-bound `brickId` through `EngineExecutionRequest`; Local Worker does not interpret metadata. Durable Workers belong in adapter packages, but none exists yet. Direct execution omits `brickId`; Layer-bound execution uses full path.

## Failures

| Case | Behavior |
|---|---|
| `fail(error)` | Typed domain failure |
| Dependency failure | Automatic propagation |
| `.onSuccess(handler)` | Transforms only the original Brick success; supports async and `undefined` results |
| `.onError(pattern, handler)` | Typed recovery; `undefined` leaves failure unhandled |
| `.with(pattern, handler)` | Alias for `.onError(pattern, handler)` |
| `.onFailure(pattern, handler)` | Deprecated compatibility alias for `.onError(pattern, handler)` |
| Unhandled typed failure | Not `PromiseLike` until exhausted; forced consumption rejects with `UnhandledBrickFailureError` |
| Unexpected `throw` | Rejected defect |
| Worker boundary | `{ ok: false, error }`; future durable adapters must preserve structured data |

`onSuccess` receives the original Brick result regardless of its position relative to failure handlers. Recovery results bypass `onSuccess`. Awaiting yields the union of success and recovery results; consumers can return discriminated values to distinguish the branches. Success and recovery types are tracked separately even when their shapes overlap. Chains are immutable and consumption is memoized per chain. A later `onSuccess` replaces an earlier success handler rather than composing transformations. Failure handlers retain registration order and first-match behavior. Handler exceptions remain defects.

Inside a Brick handler, a required function returning a `BrickRun` can be awaited directly when its remaining failures are included in the enclosing Brick's declared `errors`:

```ts
type ImportRequest = Brick<{
  params: ImportInput
  result: ImportResult
  errors: ImportFailure
  requires: { importer: (input: ImportInput) => BrickRun<ImportFailure, ImportResult> }
}>

const importRequest = brick<ImportRequest>(async (input, { importer }) => await importer(input))
```

Handler requirement types permit that await while retaining the original run type, so operations remain assignable to their declared requirement contracts when forwarded to helpers or object properties. Explicit `this` parameters remain required. Contextual awaitability is added only to exactly recognized monomorphic signatures and supported pairs of overloads. Other callable shapes, including sets with more than two overloads, retain the complete original type and require explicit failure handling; no traversal limit truncates their declarations. Generic identity operations (`<Value>(value: Value) => BrickRun<Failure, Value>`, including constraints) retain input/output inference; a generic identity signature, including one with a constraint, combined with a concrete overload also retains inference and the concrete result in either declaration order. Other generic signatures are preserved unchanged and may still require explicit failure handlers. Unhandled run failures propagate as structured domain failures when their rejection reaches the consuming handler. Run consumption always rejects with the public `UnhandledBrickFailureError`; the active owning handler recognizes its own run rejections through a private weak association and restores the structured failure. Manually thrown boundary errors and rejections owned by another handler remain defects. Callable requirements explicitly bind returned runs to their consuming handler; no ambient async context or Node API is required. Bound run views share the original chain's memoized consumption and preserve execution controls. Each handler owns a separate scope that is revoked on settlement, including on failure. Runs consumed through captured external functions without passing through the handler's requirements retain external boundary behavior. Detached consumers observe the public boundary error whether the owning handler is still active or has settled, including when consumption began before settlement. A detached failure does not force its parent to fail. Consumption outside handlers still requires exhaustive handling and rejects forced unhandled consumption with `UnhandledBrickFailureError`, including when the same run was already consumed inside a handler.

Never collapse typed failure into generic `Error` across durable boundary.

## Path and key invariants

Applies to Layer IDs, entry keys, dependency aliases, signal names, and `ExecutionContext` paths.

Every segment must be:

- string;
- non-empty;
- without `.`.

`.` is reserved delimiter. Symbol and numeric graph keys are invalid. Runtime lookup uses own-property checks. Flattened provider and signal maps use null-prototype storage where external keys accumulate.

## Code map

| Area | Path |
|---|---|
| Brick | `packages/core/src/brick/` |
| Layer/providers | `packages/core/src/layer/` |
| Graph execution | `packages/core/src/worker/execution.ts` |
| Worker contract/local | `packages/core/src/worker/` |
| Signals | `packages/core/src/signal/` |
| Engine-neutral context | `packages/core/src/engine/` |
| Path validation | `packages/core/src/path-segment.ts` |
| Runtime tests | `packages/core/test/` |
| Type-tests | `packages/core/type-tests/` |

## Non-negotiable invariants

- Core imports no durable adapter.
- Brick, Layer, bound views are immutable.
- Type and runtime select same graph.
- Signal graph derives from selected dependency graph.
- Dependency configuration is recursive and explicit.
- Providers remain structural.
- Typed failures differ from defects.
- Brick handlers may return synchronously or through a Promise. No generators or EffectTS.

## Change protocol

1. Read `AGENTS.md` and this file.
2. Check branch/status.
3. Add failing runtime test or type-test.
4. Observe failure.
5. Implement minimum.
6. Run focused checks.
7. Run full validation.
8. Update this file when public model changes.

```bash
bun run typecheck
bun test
bun run lint
bun run build
git diff --check
```

## Design history

- `docs/superpowers/specs/2026-08-10-brick-library-design-v1.md`
- `docs/superpowers/specs/2026-08-21-direct-brick-execution-design.md`
- `docs/superpowers/specs/2026-08-24-recursive-brick-graph-configuration-design.md`
