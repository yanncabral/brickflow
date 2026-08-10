# Flow Library — Design Specification

- **Document version:** 1.0.0
- **Design variant:** `v1-conservative-contract`
- **Status:** Approved design baseline
- **Date:** 2026-08-10
- **Implementation status:** Not started
- **Intended language:** TypeScript
- **Pattern matching dependency:** `ts-pattern`

## 1. Purpose

This document specifies a small TypeScript library for composing asynchronous application logic with:

1. mandatory dependency injection;
2. typed domain failures without application-level `throw`;
3. automatic propagation of unhandled failures;
4. pattern matching for selective failure handling;
5. abstract Flow contracts with replaceable implementations;
6. recursive calculation of service and Flow dependencies;
7. immutable, incrementally configured runtimes;
8. compile-time enforcement that every failure is handled at the application boundary.

The library is deliberately smaller and more opinionated than EffectTS. Its primary ergonomic goal is to keep Flow implementations close to ordinary async functions.

```ts
const user = await getUser({ id }).with(
  "user-not-found",
  () => anonymousUser,
)

console.log(user.id)
```

When the next line executes, `user` is a success value. A failure that was not handled by `.with(...)` is propagated internally and does not appear in the local value type.

---

## 2. Design principles

### 2.1 Ordinary TypeScript first

Flow bodies use:

- `async` functions;
- normal parameters;
- object destructuring;
- normal return values for success;
- `if`, `switch`, and regular TypeScript control flow;
- `ts-pattern` patterns only when handling failures from another Flow.

The design does not use generators, `yield`, pipelines, tagged success wrappers, or `Result.ok`/`Result.error` checks inside Flow bodies.

### 2.2 Explicit failure production, implicit failure propagation

A Flow creates a new failure explicitly with `fail(error)`.

```ts
if (!user) {
  return fail("user-not-found")
}
```

A Flow does not need to manually rethrow or re-return a failure produced by a dependency. Unhandled dependency failures propagate automatically.

### 2.3 Depend on abstractions

A Flow depends on abstract Flow contracts, not concrete implementation values. A runtime binds each abstract contract to one concrete implementation.

This permits multiple implementations of one contract and supports the Open/Closed and Dependency Inversion principles.

### 2.4 Conservative public contracts

A Flow's effective public failure set includes:

- failures declared directly by that Flow; and
- all effective failures of every transitive Flow dependency.

This remains true even if one concrete implementation handles a dependency failure internally. The public contract is intentionally stable and conservative.

### 2.5 Immutable configuration

`provide`, `override`, `provideFlow`, and `overrideFlow` return new runtime values. They never mutate an existing runtime.

### 2.6 Complete handling at the boundary

Inside a Flow, unmatched failures propagate to its parent Flow. At `runtime.run`, there is no parent. Therefore all effective failures must be handled before the run can be awaited as a success value.

---

## 3. Terminology

| Term | Meaning |
|---|---|
| **Flow contract** | Abstract type describing parameters, success result, own failures, required services, and dependent Flow contracts. |
| **Flow token** | Runtime identity for an abstract Flow contract. Interfaces disappear at runtime, so a token is required for registration and resolution. |
| **Flow implementation** | Executable implementation of a Flow contract. Multiple implementations may satisfy the same contract. |
| **Own failures** | Failures declared directly in a contract's `errors` property. |
| **Effective failures** | Own failures plus all failures inherited recursively from `depends`. |
| **Direct requirements** | Services declared by a contract in `requires`. |
| **Effective requirements** | Direct requirements plus all requirements inherited recursively from the selected implementations of dependencies. |
| **Bound Flow** | Callable representation of a dependency injected into a Flow implementation. It already has access to the current execution environment. |
| **Call builder** | Awaitable value returned when a bound Flow is invoked. It supports `.with(...)` before execution is resolved. |
| **Run builder** | Boundary equivalent of a call builder, returned by `runtime.run(...)`. It requires exhaustive failure handling. |
| **Runtime** | Immutable registry of configured services and Flow implementation bindings. |

---

## 4. Core contract model

### 4.1 Base `Flow` interface

The conceptual base interface is:

```ts
interface Flow<Id extends string = string> {
  readonly id: Id
  params: unknown
  result: unknown
  errors: unknown
  requires: object
  depends: Record<string, Flow>
}
```

Concrete contracts extend it:

```ts
interface GetUserFlow extends Flow<"GetUserFlow"> {
  readonly id: "GetUserFlow"

  params: {
    id: string
  }

  result: User

  errors:
    | "user-not-found"
    | {
        type: "database-unavailable"
        retryAfter: number
      }

  requires: {
    database: Database
    logger: Logger
  }

  depends: {}
}
```

### 4.2 Meaning of each field

#### `id`

A globally unique literal identity for the abstract contract at the type level.

```ts
readonly id: "GetUserFlow"
```

V1 requires uniqueness within the application/library compilation graph. Two contracts must not reuse the same `id`. The token constructor receives the same literal and verifies it against the contract:

```ts
const GetUserFlow = flowContract<GetUserFlow>({
  id: "GetUserFlow",
  requires: ["database", "logger"],
})
```

This nominal field prevents structurally identical contracts from being conflated during recursive type calculation and runtime registry tracking.

#### `params`

The input passed when invoking the Flow.

#### `result`

The normal success value. It may be any TypeScript type, including primitives.

```ts
result: User
result: string
result: number
result: void
```

Success and failure types may overlap. Runtime behavior remains unambiguous because failures can only be created through `fail(...)`, which uses a private failure channel.

#### `errors`

Only failures introduced directly by this contract.

It does **not** manually repeat failures from `depends`.

#### `requires`

Named service dependencies injected into the second implementation argument.

```ts
requires: {
  database: Database
  logger: Logger
}
```

#### `depends`

Named abstract Flow contracts injected into the third implementation argument.

```ts
depends: {
  getUser: GetUserFlow
  getSettings: GetSettingsFlow
}
```

The values are contract types, not `typeof` concrete implementations.

### 4.3 Restrictions on `requires`

V1 service requirements must be finite object types with required string-literal keys only.

Allowed:

```ts
requires: {
  database: Database
  logger: Logger
}
```

Rejected in v1:

```ts
requires: { logger?: Logger }          // optional key
requires: Record<string, Service>      // broad string index
requires: { [key: symbol]: Service }   // symbol key
requires: { 0: Service }               // numeric key
```

These restrictions make exact value-level key metadata finite and verifiable. Mandatory type fixtures must reject optional properties, broad index signatures, and symbol/number keys.

### 4.4 Value-level service metadata

