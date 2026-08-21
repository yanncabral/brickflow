import type {
  EngineExecutionHandle,
  EngineExecutionRequest,
  EngineExecutionResult,
  EngineStatus
} from '../engine/types'
import type { Worker } from './contract'

export class LocalRunCancelledError extends Error {
  readonly runId: string
  readonly reason: string | undefined

  constructor(runId: string, reason?: string) {
    super(
      reason === undefined
        ? `Local run "${runId}" was cancelled`
        : `Local run "${runId}" was cancelled: ${reason}`
    )
    this.name = 'LocalRunCancelledError'
    this.runId = runId
    this.reason = reason
  }
}

export class DuplicateLocalRunIdError extends Error {
  readonly runId: string

  constructor(runId: string) {
    super(`Local run ID "${runId}" already exists`)
    this.name = 'DuplicateLocalRunIdError'
    this.runId = runId
  }
}

class LocalRun<Result, Failure> implements EngineExecutionHandle<Result, Failure> {
  readonly id: string
  readonly result: Promise<EngineExecutionResult<Result, Failure>>
  private currentStatus: EngineStatus = 'queued'
  private cancellation: LocalRunCancelledError | undefined
  private rejectResult!: (error: unknown) => void

  constructor(private readonly request: EngineExecutionRequest<Result, Failure>) {
    this.id = request.id
    this.result = new Promise((resolve, reject) => {
      this.rejectResult = reject
      queueMicrotask(async () => {
        if (this.cancellation !== undefined) return
        this.currentStatus = 'running'
        try {
          const result = await this.request.execute()
          if (this.cancellation !== undefined) return
          this.currentStatus = result.ok ? 'completed' : 'failed'
          resolve(result)
        } catch (error) {
          if (this.cancellation !== undefined) return
          this.currentStatus = 'failed'
          reject(error)
        }
      })
    })
  }

  async status(): Promise<EngineStatus> {
    return this.currentStatus
  }

  async cancel(reason?: string): Promise<void> {
    if (
      this.cancellation !== undefined ||
      this.currentStatus === 'completed' ||
      this.currentStatus === 'failed'
    ) {
      return
    }
    this.cancellation = new LocalRunCancelledError(this.id, reason)
    this.currentStatus = 'cancelled'
    this.rejectResult(this.cancellation)
  }

  async signal(signal: Parameters<EngineExecutionRequest<Result, Failure>['signal']>[0]) {
    if (this.cancellation !== undefined) throw this.cancellation
    return this.request.signal(signal)
  }
}

export class LocalWorker implements Worker {
  private readonly runIds = new Set<string>()

  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure> {
    if (this.runIds.has(request.id)) throw new DuplicateLocalRunIdError(request.id)
    this.runIds.add(request.id)
    return new LocalRun(request)
  }
}

export const localWorker: Worker = new LocalWorker()
