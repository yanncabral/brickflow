# Brickflow — Naming and API Redesign

## Status

**Decision:** rename library from **Flow** to **Brickflow**.

This redesign changes public vocabulary while preserving core goals:

- typed domain errors;
- structural dependency injection;
- composable implementations;
- local and durable execution engines;
- typed request/response signals;
- engine-neutral orchestration;
- ordinary async TypeScript syntax.

---

## New Vocabulary

| Previous | New | Meaning |
|---|---|---|
| Flow library | **Brickflow** | Library and ecosystem |
| `Flow` | **`Brick`** | Typed executable building block |
| `flow()` | **`brick()`** | Creates a Brick implementation |
| `Layer` | **`Layer`** | Composes Bricks and providers |
| `Worker` | **`Worker`** | Executes Bricks through an Engine |
| `FlowRun` | **`BrickRun`** | Handle for a running Brick |
| `Engine` | **`Engine`** | Execution backend |
| `LocalEngine` | **`LocalEngine`** | In-process execution backend |
| `OpenWorkflowEngine` | **`OpenWorkflowEngine`** | Planned durable backend |
| `fail()` | **`fail()`** | Produces a typed domain failure |
| `.with()` | **`.with()`** | Pattern-matches and handles failures |
| `signals` | **`signals`** | Typed request/response interactions |
| `requires` | **`requires`** | Structural provider requirements |
| `depends` | **`depends`** | Other Bricks required by a Brick |

Core metaphor:

> **Bricks compose into Layers. Workers execute Bricks using Engines.**

---

## Package Structure

Proposed npm packages:

```text
brickflow
@brickflow/core
@brickflow/engine-local
@brickflow/engine-openworkflow
@brickflow/testing
```

Recommended public package:

```ts
import {
  brick,
  Layer,
  Worker,
  P
} from 'brickflow'

import {
  LocalEngine
} from '@brickflow/engine-local'
```

Alternative monorepo organization:

```text
packages/
├── brickflow/
├── core/
├── engine-local/
├── engine-openworkflow/
└── testing/
```

`brickflow` may re-export stable core functionality while engine packages remain separate.

---

## Brick Contract

A Brick contract is declared using a TypeScript interface:

```ts
interface GetUserBrick extends Brick {
  params: {
    id: string
  }

  result: User

  errors:
    | 'user-not-found'
    | {
        type: 'database-unavailable'
        retryAfter: number
      }

  requires: {
    userRepository: UserRepository
  }
}
```

The base `Brick` interface provides defaults:

```ts
type Empty = Record<never, never>

interface Brick {
  params: unknown
  result: unknown
  errors: never
  requires: Empty
  depends: Empty
  signals: Empty
}
```

Therefore empty fields do not need to be declared:

```ts
interface HealthCheckBrick extends Brick {
  result: {
    healthy: true
  }
}
```

Equivalent expanded form:

```ts
interface HealthCheckBrick extends Brick {
  params: unknown
  result: {
    healthy: true
  }
  errors: never
  requires: Empty
  depends: Empty
  signals: Empty
}
```

---

## Brick Implementation

Use `brick<Contract>()`:

```ts
export const getUser = brick<GetUserBrick>(
  async (
    { id },
    { userRepository },
    _dependencies,
    { fail }
  ) => {
    const user = await userRepository.find(id)

    return user ?? fail('user-not-found')
  }
)
```

Removed boilerplate:

```ts
// Removed:
type GetUserSpec = { ... }

// Removed:
class GetUserFlow extends Flow<GetUserSpec> {}

// Removed:
new GetUserFlow(...)

// Removed:
requires: ['userRepository']
```

A Brick implementation is immutable and carries:

- handler;
- type-level contract;
- optional plugins;
- optional finalizers;
- future execution defaults.

---

## Multiple Implementations

Contracts remain independent from implementations:

```ts
const postgresGetUser = brick<GetUserBrick>(
  postgresHandler
)

const cachedGetUser = brick<GetUserBrick>(
  cachedHandler
)

const fakeGetUser = brick<GetUserBrick>(
  fakeHandler
)
```

Layers select concrete implementations:

```ts
const productionUsers = new Layer('users', {
  getUser: postgresGetUser
})

const cachedUsers = new Layer('users', {
  getUser: cachedGetUser
})

const testUsers = new Layer('users', {
  getUser: fakeGetUser
})
```

---

## Dependencies Between Bricks

A Brick declares dependencies structurally:

```ts
interface GetGreetingBrick extends Brick {
  params: {
    id: string
  }

  result: {
    message: string
  }

  depends: {
    getUser: GetUserBrick
  }
}
```

Implementation:

```ts
export const getGreeting = brick<GetGreetingBrick>(
  async (
    { id },
    _providers,
    { getUser }
  ) => {
    const user = await getUser({ id })

    return {
      message: `Hello, ${user.name}!`
    }
  }
)
```

Layer binds dependency aliases by public entry name:

```ts
const users = new Layer('users', {
  getUser,
  getGreeting
})
```

Resolution:

```text
GetGreetingBrick.depends.getUser
        matches
users.getUser
```

A missing or ambiguous entry produces a clear runtime error.

This is deliberately structural. There are no dependency tokens.

---

## Layers and Providers

Layers compose Brick implementations:

```ts
const users = new Layer('users', {
  getUser,
  getGreeting
})
```

Providers are supplied incrementally:

```ts
const configuredUsers = users
  .provide({
    userRepository
  })
  .provide({
    logger
  })
```

Layers are immutable:

```ts
users !== configuredUsers
```

Nested Layers:

```ts
const application = new Layer('application', {
  users,
  billing,
  codeAgent
})
```

Providers from nested Layers form the effective execution environment.

Explicit overrides:

```ts
const testApplication = application.override({
  userRepository: inMemoryUserRepository,
  logger: testLogger
})
```

---

## Provider Trade-off

Brick contracts declare provider types:

```ts
requires: {
  userRepository: UserRepository
}
```

These types disappear at runtime.

To avoid duplicated metadata, Brickflow will not require:

```ts
requires: ['userRepository']
```

Consequences:

- TypeScript validates provider usage and composition;
- handlers receive statically narrowed provider types;
- runtime receives the effective provider environment;
- exact runtime missing-provider validation is limited without codegen;
- JavaScript and unsafe `any` bypass some diagnostics.

A future optional compiler transform may generate runtime metadata without changing source syntax.

No provider tokens, decorators, or reflection metadata are planned for the initial redesign.

---

## Typed Errors

Bricks declare domain failures:

```ts
interface GetUserBrick extends Brick {
  result: User
  errors:
    | 'user-not-found'
    | {
        type: 'database-unavailable'
        retryAfter: number
      }
}
```

Produce failures using `fail()`:

```ts
return fail('user-not-found')
```

```ts
return fail({
  type: 'database-unavailable',
  retryAfter: 30
})
```

Normal returns always mean success.

Typed failures remain distinct from unexpected defects:

```ts
throw new TypeError('Invalid internal state')
```

Defects reject execution normally and are not converted into declared Brick errors.

---

## Error Propagation

Calling a dependency returns only its successful result:

```ts
const user = await getUser({ id })

// user: User
```

Unhandled dependency failures automatically propagate to the parent Brick.

Effective errors are conservative:

```ts
type GetGreetingErrors =
  EffectiveErrorsOf<GetGreetingBrick>
```

Includes:

```ts
GetGreetingBrick['errors']
| GetUserBrick['errors']
```

A parent does not need to repeat dependency errors manually.

---

## Pattern Matching

Failures are handled through `.with()`:

```ts
const result = await worker
  .run(users.getUser, {
    id: 'missing'
  })
  .with(
    'user-not-found',
    () => anonymousUser
  )
  .with(
    {
      type: 'database-unavailable'
    },
    error => loadCachedUser(error.retryAfter)
  )
```

Rules:

- first matching handler wins;
- non-`undefined` return recovers as success;
- `undefined` propagates original failure;
- handlers may be synchronous or asynchronous;
- `P._` provides catch-all matching;
- unexpected defects do not enter `.with()`.

Boundary execution is awaitable only after all typed errors are handled.

---

## Signals

Signals remain structural request/response functions:

```ts
interface ApproveEditBrick extends Brick {
  params: {
    path: string
    diff: string
  }

  result: {
    approved: boolean
  }

  signals: {
    approve: {
      request: {
        path: string
        diff: string
      }

      response: {
        approved: boolean
        reason?: string
      }
    }
  }
}
```

Inside implementation:

```ts
const approveEdit = brick<ApproveEditBrick>(
  async (
    { path, diff },
    _providers,
    _dependencies,
    { signals }
  ) => {
    return signals.approve({
      path,
      diff
    })
  }
)
```

Boundary callback:

```ts
const result = await worker.run(
  edits.approveEdit,
  {
    path: 'src/index.ts',
    diff
  },
  {
    signals: {
      edits: {
        approveEdit: {
          approve: async request => ({
            approved: await terminal.confirm(request.diff)
          })
        }
      }
    }
  }
)
```

No signal tokens or `run.signal()`.

---

## Signal Namespaces

Local signal:

```text
approve
```

Brick entry:

```text
edits.approveEdit
```

Effective durable signal path:

```text
edits.approveEdit.approve
```

Nested dependencies add namespace segments automatically.

This avoids collisions between unrelated signals:

```text
files.editFile.approve
billing.payment.approve
deployment.release.approve
```

---

## Worker

Worker executes Bricks from a Layer:

```ts
const worker = new Worker({
  engine: new LocalEngine(),
  layer: application
})
```

Execution:

```ts
const run = worker.run(
  users.getGreeting,
  {
    id: 'ada'
  }
)
```

`BrickRun` exposes:

```ts
run.id
run.status()
run.cancel()
run.with(...)
```

There is no public signal dispatch method. Signal callbacks are supplied when execution starts.

---

## Engines

Engines implement execution strategy.

### Local Engine

```ts
new LocalEngine()
```

Properties:

- same process;
- in-memory state;
- microtask execution;
- no persistence;
- no retry;
- no distributed workers;
- useful for tests, CLIs and ordinary applications.

### OpenWorkflow Engine

Planned:

```ts
new OpenWorkflowEngine({
  backend: sqliteBackend({
    path: '.brickflow/workflows.db'
  })
})
```

Or:

```ts
new OpenWorkflowEngine({
  backend: postgresBackend({
    connectionString: process.env.DATABASE_URL
  })
})
```

Properties:

- durable execution;
- replay;
- retries;
- durable timers;
- persistent signals;
- local SQLite or distributed PostgreSQL workers.

Future engines may include:

```text
TemporalEngine
InngestEngine
BunWorkerEngine
```

---

## Concurrency

Dependency calls are wrapped and registered by the Engine.

Natural concurrency remains possible:

```ts
const [user, settings] = await Promise.all([
  getUser({ id }),
  getSettings({ id })
])
```

Because calls are wrapped, Brickflow can track:

- parent;
- child executions;
- cancellation;
- paths;
- plugins;
- outcomes.

Future structured concurrency may add:

```ts
await tools.all(
  [
    getUser({ id }),
    getSettings({ id })
  ],
  {
    concurrency: 2,
    onFailure: 'cancel-siblings'
  }
)
```

---

## Cancellation

Promises are not natively cancelable.

Brickflow should use cooperative cancellation through `AbortSignal`:

```ts
const result = await llm.generate(prompt, {
  signal: abortSignal
})
```

Flow tools become Brick tools:

```ts
{
  fail,
  signals,
  abortSignal
}
```

Cancellation propagates from parent to child Bricks.

Engines may provide stronger cancellation guarantees, but external operations must cooperate with `AbortSignal`.

---

## Call Options

Wrapped Brick calls can receive execution options:

```ts
const user = await getUser(
  {
    id
  },
  {
    retry: {
      attempts: 3,
      backoff: 'exponential'
    },

    timeout: '5 seconds',

    plugins: [
      tracePlugin()
    ]
  }
)
```

Initially planned call options:

```ts
interface BrickCallOptions {
  id?: string
  timeout?: Duration
  retry?: RetryPolicy
  plugins?: readonly BrickPlugin[]
  signals?: InternalSignalHandlers
}
```

`repeat` and `schedule` do not belong on awaited calls because an awaited repeating execution may never terminate.

Scheduling should create separate runs through a dedicated Worker interface.

---

## Finalizers

Brick implementations may define finalizers:

```ts
const getUser = brick<GetUserBrick>(
  handler
).dispose(async ({ providers, exit }) => {
  // Cleanup invocation-owned resources.
})
```

Finalizers execute after:

- success;
- typed failure;
- defect;
- timeout;
- cancellation.

Shared Layer providers should not normally be closed after each Brick invocation.

Layer-level disposal handles shared lifecycle:

```ts
const users = new Layer('users', {
  getUser
})
  .provide({
    repository
  })
  .dispose(async ({ repository }) => {
    await repository.close()
  })
```

Future handler-local resource cleanup may use:

```ts
defer(() => cleanup())
```

Finalizers must be idempotent for durable engines.

---

## Plugins

Plugins attach to Brick definitions and calls:

```ts
const getUser = brick<GetUserBrick>(
  {
    plugins: [
      tracingPlugin(),
      metricsPlugin()
    ]
  },
  handler
)
```

Plugins merge in deterministic order:

```text
Worker plugins
Root Brick plugins
Call-site plugins
Child Brick plugins
```

Lifecycle:

```ts
interface BrickPlugin {
  onStart?(context): void | Promise<void>
  onSuccess?(context, value): void | Promise<void>
  onFailure?(context, error): void | Promise<void>
  onCancel?(context): void | Promise<void>
  onFinally?(context, exit): void | Promise<void>
}
```

Potential native plugins:

```text
OpenTelemetry tracing
structured logging
metrics
audit logs
profiling
devtools
```

Durable engines must prevent duplicate plugin events during replay unless plugin explicitly opts into replay events.

---

## Retry and Timeout

Retry and timeout are call-level execution policies:

```ts
await generatePlan(
  params,
  {
    retry: {
      attempts: 3,
      backoff: 'exponential',
      jitter: true
    },

    timeout: '2 minutes'
  }
)
```

Defaults:

- typed domain failures do not retry automatically;
- defects/transient failures may retry according to Engine policy;
- durable engines persist retry state;
- timeout propagates cancellation through `AbortSignal`.

Exact retry classification remains a future design task.

---

## Package Migration

Current packages:

```text
@flow/core
@flow/engine-local
@flow/engine-openworkflow
@flow/testing
```

Target:

```text
brickflow
@brickflow/core
@brickflow/engine-local
@brickflow/engine-openworkflow
@brickflow/testing
```

Current repository:

```text
yanncabral/flow
```

Potential repository rename:

```text
yanncabral/brickflow
```

Current public symbols:

```text
Flow
flow
FlowRun
```

Target:

```text
Brick
brick
BrickRun
```

Symbols retained:

```text
Layer
Worker
Engine
LocalEngine
fail
signals
P
```

---

## Migration Example

### Before

```ts
type GetUserSpec = {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: {
    userRepository: UserRepository
  }
  depends: Empty
  signals: Empty
}

class GetUserFlow extends Flow<GetUserSpec> {}

const getUser = new GetUserFlow(
  {
    depends: {},
    requires: ['userRepository']
  },
  handler
)
```

### Intermediate proposed Flow API

```ts
interface GetUserFlow extends Flow {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: {
    userRepository: UserRepository
  }
}

const getUser = flow<GetUserFlow>(
  handler
)
```

### Brickflow API

```ts
interface GetUserBrick extends Brick {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: {
    userRepository: UserRepository
  }
}

const getUser = brick<GetUserBrick>(
  handler
)
```

---

## Tagline

> **Brickflow — Build resilient systems, brick by brick.**

Alternatives:

> **Composable bricks. Durable flows.**

> **Typed building blocks for reliable applications.**

> **Build once. Run anywhere. Resume every time.**

---

## Redesign Principles

1. **Brick is the smallest executable contract.**
2. **Layer composes Brick implementations and providers.**
3. **Worker executes Bricks through an Engine.**
4. **Engine controls local, threaded or durable execution.**
5. **Typed failures remain distinct from defects.**
6. **Signals are structural and namespaced.**
7. **No service or signal tokens.**
8. **Ordinary async TypeScript remains the primary syntax.**
9. **Durability is an Engine capability, not a Brick requirement.**
10. **Brickflow stays smaller and more application-oriented than Effect.**