`requires` is erased at runtime, but the runtime must validate missing services, produce dependency-path diagnostics, and inject only the declared service keys. Therefore every contract token carries an explicit value-level list of required service keys.

```ts
const GetUserFlow = flowContract<GetUserFlow>({
  id: "GetUserFlow",
  requires: ["database", "logger"],
})
```

Rules:

- `id` must exactly match `GetUserFlow["id"]`;
- every key of `GetUserFlow["requires"]` must appear exactly once;
- no extra key is allowed, including through predeclared variables;
- only keys are represented at runtime; TypeScript remains responsible for service value compatibility;
- the service object injected into a Flow contains exactly its declared direct `requires` keys, selected from the shared execution environment;
- nested bound Flows receive their own exact service projection from the same environment.

V1 does not attempt runtime structural validation of TypeScript service interfaces. Runtime checks validate key presence, duplicate configuration, and graph paths; compile-time checks validate value types.

### 4.5 Conservative effective failures

Conceptually:

```ts
type OwnErrorsOf<F extends Flow> = F["errors"]

type EffectiveErrorsOf<F extends Flow> =
  | OwnErrorsOf<F>
  | EffectiveErrorsOfDependencies<F["depends"]>
```

Example:

```ts
interface GetProfileFlow extends Flow<"GetProfileFlow"> {
  readonly id: "GetProfileFlow"
  params: { id: string }
  result: Profile
  errors: "profile-not-found"
  requires: { profiles: ProfileRepository }
  depends: {
    getUser: GetUserFlow
    getSettings: GetSettingsFlow
  }
}
```

If `GetUserFlow` can fail with:

```ts
"user-not-found" | DatabaseUnavailable
```

and `GetSettingsFlow` can fail with:

```ts
"settings-not-found"
```

then:

```ts
EffectiveErrorsOf<GetProfileFlow>
```

is:

```ts
| "profile-not-found"
| "user-not-found"
| DatabaseUnavailable
| "settings-not-found"
```

The author never writes this union manually.

### 4.6 Conservative means implementation-independent

Even if a concrete `GetProfileFlow` implementation handles `"user-not-found"` internally, `EffectiveErrorsOf<GetProfileFlow>` still contains it.

This is intentional:

- the abstract contract does not change when an implementation changes;
- all implementations remain substitutable;
- callers do not gain or lose public failure cases based on private implementation details;
- the type calculation does not need to inspect implementation bodies.

---

## 5. Runtime identities: Flow tokens

TypeScript interfaces do not exist at runtime. Every abstract contract therefore has a typed token.

The same identifier may be used in both the type and value namespaces:

```ts
interface GetUserFlow extends Flow<"GetUserFlow"> {
  readonly id: "GetUserFlow"
  params: { id: string }
  result: User
  errors: GetUserError
  requires: {
    database: Database
    logger: Logger
  }
  depends: {}
}

const GetUserFlow = flowContract<GetUserFlow>({
  id: "GetUserFlow",
  requires: ["database", "logger"],
})
```

### 5.1 Token requirements

A Flow token must:

- have a globally unique literal type identity from `F["id"]`;
- also be unique by runtime object/symbol identity;
- carry its contract type through a phantom generic;
- carry the exact runtime list of direct service keys;
- have a readable name for diagnostics;
- be safe as a `Map` key;
- not contain an implementation;
- not be globally mutable.

Conceptually:

```ts
declare const flowContractType: unique symbol

interface FlowContractToken<F extends Flow> {
  readonly id: F["id"]
  readonly name: string
  readonly requires: readonly (keyof F["requires"])[]
  readonly runtimeKey: symbol
  readonly [flowContractType]: F
}
```

```ts
function flowContract<F extends Flow>(metadata: {
  id: F["id"]
  requires: ExactKeyTuple<F["requires"]>
}): FlowContractToken<F>
```

The contract's literal `id` is the sole compile-time identity in v1; `runtimeKey` provides collision-free runtime identity. V1 relies on a **canonical-token invariant**: exactly one token object may exist for each literal contract id within a runtime graph. A runtime rejects two different token objects that reuse the same literal `id`.

Consequently, compile-time registration proves that the canonical contract id is registered, not object-identity equality between two arbitrary token instances. Runtime validation enforces that the registered token object is the same canonical token referenced by dependency metadata. A future variant may introduce caller-supplied nominal unique-symbol identity if compile-time object-level identity is required.

---

## 6. Defining implementations with `flow`

The constructor is named `flow`, not `defineFlow`.

```ts
const getUserFromPostgres = flow(
  GetUserFlow,
  {
    depends: {},
  },
  async (
    { id },
    { database, logger },
    {},
    { fail },
  ) => {
    logger.info("Loading user", { id })

    const user = await database.users.find(id)

    if (!user) {
      return fail("user-not-found")
    }

    return user
  },
)
```

### 6.1 Implementation callback arguments

The implementation callback receives exactly four arguments:

```ts
async (
  params,
  services,
  flows,
  tools,
) => result
```

1. `params`: `Contract["params"]`;
2. `services`: `Contract["requires"]`;
3. `flows`: bound callable dependencies described by `Contract["depends"]`;
4. `tools`: Flow-local tools, initially `{ fail }`.

Destructuring is encouraged:

```ts
async (
  { id },
  { profiles, logger },
  { getUser, getSettings },
  { fail },
) => {
  // ...
}
```

### 6.2 Runtime dependency metadata

The interface's `depends` field disappears at runtime. The implementation must therefore bind each alias to a Flow token:

```ts
const getProfile = flow(
  GetProfileFlow,
  {
    depends: {
      getUser: GetUserFlow,
      getSettings: GetSettingsFlow,
    },
  },
  implementation,
)
```

The library must statically verify that this value-level map exactly satisfies `GetProfileFlow["depends"]`:

- no required alias may be omitted;
- no undeclared alias may be added, including through a predeclared variable;
- each alias must use a token with the exact declared contract `id`;
- the returned `FlowImplementation` must retain the concrete dependency-token map in its generic and runtime metadata.

Conceptually:

```ts
type FlowImplementation<
  F extends Flow,
  DependencyTokens extends DependencyTokenMap<F["depends"]>,
> = {
  readonly contract: FlowContractToken<F>
  readonly dependencyTokens: Exact<
    DependencyTokenMap<F["depends"]>,
    DependencyTokens
  >
  // private executable handler metadata
}
```

The `flow` generic signature must use an `Exact`/`NoExtraProperties` constraint rather than relying only on excess-property checks. Type tests must cover inline literals and predeclared variables.

