import type { EngineExecutionHandle, EngineExecutionRequest } from './types'

export interface Engine {
  start<Result, Error>(
    request: EngineExecutionRequest<Result, Error>
  ): EngineExecutionHandle<Result, Error>
}

export function isEngine(value: unknown): value is Engine {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'start') === 'function'
  )
}
