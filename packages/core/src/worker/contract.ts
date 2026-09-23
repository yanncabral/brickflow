import type { EngineExecutionHandle, EngineExecutionRequest } from '../engine/types'
import type { BrickPlugin } from '../plugin/types'

export interface Worker {
  readonly plugins?: readonly BrickPlugin[]
  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure>
}
