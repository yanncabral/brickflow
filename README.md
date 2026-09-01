# Brick

Experimental TypeScript library for typed domain failures, structural dependency injection, composable Layers, Signals, and engine-neutral execution. Core includes a default in-process Worker; durable adapters are planned.

## Installation

```bash
npm install brickflow
```

Brickflow is ESM-only and ships TypeScript declarations.

## Autocomplete-first Bricks

Declare a named, reusable contract with `Brick<{ ... }>` so editors can suggest every supported field while the contract is authored:

```ts
import { type Brick, brick, Layer } from 'brickflow'

type GetUserBrick = Brick<{
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}>

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

Autocomplete covers `params`, `result`, `errors`, `requires`, `depends`, and `signals`. `params` and `result` are required; the other fields are optional and use empty defaults when omitted. Contracts are erased TypeScript types, and multiple `brick<GetUserBrick>(...)` implementations can share the same contract.

Bricks can run directly by supplying `requirements`, recursive `{ brick, dependencies? }` dependency nodes, and signal handlers to `.run(...)`; Layers pre-bind reusable providers and resolve matching dependency aliases.

Dependencies bind structurally by declared alias and Brick entry key. Layer-bound resolution checks the caller's Layer scope first, then a unique matching Brick entry anywhere in the configured Layer tree. Missing or globally ambiguous aliases must be supplied through recursive dependency configuration at the run boundary. Renaming a Brick entry changes runtime binding and its durable ID.

Provider requirements remain statically checked through Layer composition. Brick implementations carry no runtime provider-key metadata, so handlers receive the full effective provider environment and missing keys are not prevalidated at runtime.

### Validated domain types

Validate unknown data at application and transport boundaries, then use the schema library's inferred branded, refined, transformed, or otherwise narrowed output type directly in a Brick contract. For example, Zod can brand a validated email:

```ts
const EmailSchema = z.string().email().brand<'Email'>()
type Email = z.infer<typeof EmailSchema>

type SendEmailBrick = Brick<{
  params: { email: Email }
  result: void
}>

const email = EmailSchema.parse(untrustedEmail)
await sendEmail.run({ email })
```

A plain `string` cannot satisfy `Email`, while the validated value can move through the trusted Brick graph without repeated validation. Libraries such as Zod, TypeBox, and ArkType expose their own output inference, and Standard Schema-compatible libraries can expose validated output through standard inference. Depending on the library and schema, that output may be branded, refined, transformed, or otherwise narrowed; these libraries do not all brand values automatically. Brick has no schema dependency and does not automatically validate inputs or outputs. Revalidate after any untrusted or serialization boundary, such as HTTP, queues, persisted data, or a future durable Worker boundary, because runtime serialization may not preserve brand trust.

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

- `brickflow` (`packages/core`): public engine-neutral contracts, direct execution, Layers, and the default in-process Worker.
- `@brickflow/engine-openworkflow`: placeholder for the planned OpenWorkflow adapter.
- `@brickflow/testing`: placeholder for future testing utilities.
- `examples/basic`: executable minimal API usage.
- `examples/code-agent`: placeholder for a future durable coding-agent scenario.

Current architecture: `docs/architecture/agent-context.md`.

Recommended vertical-slice module organization: `docs/architecture/vertical-slice-modules.md`.

Design history: `docs/superpowers/specs/`. Implementation plans: `docs/superpowers/plans/`.
