# Basic Brick example

This executable example uses only public exports from `brickflow`. It demonstrates:

- named `Brick<{ ... }>` type aliases whose supported contract fields are discoverable through autocomplete and whose empty optional sections use precise defaults;
- immutable implementations created by `brick<Contract>(handler)` without classes, `new`, or runtime requirement tuples;
- an in-memory `UserRepository` supplied structurally through a `Layer`;
- `GetGreetingBrick` calling its `getUser` dependency through the matching public Layer entry key;
- typed `user-not-found` recovery with `.with(...)`;
- direct Layer-bound `.run(...)` calls using the default local Worker; and
- a structural `approve` request/response signal handled at the Worker boundary.

Dependency aliases are runtime and durable names. Renaming the `getUser` Layer entry also changes dependency resolution and its durable path.

Provider requirements are statically validated during composition. Brick implementations receive the full effective provider environment at runtime; erased contracts do not prevalidate missing provider keys dynamically.

Run it from repository root:

```bash
bun run --cwd examples/basic start
```

Run tests with:

```bash
bun test examples/basic
```
