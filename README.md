# Flow

Experimental TypeScript library for typed domain failures, structural dependency injection, composable Layers, Signals, and engine-neutral local or durable Flow execution.

## Interface-first Flows

Declare a structural interface, then create implementations with `flow<F>(handler)`:

```ts
import { type Flow, flow, Layer, Worker } from '@flow/core'
import { LocalEngine } from '@flow/engine-local'

interface GetUserFlow extends Flow {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}

const getUser = flow<GetUserFlow>(
  async ({ id }, { userRepository }, _dependencies, { fail }) => {
    const user = await userRepository.find(id)
    return user ?? fail('user-not-found')
  }
)

const users = new Layer('users', { getUser }).provide({ userRepository })
const worker = new Worker({ engine: new LocalEngine(), layer: users })
```

`errors`, `requires`, `depends`, and `signals` may be omitted when empty. Multiple `flow<GetUserFlow>(...)` values can implement the same interface.

Dependencies bind structurally by their declared alias and the matching public Layer entry key. A dependency named `getUser` resolves a `getUser` entry in the caller's Layer scope, falling back to a unique matching entry in nested scopes. Renaming that public entry changes runtime binding and durable identity.

Provider requirements remain statically checked through Layer composition. This interface-only variant has no runtime provider-key metadata: handlers receive the full effective provider environment, and missing provider keys are not prevalidated at runtime. A future code-generation strategy may restore dynamic validation without adding tokens or duplicated metadata.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run lint
bun run format
bun run build
bun run clean
```

## Workspace packages

- `@flow/core`: engine-neutral contracts and execution semantics.
- `@flow/engine-local`: in-process engine.
- `@flow/engine-openworkflow`: OpenWorkflow durable engine adapter.
- `@flow/testing`: test utilities and compile-time fixtures.
- `examples/basic`: minimal API usage.
- `examples/code-agent`: durable coding-agent scenario.

See `docs/superpowers/specs/` for versioned designs and `docs/superpowers/plans/` for implementation plans.
