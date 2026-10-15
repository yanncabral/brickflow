import { AsyncLocalStorage } from 'node:async_hooks'

export const brickExecutionScope = new AsyncLocalStorage<true>()
