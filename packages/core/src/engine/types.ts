import type { ExecutionContext } from './execution-context'

export type EngineStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface EngineSignalRequest {
  readonly name: string
  readonly request: unknown
}

export type EngineExecutionResult<Result, Error> =
  | { readonly ok: true; readonly value: Result }
  | { readonly ok: false; readonly error: Error }

/**
 * Per-brick step runner supplied by a durable Worker.
 *
 * Core invokes it once per executed Brick node with a deterministic step
 * name (see `toDurableStepName`); the runner persists a checkpoint for the
 * step and skips re-execution when a checkpoint already exists. The wrapped
 * `run` closes over exactly one Brick handler invocation, including its
 * plugin lifecycle, so a skipped step emits no plugin events either.
 */
export type EngineStepRunner = <Result>(
  stepName: string,
  run: () => Promise<Result>
) => Promise<Result>

export interface EngineExecutionRequest<_Result = unknown, _Error = unknown> {
  readonly id: string
  readonly brickId?: string
  readonly params: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly context: ExecutionContext
  readonly execute: () => Promise<EngineExecutionResult<_Result, _Error>>
  readonly signal: (signal: EngineSignalRequest) => Promise<unknown>
  /**
   * Late-bound per-brick step runner. Durable workers assign this before
   * invoking `execute()`; core reads it when `execute()` runs. Absent for
   * the LocalWorker, which executes every node inline. Engine-neutral: core
   * never interprets the name beyond determinism.
   */
  step?: EngineStepRunner | undefined
}

export interface EngineExecutionHandle<Result = unknown, Error = unknown> {
  readonly id: string
  readonly result: Promise<EngineExecutionResult<Result, Error>>
  readonly status: () => Promise<EngineStatus>
  readonly cancel: (reason?: string) => Promise<void>
  readonly signal: (signal: EngineSignalRequest) => Promise<unknown>
}
