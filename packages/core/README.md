# Brickflow

Brickflow is an experimental TypeScript library for typed domain failures, structural dependency injection, composable Layers, and request/response Signals. It ships with an in-process Worker.

## Install

```sh
npm install brickflow
```

Brickflow is ESM-only and includes TypeScript declarations.

## Quick start

```ts
import { type Brick, brick, Layer } from 'brickflow'

type Greet = Brick<{
  params: { name: string }
  result: string
  requires: { greeting: string }
}>

const greet = brick<Greet>(({ name }, { greeting }) => `${greeting}, ${name}!`)
const app = new Layer('app', { greet }).provide({ greeting: 'Hello' })

console.log(await app.greet({ name: 'Ada' })) // Hello, Ada!
```

Use `requires` for providers, `depends` for other Bricks, and `error` for domain failures callers can recover from with `.onError()`. Layers bind providers and resolve dependencies by alias.

See the [project guide and examples](https://github.com/yanncabral/brickflow#readme) for dependency composition, typed failure handling, and Signals.
