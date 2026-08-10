import type { Engine, EngineExecutionRequest } from '@flow/core'
import { DuplicateLocalRunIdError } from './errors'
import { LocalRun } from './local-run'

export class LocalEngine implements Engine {
  private readonly runIds = new Set<string>()

  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): LocalRun<Result, Failure> {
    if (this.runIds.has(request.id)) {
      throw new DuplicateLocalRunIdError(request.id)
    }
    this.runIds.add(request.id)
    return new LocalRun(request)
  }
}
