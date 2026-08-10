import type {
  EngineExecutionHandle,
  EngineExecutionRequest,
  EngineExecutionResult,
  EngineStatus
} from '@flow/core'
import { LocalRunCancelledError } from './errors'

export class LocalRun<Result, Failure> implements EngineExecutionHandle<Result, Failure> {
  readonly id: string
  readonly result: Promise<EngineExecutionResult<Result, Failure>>
  private currentStatus: EngineStatus = 'queued'
  private cancellation: LocalRunCancelledError | undefined
  private rejectResult!: (error: unknown) => void

  constructor(private readonly request: EngineExecutionRequest<Result, Failure>) {
    this.id = request.id
    this.result = new Promise<EngineExecutionResult<Result, Failure>>((resolve, reject) => {
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

  async signal(
    signal: Parameters<EngineExecutionRequest<Result, Failure>['signal']>[0]
  ): Promise<unknown> {
    if (this.cancellation !== undefined) throw this.cancellation
    return this.request.signal(signal)
  }
}