V1 always requires the options object and always requires `depends`, including `depends: {}`. There is no overload that omits it.

### 6.3 Multiple implementations

Several implementations may satisfy one contract:

```ts
const postgresGetUser = flow(GetUserFlow, { depends: {} }, postgresHandler)
const inMemoryGetUser = flow(GetUserFlow, { depends: {} }, inMemoryHandler)
const remoteGetUser = flow(GetUserFlow, { depends: {} }, remoteHandler)
```

Consumers depend only on `GetUserFlow`. The runtime chooses the implementation.

### 6.4 Contract compatibility

An implementation must satisfy the contract exactly enough to preserve substitutability:

- accepted params must accept the contract params;
- normal return values must be assignable to the contract result;
- `fail` may only accept own errors declared by the contract;
- required service names and types come from the contract;
- dependency aliases and contract tokens come from the contract.

In design variant v1, all implementations of one contract share the same `requires` and `depends` shape. Implementation-specific dependency sets are intentionally deferred to a future variant because they substantially complicate runtime type calculation and substitutability.

---

## 7. Producing failures with `fail`

### 7.1 `fail` is mandatory for new failures

A normal return always means success:

```ts
return user
```

A new failure must be produced with `fail`:

```ts
return fail("user-not-found")
```

or:

```ts
return fail({
  type: "database-unavailable",
  retryAfter: 30,
})
```

The runtime must not infer failure from a returned value's type. Type information does not exist at runtime, and success/error types may overlap.

### 7.2 Signature

Inside implementation `F`:

```ts
fail(error: OwnErrorsOf<F>): never
```

`fail` accepts only errors directly declared by the current contract. Dependency errors are propagated by bound Flow calls; they are not manually re-created unless the author intentionally maps them to an own error.

### 7.3 Internal mechanism

Application code never uses `throw` for domain failures. Internally, the library may use a private control-flow exception:

```ts
class FlowFailure<E = unknown> {
  constructor(readonly error: E) {}
}
```

`fail(error)` throws this private signal and has static return type `never`.

Requirements:

- the signal must not be exported as part of the normal public API;
- only genuine internal Flow failures may be caught as domain failures;
- ordinary unexpected exceptions must not be silently converted to declared Flow errors;
- runtime boundary behavior for defects must remain distinguishable from typed domain failures.

### 7.4 `return fail(...)` style

Both forms terminate because `fail` returns `never`:

```ts
fail(error)
```

```ts
return fail(error)
```

The documented recommendation is `return fail(error)` because it makes branch termination explicit.

---

## 8. Calling dependent Flows

Dependent Flows are injected as callable functions. There is no generic `call` helper in the implementation tools.

```ts
const getProfile = flow(
  GetProfileFlow,
  {
    depends: {
      getUser: GetUserFlow,
      getSettings: GetSettingsFlow,
    },
  },
  async (
    { id },
    { profiles },
    { getUser, getSettings },
    { fail },
  ) => {
    const user = await getUser({ id })
    const settings = await getSettings({ userId: user.id })

    const profile = await profiles.findByUser(user.id)

    if (!profile) {
      return fail("profile-not-found")
    }

    return { user, settings, profile }
  },
)
```

### 8.1 Bound Flow signature

Conceptually:

```ts
type BoundFlow<F extends Flow> = (
  params: F["params"],
) => FlowCall<F["result"], EffectiveErrorsOf<F>>
```

The current runtime environment is reused automatically. Services and nested Flow implementations are never passed manually to a bound Flow call.

### 8.2 Default propagation

```ts
const user = await getUser({ id })
```

If `getUser` succeeds, `user` is `User`.

If it fails, the current Flow stops and the failure is propagated through the private failure channel. The next line does not execute.

The local variable type does not contain errors:

```ts
user // User
```

---

## 9. Pattern matching failures with `.with`

### 9.1 Single matching method

The call builder exposes one failure-handling method: `.with(...)`.

There is no `attempt`, `recover`, `onError`, `expose`, or `tapError` in v1.

```ts
const user = await getUser({ id })
  .with("user-not-found", () => anonymousUser)
  .with(
    { type: "database-unavailable" },
    error => cachedUser(error.retryAfter),
  )
```

### 9.2 Pattern semantics

Patterns use `ts-pattern` 5.x runtime semantics for the frozen v1 subset:

- primitive literal patterns;
- partial nested object patterns over discriminated unions;
- `P._` as catch-all;
- `P.when(...)`, including type-guard predicates;
- synchronous and asynchronous handlers.

All other `ts-pattern` forms—including `P.select`, anonymous selections, arrays/tuples, sets/maps, and additional `P.*` matcher guarantees—are unsupported by the v1 public contract. The builder's type signature should reject unsupported patterns where practical rather than promise accidental runtime compatibility.

Example:

```ts
const user = await getUser({ id }).with(
  {
    type: "database-unavailable",
    data: {
      type: "text",
    },
  },
  error => fallbackFromText(error.data),
)
```

### 9.3 First match wins

Handlers are evaluated in declaration order. The first matching `.with(...)` handler wins for recovery.

This matches `ts-pattern` expectations and allows specific patterns before broad patterns.

### 9.4 Handler return semantics

A `.with(...)` handler may return synchronously or asynchronously:

```ts
Recovery | undefined | Promise<Recovery | undefined>
```

The meaning is:

| Handler outcome | Meaning |
|---|---|
| Non-`undefined` normal value | The matched failure is handled; use that value as the local success result. |
| `undefined` | The handler was observational/conditional only; propagate the original failure. |
| `Promise<value>` | Same behavior after awaiting. |
| `Promise<undefined>` | Propagate the original failure after the async side effect. |
| `fail(newError)` | Terminate with a new own failure of the current Flow. |
| Unexpected thrown exception | Defect; do not treat as a typed Flow failure unless it is the library's private failure signal. |

### 9.5 Recovery may widen the local result

A handler is not required to return exactly the called Flow's result type.

```ts
const user = await getUser({ id }).with(
  "user-not-found",
  () => ({ anonymous: true } as const),
)

// User | { readonly anonymous: true }
```

The containing Flow's implementation return type still constrains the final value it may return.

### 9.6 Logging without a separate method

Returning `undefined` supports side effects without adding another API method:

```ts
const user = await getUser({ id }).with(
  { type: "database-unavailable" },
  error => {
    logger.warn("Database unavailable", error)
    // undefined: original failure propagates
  },
)
```

### 9.7 Conditional recovery

```ts
const user = await getUser({ id }).with(
  { type: "database-unavailable" },
  async error => {
    if (error.retryAfter <= 30) {
      const cached = await cache.findUser(id)

      if (cached) {
        return cached
      }
    }

    // undefined: original failure propagates
  },
)
```

