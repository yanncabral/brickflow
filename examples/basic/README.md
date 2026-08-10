# Basic Flow example

This executable example uses only the public package exports from `@flow/core` and
`@flow/engine-local`. It demonstrates:

- an in-memory `UserRepository` supplied structurally through a `Layer`;
- a `GetGreetingFlow` calling its bound `GetUserFlow` dependency;
- typed `user-not-found` recovery with `.with(...)`; and
- a structural `approve` request/response signal handled at the `Worker` boundary.

Run it from the repository root:

```bash
bun run --cwd examples/basic start
```

Run its tests with:

```bash
bun test examples/basic
```
