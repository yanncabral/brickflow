import type { EngineExecutionHandle, EngineExecutionRequest } from '../engine/types'

export interface Worker {
  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure>
}