Because recovery is not guaranteed, the error remains potentially unhandled in the builder's type state.

### 9.8 Mapping a dependency error to an own error

```ts
const user = await getUser({ id }).with(
  { type: "database-unavailable" },
  error =>
    fail({
      type: "profile-unavailable",
      retryAfter: error.retryAfter,
    }),
)
```

Here the dependency failure is consumed and replaced by a failure declared in the current Flow's own `errors` type.

### 9.9 Recovery to `undefined`

In v1, `undefined` is reserved to mean “propagate the original failure.” Therefore a `.with(...)` handler cannot recover a failure to a successful `undefined` value.

A Flow itself may still have `result: undefined` and return `undefined` normally. The restriction applies only to `.with(...)` handler outcomes.

A future variant may add an explicit `succeed(undefined)` sentinel if needed.

---

## 10. Static handling model for `.with`

### 10.1 Builder type state

Conceptually:

```ts
FlowCall<LocalResult, RemainingErrors>
```

Every `.with(...)` may:

- widen `LocalResult` with a handler's non-`undefined` return type;
- remove errors definitely covered by the pattern only when the handler definitely returns a non-`undefined` success or `never` through `fail`;
- leave errors in `RemainingErrors` when the handler can return `undefined`.

### 10.2 Conservative pattern subtraction

Type-level pattern subtraction must be conservative.

A pattern may be used for runtime matching even when the library cannot prove it covers an entire error variant. In that case, the matched error remains in `RemainingErrors`.

Example:

```ts
.with(
  { type: "database-unavailable", retryAfter: P.number.lt(30) },
  () => cachedUser,
)
```

This does not cover every `DatabaseUnavailable`, so that error type remains potentially unhandled.

A broad discriminant pattern can remove the variant:

```ts
.with(
  { type: "database-unavailable" },
  () => cachedUser,
)
```

### 10.3 Frozen v1 pattern subset and required spike

V1 targets `ts-pattern` 5.x and may use only its documented public exports. The guaranteed public subset is:

1. primitive literal patterns;
2. partial nested object patterns over discriminated unions;
3. `P._` as catch-all;
4. `P.when(predicate)` for runtime matching and handler narrowing when the predicate is a type guard;
5. synchronous and asynchronous handlers.

V1 explicitly excludes handler selections (`P.select`), anonymous selections, array/set/map-specific matcher guarantees, and reliance on private `ts-pattern` type modules. They may work accidentally at runtime but are not part of the v1 compatibility contract.

Before implementing the final builder types, a type-level spike must verify:

1. literal union subtraction;
2. whole discriminated-object variant subtraction;
3. nested partial patterns remaining conservative unless they provably cover a complete variant;
4. `P._` exhaustion;
5. `P.when` conservatism;
6. handler narrowing;
7. synchronous and asynchronous return inference.

If exact subtraction cannot be expressed using documented public APIs, v1 must implement its own conservative subtraction utilities while delegating runtime matching to `ts-pattern`.

### 10.4 Guaranteed boundary escape hatch

A catch-all pattern with a handler that cannot return `undefined` is always statically exhaustive:

```ts
.with(P._, error => fallbackFor(error))
```

This provides a reliable way to finish boundary handling even when an advanced partial pattern cannot be subtracted exactly.

---

## 11. Runtime creation and service injection

### 11.1 Creating a runtime

```ts
const baseRuntime = createRuntime({
  logger,
  clock,
})
```

The configured service type is retained in the runtime's generic state.

### 11.2 `provide`

`provide` adds services that are not already configured:

```ts
const applicationRuntime = baseRuntime.provide({
  database,
  cache,
})
```

Rules:

- immutable: returns a new runtime;
- may only add absent keys;
- values remain strongly typed;
- duplicate keys are a compile-time error;
- runtime validation should also reject duplicate keys when type checks are bypassed.

### 11.3 `override`

`override` replaces services that are already configured:

```ts
const testRuntime = applicationRuntime.override({
  database: fakeDatabase,
  logger: testLogger,
})
```

Rules:

- immutable: returns a new runtime;
- may only mention existing keys;
- replacement values must remain assignable to the existing service contract;
- unknown/nonconfigured keys are a compile-time error;
- runtime validation should reject invalid keys when type checks are bypassed.

### 11.4 Why both methods exist

The separate methods make intent explicit:

```ts
runtime.provide({ database })
runtime.override({ database: fakeDatabase })
```

There is no silent last-write-wins merge.

### 11.5 Per-run services

`runtime.run` accepts services still missing from the runtime:

```ts
const profile = await runtime.run(
  getProfile,
  { id: "123" },
  {
    profiles,
    requestContext,
  },
)
```

The third argument:

- is required if effective services are missing;
- contains exactly the missing service shape;
- is omitted when nothing is missing;
- cannot override configured services;
- is scoped only to that execution and all nested calls.

Conceptually:

```ts
type MissingRequirements<Required, Configured> =
  Omit<Required, keyof Configured>
```

Configured services may include keys unused by a particular run; incremental runtimes are intentionally supersets. For each effective required key, the configured or per-run value type must be assignable to the effective required service type. Per-run services may contain exactly the missing required keys—no extras and no configured-key overrides. Requirement-vs-requirement conflicts inside the transitive graph use the stricter mutual-assignability rule in §13.3.

At runtime, only key presence, extra per-run keys, and override attempts can be checked. Structural value compatibility remains compile-time only.

---

## 12. Registering Flow implementations

### 12.1 `provideFlow`

```ts
const runtime = createRuntime({
  database,
  logger,
}).provideFlow(GetUserFlow, postgresGetUser)
```

Rules:

- binds an abstract token to a compatible implementation;
- may only bind a token not already registered;
- returns a new runtime;
- statically verifies implementation-contract compatibility;
- preserves implementation type information needed for transitive requirement calculation.

### 12.2 `overrideFlow`

```ts
const testRuntime = runtime.overrideFlow(
  GetUserFlow,
  inMemoryGetUser,
)
```

Rules:

- token must already be registered;
- replacement must satisfy the same abstract contract;
- returns a new runtime;
- does not mutate the original runtime;
- transitive requirements are recalculated from the replacement implementation if the type model permits implementation-specific metadata in a later version.

In v1, implementations of one contract share contract requirements, so replacing an implementation does not change the required service shape.

### 12.3 Missing Flow registrations

