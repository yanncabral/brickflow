# Brick

Experimental TypeScript library for typed domain failures, structural dependency injection, composable Layers, Signals, and engine-neutral execution. Core includes a default in-process Worker; durable adapters are planned.

## Interface-first Bricks

Declare a structural interface, then create implementations with `brick<F>(handler)`:

```ts
import { type Brick, brick, Layer } from '@brickflow/core'

interface GetUserBrick extends Brick {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}

const getUser = brick<GetUserBrick>(
  async ({ id }, { userRepository }, _dependencies, { fail }) => {
    const user = await userRepository.find(id)
    return user ?? fail('user-not-found')
  }
)

const users = new Layer('users', { getUser }).provide({ userRepository })
const user = await users.getUser
  .run({ id: 'ada' })
  .with('user-not-found', () => ({ id: 'anonymous', name: 'Anonymous' }))
```

`errors`, `requires`, `depends`, and `signals` may be omitted when empty. Multiple `brick<GetUserBrick>(...)` values can implement the same interface.

Bricks can run directly by supplying `requirements`, recursive `{ brick, dependencies? }` dependency nodes, and signal handlers to `.run(...)`; Layers pre-bind reusable providers and resolve matching dependency aliases.

Dependencies bind structurally by declared alias and Brick entry key. Layer-bound resolution checks the caller's Layer scope first, then a unique matching Brick entry anywhere in the configured Layer tree. Missing or globally ambiguous aliases must be supplied through recursive dependency configuration at the run boundary. Renaming a Brick entry changes runtime binding and its durable ID.

Provider requirements remain statically checked through Layer composition. Brick implementations carry no runtime provider-key metadata, so handlers receive the full effective provider environment and missing keys are not prevalidated at runtime.

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

- `@brickflow/core`: engine-neutral contracts, direct execution, Layers, and the default in-process Worker.
- `@brickflow/engine-openworkflow`: placeholder for the planned OpenWorkflow adapter.
- `@brickflow/testing`: placeholder for future testing utilities.
- `examples/basic`: executable minimal API usage.
- `examples/code-agent`: placeholder for a future durable coding-agent scenario.

Current architecture: `docs/architecture/agent-context.md`.

Design history: `docs/superpowers/specs/`. Implementation plans: `docs/superpowers/plans/`.
