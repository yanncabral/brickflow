# Basic Flow example

This executable example uses only public exports from `@flow/core` and `@flow/engine-local`. It demonstrates:

- `interface X extends Flow` contracts with omitted empty defaults;
- immutable implementations created by `flow<X>(handler)` without classes, `new`, or runtime requirement tuples;
- an in-memory `UserRepository` supplied structurally through a `Layer`;
- `GetGreetingFlow` calling its `getUser` dependency through the matching public Layer entry key;
- typed `user-not-found` recovery with `.with(...)`; and
- a structural `approve` request/response signal handled at the `Worker` boundary.

Dependency aliases are runtime and durable names. Renaming the `getUser` Layer entry also changes dependency resolution and its durable path.

Provider requirements are statically validated during composition. Flow implementations receive the full effective provider environment at runtime; this interface-only variant does not prevalidate missing provider keys dynamically.

Run it from repository root:

```bash
bun run --cwd examples/basic start
```

Run tests with:

```bash
bun test examples/basic
```