The runtime generic registry is keyed by each contract's literal `id` and stores its canonical token/implementation pair. `FlowImplementation<F, D>` retains every concrete dependency token in `D`; recursive compile-time registration checking traverses those token ids. Therefore `runtime.run(rootImplementation, ...)` must be unavailable or produce a readable compile-time diagnostic when any transitive contract id is not registered.

Two structurally identical contracts with different literal ids remain distinct. Compile-time checking cannot distinguish two token objects that intentionally reuse one id; this is forbidden by the canonical-token invariant and rejected dynamically. Runtime graph resolution additionally requires the registered token object to equal the canonical token referenced by dependency metadata.

The runtime must also detect missing registrations and id collisions dynamically and throw a configuration defect if TypeScript validation is bypassed.

Suggested diagnostic shape:

```txt
Missing Flow implementation for GetUserFlow
Required by GetProfileFlow through dependency "getUser"
```

### 12.4 Root execution

V1 runs a concrete root implementation directly:

```ts
runtime.run(getProfile, params, missingServices)
```

Only internal abstract dependencies are resolved through tokens.

Running a token directly may be added later, but it is not required in v1.

---

## 13. Effective transitive requirements

### 13.1 Recursive calculation

For a root implementation, effective requirements are:

1. its contract's `requires`;
2. plus the `requires` of every contract in `depends`;
3. recursively through every dependency's `depends`.

Conceptually:

```ts
type EffectiveRequirementsOf<F extends Flow> =
  Merge<
    F["requires"],
    EffectiveRequirementsOfDependencies<F["depends"]>
  >
```

### 13.2 Example

```ts
GetProfileFlow.requires = {
  profiles: ProfileRepository
}

GetProfileFlow.depends = {
  getUser: GetUserFlow
  getSettings: GetSettingsFlow
}

GetUserFlow.requires = {
  database: Database
  logger: Logger
}

GetSettingsFlow.requires = {
  settings: SettingsRepository
  cache: Cache
}
```

Therefore:

```ts
EffectiveRequirementsOf<GetProfileFlow>
```

is:

```ts
{
  profiles: ProfileRepository
  database: Database
  logger: Logger
  settings: SettingsRepository
  cache: Cache
}
```

### 13.3 Key conflicts

If two transitive contracts require the same property name, v1 uses **mutual assignability** as its compatibility rule:

```ts
type SameServiceContract<A, B> =
  [A] extends [B]
    ? ([B] extends [A] ? true : false)
    : false
```

If both directions are true, the duplicate is merged once and the first encountered property type is retained. If either direction is false, effective-requirement calculation produces a branded compile-time conflict.

Example conflict:

```ts
{ database: SqlDatabase }
```

versus:

```ts
{ database: DocumentDatabase }
```

This strict rule intentionally rejects subtype/supertype variations under the same key. Applications that need different contracts should use different dependency keys or a shared service interface. Runtime validation can only compare keys and token metadata; structural compatibility is compile-time only.

### 13.4 Cycles

Dependency cycles are not supported in v1.

Both runtime and type-level traversal use the contract's nominal literal `id` for path identity, but cycle detection uses the **active recursion stack**, not a global visited set. Type utilities carry `ActivePathIds` independently into each sibling branch; encountering an id already on that branch produces `FlowDependencyCycle<Path>`. This permits valid diamonds such as `Root -> A -> Shared` and `Root -> B -> Shared`.

An optional completed/memoized set may avoid recomputation, but it must never classify a completed sibling as a cycle. A maximum active-path depth of 32 protects the compiler; exhausting it produces `FlowDependencyDepthExceeded<Path>`—never a silently incomplete requirement/error set.

Runtime traversal follows the same model with a recursion stack plus an optional completed cache, uses token `runtimeKey` identity for canonical objects, records the alias path, and rejects duplicate literal ids owned by distinct token objects.

Suggested diagnostic:

```txt
Flow dependency cycle detected:
AFlow -> BFlow -> CFlow -> AFlow
```

---

## 14. `runtime.run` and exhaustive boundary handling

### 14.1 Run builder

`runtime.run` returns a pattern-matchable run builder:

```ts
RunBuilder<Result, EffectiveErrors>
```

It supports the same `.with(pattern, handler)` API and semantics as bound Flow calls.

```ts
const user = await runtime
  .run(getUserFromPostgres, { id: "123" })
  .with("user-not-found", () => anonymousUser)
  .with(
    { type: "database-unavailable" },
    async error => loadFallback(error.retryAfter),
  )
```

### 14.2 Total handling is mandatory

A run builder exposes a valid Promise-compatible `then` only when its remaining error type is `never`. An incomplete builder must still contain a callable but deliberately incompatible `then` member so TypeScript reports TS1320 for a bare `await`; merely omitting `then` is insufficient because JavaScript permits awaiting non-Promise values.

Conceptually:

```ts
type RunBuilder<Result, RemainingErrors> =
  [RemainingErrors] extends [never]
    ? ExhaustiveRunBuilder<Result>
    : IncompleteRunBuilder<Result, RemainingErrors>

interface ExhaustiveRunBuilder<Result> extends PromiseLike<Result> {
  with(/* ... */): unknown
}

interface IncompleteRunBuilder<Result, RemainingErrors> {
  readonly then: (invalidOnFulfilled: never) => never
  readonly unhandledErrors: RemainingErrors // phantom diagnostic only
  with(/* ... */): unknown
}
```

The exact poisoned-`then` declaration may vary, but it must be locked by a TypeScript compile fixture that verifies this bare expression fails with TS1320:

```ts
const user = await runtime.run(getUserFromPostgres, { id: "123" })
//            ^ TS1320: callable `then` is not a valid Promise shape
```

An exhaustive builder exposes the real Promise-like `then` and becomes awaitable.

### 14.3 Boundary side-effect handlers do not consume errors

```ts
const user = await runtime
  .run(getUserFromPostgres, { id: "123" })
  .with({ type: "database-unavailable" }, error => {
    logger.error("Database unavailable", error)
    // undefined: still unhandled
  })
```

Another guaranteed recovery matcher is still required.

### 14.4 Catch-all boundary handling

```ts
const user = await runtime
  .run(getUserFromPostgres, { id: "123" })
  .with(P._, error => fallbackUserFor(error))
```

The handler must not include `undefined` in its return type for the catch-all to make the run awaitable.

### 14.5 No public union of success and failure

`runtime.run` never resolves to `Result | Errors`.

This eliminates ambiguity and permits primitive or overlapping success/error types. The final awaited value is always a success value produced either by the Flow or by a `.with(...)` handler.

---

## 15. Full example

### 15.1 Domain types

