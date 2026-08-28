# Brick Definition Autocomplete Design

## Status

Approved design for replacing interface-based Brick declarations with a generic configuration type that provides editor autocomplete.

## Problem

The current public API declares Brick contracts by extending `Brick`:

```ts
interface GetUserBrick extends Brick {
  params: { id: string }
  result: User
  errors: UserNotFound
  requires: { users: UserRepository }
}
```

TypeScript validates inherited members after they are written, but editors do not reliably suggest inherited property names while the interface body is being authored. Users must remember `params`, `result`, `errors`, `requires`, `depends`, and `signals`. This weakens discovery at the first and most common API entry point.

## Goals

- Offer autocomplete for every supported Brick configuration field while a contract is authored.
- Preserve the existing names `params` and `result`.
- Keep contracts named, reusable, and type-only.
- Preserve full handler, dependency, signal, failure, Layer, and `.run()` inference.
- Add no runtime configuration objects or metadata.
- Keep existing Brick validation rules.

## Non-goals

- Renaming `params` or `result`.
- Adding builder-style runtime APIs.
- Changing Brick execution, Layer resolution, Workers, Signals, failures, or durable identity.
- Preserving `interface X extends Brick` as a supported declaration style.

## Public API

`Brick` becomes a generic type whose argument is contextually constrained to the supported configuration shape:

```ts
type GetUserBrick = Brick<{
  params: { id: string }
  result: User
  errors: UserNotFound
  requires: {
    users: UserRepository
  }
  depends: {
    audit: AuditBrick
  }
  signals: {
    confirm: {
      request: User
      response: boolean
    }
  }
}>

const getUser = brick<GetUserBrick>(
  async ({ id }, { users }, { audit }, { fail, signals }) => {
    // implementation
  }
)
```

When the cursor is inside the object passed to `Brick<...>`, TypeScript language services should suggest:

- `params`
- `result`
- `errors`
- `requires`
- `depends`
- `signals`

`params` and `result` are required. `errors`, `requires`, `depends`, and `signals` are optional.

The executable factory remains:

```ts
brick<GetUserBrick>(handler)
```

No runtime argument or builder chain is introduced.

## Type Model

The public configuration shape distinguishes required and optional sections. `Brick<Config>` resolves to the concrete contract represented by `Config`, while retaining enough structural identity for existing generic constraints and conditional types.

All existing projections continue to work:

- `ParamsOf<F>`
- `ResultOf<F>`
- `ErrorsOf<F>`
- `RequirementsOf<F>`
- `DependenciesOf<F>`
- `SignalsOf<F>`

Existing defaults remain unchanged when optional sections are omitted:

- errors default to `never`;
- requirements default to an empty object;
- dependencies default to an empty object;
- signals default to an empty object.

The type design must not widen omitted optional sections into broad `unknown` or `object` values. Existing conditional behavior that determines required run options, effective graph requirements, propagated errors, and signal handlers must remain precise.

## Validation

Current contract validation remains in force:

- dependency values must be Brick contracts;
- dependency aliases must be non-empty string path segments without `.`;
- signal names must be non-empty string path segments without `.`;
- symbol and numeric dependency or signal keys remain invalid;
- signal definitions retain their request and response structure;
- handler parameters and results must match the declared contract.

Invalid contracts must continue producing type errors at `brick<Contract>(handler)` or an equally actionable declaration boundary.

## Compatibility and Migration

This is an intentional source-level breaking change for Brick contract declarations.

Before:

```ts
interface QuietBrick extends Brick {
  params: undefined
  result: number
}
```

After:

```ts
type QuietBrick = Brick<{
  params: undefined
  result: number
}>
```

All repository examples, runtime tests, type-tests, architecture documentation, and current specs or guides that describe the active API must use the new form. Historical design specs remain historical and should not be silently rewritten unless they claim to document current behavior.

Consumers continue instantiating contracts through `brick<Contract>(handler)`, so runtime construction and call sites do not change.

## Runtime Behavior

None. Brick contracts remain erased TypeScript types. `brick()` still creates the same frozen implementation, and no tokens, schemas, requirement metadata, or configuration values are retained at runtime.

## Testing

Type-tests must cover:

1. a complete `Brick<{ ... }>` contract and inferred handler arguments;
2. contracts containing only required `params` and `result`;
3. defaults for every omitted optional section;
4. dependency, signal, failure, requirement, and result inference;
5. existing invalid alias and signal-name cases;
6. invalid dependency and signal shapes;
7. required and optional direct-run configuration;
8. Layer composition and bound-run inference.

Editor completion itself is supplied by TypeScript contextual typing and is not directly asserted by ordinary type-tests. The public declaration shape must expose a constrained generic parameter rather than an unconstrained object so completion-capable editors can discover supported keys.

Runtime tests should be migrated mechanically to the new declaration syntax and continue asserting unchanged behavior.

## Validated and Branded Domain Types

Brick does not need a schema dependency or a Standard Schema integration to consume values validated by Zod, TypeBox, ArkType, or another schema library. Users should validate unknown data once at an application or transport boundary, infer the library's validated output type, and use that type directly in a Brick contract.

For example, a Zod brand can distinguish a validated email from an arbitrary string:

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

A plain `string` must not satisfy `Email`, while the validated value can pass through any number of Bricks without repeated runtime validation. Other libraries may provide branded, refined, transformed, or otherwise narrowed output types through their own inference APIs or through Standard Schema output inference.

Core remains schema-library-neutral. It must not import schema packages, automatically parse Brick inputs or outputs, or invent a cross-library brand. Validation is repeated only when data crosses a boundary that invalidates type trust, such as HTTP input, queue input, persisted data, or a future durable serialization boundary.

## Documentation

`docs/architecture/agent-context.md` and executable examples must present `Brick<{ ... }>` as the canonical contract declaration. Documentation should explain that this form is chosen for autocomplete and that `brick<Contract>(handler)` remains the executable factory.

The root README and architecture context must also document the recommended validated-domain-type pattern: validate once at an untrusted boundary, use the schema library's inferred branded or refined output type in `Brick<{ ... }>`, and pass that value through the trusted Brick graph without revalidation. The documentation must make clear that Brick has no runtime schema integration.
