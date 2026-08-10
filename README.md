# Flow

An experimental TypeScript library for typed failures, structural dependency injection, composable Layers, Signals, and engine-neutral local or durable Flow execution.

## Status

The repository currently contains the monorepo scaffold and versioned design documents. The public API is not implemented yet.

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

See `docs/superpowers/specs/` for versioned designs.
