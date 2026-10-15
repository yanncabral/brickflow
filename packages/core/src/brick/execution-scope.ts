import { AsyncLocalStorage } from 'node:async_hooks'

export const brickExecutionScope = new AsyncLocalStorage<{
  active: boolean
  readonly failures: WeakMap<Error, unknown>
}>()