```ts
interface User {
  id: string
  name: string
}

interface Settings {
  theme: "light" | "dark"
}

interface Profile {
  user: User
  settings: Settings
  bio: string
}

type DatabaseUnavailable = {
  type: "database-unavailable"
  retryAfter: number
}
```

### 15.2 Contracts and tokens

```ts
interface GetUserFlow extends Flow<"GetUserFlow"> {
  readonly id: "GetUserFlow"
  params: { id: string }
  result: User
  errors: "user-not-found" | DatabaseUnavailable
  requires: {
    database: Database
    logger: Logger
  }
  depends: {}
}

const GetUserFlow = flowContract<GetUserFlow>({
  id: "GetUserFlow",
  requires: ["database", "logger"],
})

interface GetSettingsFlow extends Flow<"GetSettingsFlow"> {
  readonly id: "GetSettingsFlow"
  params: { userId: string }
  result: Settings
  errors: "settings-not-found"
  requires: {
    settings: SettingsRepository
  }
  depends: {}
}

const GetSettingsFlow = flowContract<GetSettingsFlow>({
  id: "GetSettingsFlow",
  requires: ["settings"],
})

interface GetProfileFlow extends Flow<"GetProfileFlow"> {
  readonly id: "GetProfileFlow"
  params: { id: string }
  result: Profile

  // Only the failure introduced directly here.
  errors: "profile-not-found"

  requires: {
    profiles: ProfileRepository
  }

  depends: {
    getUser: GetUserFlow
    getSettings: GetSettingsFlow
  }
}

const GetProfileFlow = flowContract<GetProfileFlow>({
  id: "GetProfileFlow",
  requires: ["profiles"],
})
```

### 15.3 Implementations

```ts
const postgresGetUser = flow(
  GetUserFlow,
  { depends: {} },
  async (
    { id },
    { database, logger },
    {},
    { fail },
  ) => {
    logger.info("Getting user", { id })

    let user: User | null

    try {
      user = await database.users.find(id)
    } catch (cause) {
      return fail({
        type: "database-unavailable",
        retryAfter: 30,
      })
    }

    if (!user) {
      return fail("user-not-found")
    }

    return user
  },
)

const databaseGetSettings = flow(
  GetSettingsFlow,
  { depends: {} },
  async (
    { userId },
    { settings },
    {},
    { fail },
  ) => {
    const value = await settings.findByUser(userId)

    if (!value) {
      return fail("settings-not-found")
    }

    return value
  },
)

const getProfile = flow(
  GetProfileFlow,
  {
    depends: {
      getUser: GetUserFlow,
      getSettings: GetSettingsFlow,
    },
  },
  async (
    { id },
    { profiles },
    { getUser, getSettings },
    { fail },
  ) => {
    const user = await getUser({ id }).with(
      "user-not-found",
      () => ({ id, name: "Anonymous" }),
    )

    const settings = await getSettings({
      userId: user.id,
    })

    const storedProfile = await profiles.findByUser(user.id)

    if (!storedProfile) {
      return fail("profile-not-found")
    }

    return {
      user,
      settings,
      bio: storedProfile.bio,
    }
  },
)
```

Even though this implementation handles `"user-not-found"`, the conservative effective error set of `GetProfileFlow` still includes it.

### 15.4 Incremental runtime

```ts
const baseRuntime = createRuntime({
  logger,
})

const infrastructureRuntime = baseRuntime.provide({
  database,
  settings,
})

const applicationRuntime = infrastructureRuntime
  .provideFlow(GetUserFlow, postgresGetUser)
  .provideFlow(GetSettingsFlow, databaseGetSettings)
```

`profiles` is still missing, so it is supplied for one execution:

```ts
const profile = await applicationRuntime
  .run(
    getProfile,
    { id: "user-123" },
    { profiles },
  )
  .with("profile-not-found", () => defaultProfile)
  .with("user-not-found", () => defaultProfile)
  .with("settings-not-found", () => defaultProfile)
  .with(
    { type: "database-unavailable" },
    async error => loadCachedProfile(error.retryAfter),
  )
```

Every conservative effective error is handled at the boundary.

### 15.5 Test override

```ts
const testRuntime = applicationRuntime
  .override({
    logger: testLogger,
    database: fakeDatabase,
  })
  .overrideFlow(GetUserFlow, inMemoryGetUser)

const profile = await testRuntime
  .run(getProfile, { id: "test-user" }, { profiles: fakeProfiles })
  .with(P._, () => testDefaultProfile)
```

The production runtime remains unchanged.

---

## 16. Public API surface for v1

The intended minimal public API is:

```ts
export interface Flow { /* phantom/type-level contract */ }

export function flowContract<F extends Flow>(
  metadata: {
    id: F["id"]
    requires: ExactKeyTuple<F["requires"]>
  },
): FlowContractToken<F>

export function flow<
  F extends Flow,
  D extends DependencyTokenMap<F["depends"]>,
>(
  contract: FlowContractToken<F>,
  options: {
    depends: Exact<DependencyTokenMap<F["depends"]>, D>
  },
  implementation: FlowHandler<F>,
): FlowImplementation<F, D>

export function createRuntime<Services extends object>(
  services: Services,
): Runtime<Services, {}>

export { P } from "ts-pattern"
```

Runtime methods:

```ts
runtime.provide(services)
runtime.override(services)
runtime.provideFlow(token, implementation)
runtime.overrideFlow(token, implementation)
runtime.run(rootImplementation, params, missingServices?)
```

Call/run builder method:

```ts
.with(pattern, handler)
```

Flow-local tool:

```ts
fail(error)
```

No additional combinators are part of v1.

---

## 17. Runtime execution algorithm

### 17.1 Preparing a run

When `runtime.run(root, params, perRunServices)` is called:

1. create a new execution environment by combining configured and per-run services;
2. verify no per-run service attempts to override a configured service;
3. verify all effective service requirements are present;
4. resolve every transitive Flow token to a registered implementation;
5. detect missing registrations;
6. detect dependency cycles;
7. create bound callable Flow dependencies for the root;
8. create and return a lazy immutable `RunBuilder` containing the computation thunk and zero handlers.

V1 uses **lazy, single-execution builders**:

- calling `runtime.run(...)` or a bound Flow does not execute application code;
- each `.with(...)` synchronously returns a new immutable builder with one additional handler; the previous builder remains valid and unchanged;
- execution starts on the first valid `then`/`await` of that particular builder;
- each builder memoizes its execution promise, so repeated awaits execute at most once and return the same settlement;
- an incomplete run builder's poisoned `then` prevents execution through typed `await`;
- a bound Flow call is always awaitable because unmatched failures have a parent propagation target;
- adding `.with(...)` after another branched builder has started creates an independent builder execution; branching is supported but each branch represents a separate execution;
- handlers are frozen for a builder before its execution starts, eliminating settlement/registration races and eager unhandled-rejection hazards.

