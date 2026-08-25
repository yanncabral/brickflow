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

- `@brickflow/core` implements direct and Layer-bound execution with default local Worker.
- `@brickflow/engine-openworkflow` is a placeholder; no durable Worker or serialization exists.
- `@brickflow/testing` and `examples/code-agent` are placeholders.
- Core runtime tests and all type-tests live under `packages/core/`; basic example runtime test lives under `examples/basic/test/`.

## Brick

```ts
interface UseCase extends Brick {
  params: Input
  result: Output
  errors: DomainFailure
  requires: Requirements
  depends: { child: ChildBrick }
  signals: {
    approve: { request: Request; response: Response }
  }
}

const useCase = brick<UseCase>(handler)
```

Omit `errors`, `requires`, `depends`, or `signals` when empty; when declared, the property itself is required.

Rules:

- Interface is type-only.
- `brick()` returns frozen executable implementation.
- No tokens or runtime requirement metadata.
- Typed direct runs and Layer composition require missing providers statically. Runtime does not prevalidate provider keys because implementations carry no requirement metadata.

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

Bound runs require only unresolved configuration.

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

Core exports `Worker`, `LocalWorker`, and default `localWorker`.

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
| `.with(pattern, handler)` | Typed recovery; `undefined` leaves failure unhandled |
| Unhandled typed failure | Not `PromiseLike` until exhausted; forced consumption rejects with `UnhandledBrickFailureError` |
| Unexpected `throw` | Rejected defect |
| Worker boundary | `{ ok: false, error }`; future durable adapters must preserve structured data |

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
