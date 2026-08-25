# Direct Flow Execution — Design Specification

- **Status:** Approved for implementation
- **Date:** 2026-08-21
- **Design variant:** `direct-flow-execution`

## Purpose

Make every Flow directly executable while keeping Layer optional. A Layer remains an immutable grouping and configuration mechanism: it organizes Flows, supplies reusable requirements, resolves scoped aliases, and contributes durable identity. It is not required merely to execute a Flow.

The core package owns the Worker contract and the simplest local Worker implementation. External adapters import the contract and provide alternate Workers, such as OpenWorkflow-backed durable execution.

## Public API

### Direct Flow execution

`flow<F>(handler)` returns an immutable implementation with a typed `.run(...)` method:

```ts
await getGreeting.run(
  { id: 'ada' },
  {
    requirements: {
      userRepository
    },
    dependencies: {
      getUser
    }
  }
)
```

The first argument is `ParamsOf<F>`.

The second argument uses explicit namespaces:

- `requirements`: all effective structural requirements not already supplied by a bound Layer;
- `dependencies`: concrete Flow implementations for all effective dependency aliases not already supplied by a bound Layer;
- `signals`: required boundary signal handlers;
- `worker`: optional Worker implementation, defaulting to the core local Worker;
- `id`: optional execution ID;
- `metadata`: optional execution metadata.

The argument is optional only when no required configuration remains. Its type accepts only applicable configuration and requires every unresolved effective requirement, dependency alias, and boundary signal handler.

Direct dependencies are flattened transitively by alias:

```ts
await placeOrder.run(params, {
  requirements: {
    paymentGateway,
    fraudClient
  },
  dependencies: {
    chargePayment,
    detectFraud
  }
})
```

Aliases reused with incompatible Flow contracts produce a type error. Incompatible structural requirements retain the existing `RequirementConflict` behavior. Consumers that need different implementations for the same alias in different scopes use a Layer.

### Layer-bound Flow execution

Layer entries expose bound views with the same `.run(...)` API:

```ts
const users = new Layer('users', {
  getUser,
  getGreeting
}).provide({
  userRepository
})

await users.getGreeting.run({ id: 'ada' })
```

A bound view carries:

- the selected root Flow;
- the containing Layer graph;
- the Layer's effective providers;
- dependency resolution scope;
- the complete durable path.

The original Flow implementation is never mutated. The same Flow may be bound to multiple Layers with different providers:

```ts
await production.getUser.run({ id })
await testing.getUser.run({ id })
await getUser.run({ id }, { requirements: { userRepository } })
```

Nested Layers preserve navigable bound entries and durable identity:

```ts
await app.users.getUser.run({ id })
// durable Flow ID: app.users.getUser
```

A partially configured Layer requires only the configuration still unresolved by that Layer.

## Worker model

Core exports a Worker interface used by `.run(...)`. It also supplies the default local Worker implementation.

The local Worker:

- executes in the current JavaScript process and event loop;
- schedules execution with `queueMicrotask`;
- preserves typed Flow failures as structured execution results;
- supports execution IDs, metadata, status, signals, and cooperative cancellation;
- does not provide CPU isolation or preemptive cancellation.

External packages implement the same Worker interface. Selecting one is a run option:

```ts
await app.orders.placeOrder.run(params, {
  worker: openWorkflowWorker
})
```

`packages/engine-local` is removed because its behavior becomes the core default rather than an external integration. A future thread-isolated implementation may live in a separate adapter without changing Flow or Layer APIs.

## Runtime resolution

Direct execution creates an anonymous execution graph from the root implementation and the `dependencies` map. Layer-bound execution uses the bound Layer graph. Both paths feed the same internal execution resolver and produce the same `FlowRun` recovery API.

The existing failure behavior remains:

```ts
const user = await users.getUser
  .run({ id })
  .with('user-not-found', () => anonymousUser)
```

Dependency failures propagate automatically. Unexpected defects reject execution rather than entering the typed domain-failure channel.

## Immutability and identity

Flow implementations, Layers, bound Flow views, and provider maps remain immutable.

A direct Flow run has a stable default Flow identity derived without inventing a Layer path. A Layer-bound run uses the complete Layer entry path. Durable Workers may impose stricter identity requirements and reject direct runs when an explicit stable identity is unavailable; this must be represented by the Worker adapter rather than by coupling core Flow contracts to a concrete engine.

## Compatibility

The former explicit construction:

```ts
const worker = new Worker({ engine: new LocalEngine(), layer: users })
await worker.run(getUser, params)
```

is replaced by:

```ts
await users.getUser.run(params)
```

The standalone `engine-local` package and its example imports are removed. Engine-neutral execution contracts remain in core, but the public abstraction is Worker-oriented: Workers decide where and how execution runs.

## Testing

Tests must cover:

1. direct execution without requirements or dependencies;
2. direct execution requiring structural requirements;
3. flattened direct dependency graphs;
4. compile-time rejection of missing or incompatible configuration;
5. bound Layer execution and partial Layer configuration;
6. nested Layer navigation and durable IDs;
7. one Flow bound to multiple Layers without mutation;
8. local status, cancellation, duplicate IDs, signals, typed failures, and defects;
9. selection of a custom Worker;
10. removal of all `@flow/engine-local` usage;
11. unchanged exhaustive `.with(...)` recovery behavior.

## Non-goals

This change does not add worker-thread isolation, preemptive cancellation, runtime requirement metadata, automatic request-scoped dependency injection, or an OpenWorkflow implementation. Those remain separate adapter or design concerns.