### 17.2 Executing a Flow implementation

1. construct the service object visible to that contract;
2. construct its bound dependency object from `depends` aliases;
3. construct `{ fail }` scoped to the contract's own errors;
4. call the implementation;
5. treat a normal resolved value as success;
6. catch only the private `FlowFailure` signal as a typed failure;
7. let unexpected exceptions escape as defects.

### 17.3 Resolving a call/run builder failure

For a typed failure:

1. inspect `.with(...)` handlers in declaration order;
2. use `ts-pattern`-compatible matching against the raw error value;
3. when a pattern does not match, continue;
4. when a pattern matches, invoke its handler;
5. if the handler returns a non-`undefined` value, resolve as local success;
6. if it returns `undefined`, propagate the original failure;
7. if it invokes `fail`, propagate the new private failure;
8. if no handler matches, propagate the original failure.

Inside another Flow, propagation reaches the parent implementation. At the runtime boundary, static typing should prevent remaining typed failures. A dynamic safety check must still produce a clear defect if an unhandled typed failure reaches the boundary through `any` or other type-system escape hatches.

---

## 18. Defects versus typed failures

The library must not convert arbitrary exceptions into declared Flow errors.

Application code must not place `fail(...)` or awaited bound Flow calls inside a broad `try/catch` that maps every caught value, because the catch would also intercept the library's private propagation signal. Restrict `try/catch` to the external operation that may throw:

```ts
let user: User | null

try {
  user = await database.users.find(id)
} catch (cause) {
  return fail({ type: "database-unavailable", cause })
}

if (!user) {
  return fail("user-not-found")
}
```

V1 does not expose the private signal for manual rethrow guards. The implementation must document this rule and linting support may be considered later.

### Typed failure

Created only by `fail(...)` or propagated from another Flow.

```ts
return fail("user-not-found")
```

### Defect

Unexpected programming or infrastructure exception not explicitly mapped by application code.

```ts
throw new TypeError("invalid internal state")
```

Defects should reject the underlying Promise or be surfaced through a clearly separate runtime defect mechanism. They must not enter `.with(...)` as if they were members of `Flow["errors"]`.

Application code may deliberately map a caught exception to a typed failure:

```ts
try {
  return await database.query()
} catch (cause) {
  return fail({
    type: "database-unavailable",
    cause,
  })
}
```

---

## 19. Testing requirements

The examples in §15 are normative API-shape examples but intentionally omit trivial fixture implementations and imports for readability. During implementation, add `examples/complete-profile.ts` as a self-contained, CI-checked executable counterpart containing every service interface, fake implementation, token, Flow, runtime value, fallback, and import. The acceptance criterion “public examples compile and run” applies to that complete example and to extracted documentation snippets compiled as fixtures.

### 19.1 Type tests

Use a dedicated TypeScript type-test tool or compile fixtures with `@ts-expect-error`.

Required cases:

1. `params` inference in implementations and calls;
2. service destructuring inference;
3. bound Flow dependency inference;
4. `fail` accepts own declared errors;
5. `fail` rejects undeclared errors;
6. normal implementation return must satisfy `result`;
7. `depends` aliases must exactly match the contract;
8. `provide` only adds missing keys;
9. `override` only replaces existing compatible keys;
10. `provideFlow` rejects incompatible implementations;
11. `overrideFlow` rejects incompatible replacements;
12. missing service argument is required by `run`;
13. third `run` argument disappears when all services are configured;
14. missing transitive Flow registration prevents valid run;
15. effective errors include all transitive dependency errors;
16. `.with` narrows handler input from literals;
17. `.with` narrows discriminated object variants;
18. guaranteed recovery removes covered remaining errors;
19. `undefined`-possible recovery does not remove errors;
20. `Promise<Result>` recovery is supported;
21. `Promise<undefined>` does not consume errors;
22. incomplete boundary run cannot be awaited;
23. exhaustive boundary run can be awaited;
24. catch-all `P._` can complete handling;
25. primitive results are valid;
26. overlapping success/error types are valid because `fail` is explicit.

Additional mandatory type fixtures:

27. two structurally identical contracts with different ids remain distinct;
28. duplicate contract ids are rejected by runtime registry APIs;
29. exact dependency maps reject extra aliases supplied through variables;
30. value-level `requires` key tuples reject missing, duplicate, and extra keys;
31. bare `await` of an incomplete run specifically produces TS1320;
32. graph diamonds merge compatible requirements/errors without false cycle detection;
33. real cycles produce a branded diagnostic;
34. depth exhaustion produces a diagnostic rather than a truncated type;
35. same-key mutually assignable services merge;
36. same-key one-way-assignable services conflict under v1's strict rule.

37. optional, index-signature, symbol-key, and number-key `requires` shapes are rejected;
38. configured provider values are assignable to the effective requirement while unused configured keys are accepted.

### 19.2 Runtime unit tests

Required cases:

1. success value passes through unchanged;
2. `fail` interrupts the current implementation;
3. unmatched dependency failure propagates automatically;
4. literal `.with` recovery works;
5. nested object `.with` recovery works;
6. first matching handler wins;
7. handler returning `undefined` propagates original failure;
8. async handler recovery works;
9. async handler returning `undefined` propagates;
10. handler calling `fail` maps to a new failure;
11. normal unexpected exception remains a defect;
12. configured services are injected;
13. per-run services are injected transitively;
14. `provide` is immutable;
15. `override` is immutable;
16. `provideFlow` is immutable;
17. `overrideFlow` is immutable;
18. nested bound Flows use the current environment;
19. missing registration produces readable diagnostics;
20. missing runtime service produces readable diagnostics when types are bypassed;
21. duplicate `provide` is rejected dynamically when types are bypassed;
22. dependency cycles are detected;
23. unhandled boundary failure produces a safety defect when types are bypassed.

Additional mandatory runtime cases:

24. contract tokens expose exact declared service-key metadata;
25. injected service objects contain only direct declared keys;
26. distinct token objects reusing one literal id are rejected;
27. broad application catches are documented and a fixture demonstrates accidental private-signal interception;
28. lazy builders do not execute before first await;
29. repeated awaits of one builder execute exactly once;
30. branching from one builder creates independent executions;
31. every guaranteed v1 `ts-pattern` pattern category matches correctly;
32. extra per-run keys and attempts to override configured keys are rejected dynamically when `any` bypasses types; unused configured runtime keys remain valid.

### 19.3 Integration tests

Build at least one three-level graph:

```text
RootFlow
  -> ChildFlow
      -> GrandchildFlow
```

Verify:

- recursive service calculation;
- recursive implementation resolution;
- conservative recursive errors;
- failure handling at child and boundary levels;
- service and Flow overrides in tests.

---

## 20. Diagnostics and developer experience

Type errors should use branded diagnostic helper types where practical instead of collapsing to `never` without context.

Desired conceptual diagnostics include:

```ts
MissingServices<{
  database: Database
  cache: Cache
}>
```

```ts
MissingFlowImplementations<GetUserFlow | GetSettingsFlow>
```

```ts
IncompatibleService<
  "database",
  ExpectedDatabase,
  ProvidedDatabase
>
```

```ts
UnhandledFlowErrors<
  "user-not-found" | DatabaseUnavailable
>
```

Runtime diagnostics must include contract display names and dependency paths.

The implementation should optimize for useful editor autocomplete:

- service names visible in the second argument;
- dependency aliases visible in the third argument;
- `fail` errors suggested from own errors;
- `.with` patterns constrained to remaining effective errors;
- handler input narrowed to matched errors.

---

## 21. Performance and lifecycle

V1 does not define resource acquisition/release, scopes, cancellation, retries, concurrency combinators, or tracing.

The runtime may cache resolved dependency graphs per immutable runtime/root implementation pair, but correctness must not depend on caching.

Flow implementations should be treated as reusable stateless definitions. Execution-specific state belongs in params, per-run services, or services designed for that scope.

---

## 22. Non-goals for v1

The following are explicitly outside this version:

- generators or `yield` syntax;
- EffectTS API compatibility;
- automatic retries, timeouts, racing, batching, or scheduling;
- resource scopes/finalizers;
- cancellation semantics;
- tracing and metrics integrations;
- dependency auto-discovery by inspecting function bodies;
- returning `Result | Error` unions from `runtime.run`;
- optional `fail` based on runtime value classification;
- implementation-specific service/dependency contracts for the same abstract Flow token;
- automatic removal of internally handled dependency errors from the public contract;
- mutable runtimes;
- global service locators;
- calling undeclared Flow dependencies;
- direct arbitrary Flow invocation from a generic `call` tool;
- recovering a `.with` handler to successful `undefined`.

---

## 23. Versioning and design variants

This specification is intentionally versioned so alternative semantics can be tested without rewriting history.

### 23.1 Variant identity

This document defines:

```text
v1-conservative-contract
```

Its defining choices are:

- conservative transitive public errors;
- abstract Flow tokens with replaceable implementations;
- contract-level `requires` and `depends` shared by all implementations;
- bound dependency calls;
- a single `.with(...)` matching method;
- `undefined` from handlers means propagation;
- mandatory `fail(...)` for new typed failures;
- exhaustive boundary handling;
- immutable incremental runtime configuration.

### 23.2 Future variant candidates

Potential experiments should receive separate documents, for example:

- `v2-implementation-specific-requirements`;
- `v2-precise-exposed-errors`;
- `v2-explicit-success-sentinel`;
- `v2-discriminated-boundary-exit`;
- `v2-token-root-execution`.

A new experiment must not silently edit the semantic meaning of this variant. Corrections to ambiguity may increment the document patch version; semantic changes require a new variant or major document version.

### 23.3 Suggested changelog policy

Add a changelog section to this document for non-semantic clarifications. Fork a new file for semantic alternatives.

---

## 24. Implementation sequence

The eventual implementation plan should proceed in this order:

1. scaffold a strict TypeScript library with type tests;
2. implement core contract/token phantom types;
3. implement `flow` and `fail` with private failure signaling;
4. implement runtime service `provide` and `override`;
5. implement Flow registry `provideFlow` and `overrideFlow`;
6. implement bound dependency resolution and cycle detection;
7. implement conservative `EffectiveErrorsOf` and `EffectiveRequirementsOf`;
8. spike stable `ts-pattern` type integration;
9. implement call/run builders and `.with(...)`;
10. enforce exhaustive boundary awaitability;
11. add compile-time diagnostics;
12. complete runtime, type, and integration tests;
13. document the public API with runnable examples.

The pattern-matching type spike should happen before polishing public builder types, because it is the highest technical-risk area.

---

## 25. Acceptance criteria

The v1 implementation is complete only when all statements below are true.

### Contracts and implementations

- [ ] A Flow contract can be declared independently of implementations.
- [ ] A runtime token represents that contract.
- [ ] Two or more compatible implementations can implement the same contract.
- [ ] A consumer depends on a contract type/token, not `typeof` an implementation.

### Dependency injection

- [ ] Services are injected as a named object argument.
- [ ] Flow dependencies are injected as named bound callable functions.
- [ ] Transitive services are calculated recursively.
- [ ] Transitive Flow registrations are checked recursively.
- [ ] `provide` adds services immutably.
- [ ] `override` replaces services immutably.
- [ ] `provideFlow` adds bindings immutably.
- [ ] `overrideFlow` replaces bindings immutably.
- [ ] `run` requires only services not already configured.

### Failures

- [ ] New typed failures require `fail`.
- [ ] `fail` only accepts own declared errors.
- [ ] Dependency failures propagate without manual code.
- [ ] Effective errors conservatively include all transitive dependency errors.
- [ ] Defects remain separate from typed failures.

### Pattern matching

- [ ] `.with` accepts literal and structural patterns.
- [ ] Handler input is narrowed.
- [ ] Non-`undefined` handler output becomes local success.
- [ ] `undefined` output propagates the original failure.
- [ ] Promise-returning handlers are supported.
- [ ] Handler `fail` can map to a new own failure.
- [ ] Advanced patterns are conservative when exact subtraction is impossible.

### Boundary

- [ ] `runtime.run` supports the same `.with` API.
- [ ] An incomplete run cannot be awaited as success.
- [ ] An exhaustive run resolves only to a success value.
- [ ] Primitive and overlapping success/error types are safe.

### Quality

- [ ] Strict type tests cover the required cases.
- [ ] Runtime tests cover propagation, matching, DI, overrides, and defects.
- [ ] Diagnostics identify missing services, registrations, conflicts, cycles, and unhandled errors.
- [ ] The complete CI example compiles and runs, and documentation snippets compile as fixtures.

---

## 26. Changelog

### 1.0.0 — 2026-08-10

Initial approved baseline for the `v1-conservative-contract` design variant.
