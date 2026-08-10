import type { ExecutionContext } from './execution-context'

export type EngineStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface EngineSignalRequest {
  readonly name: string
  readonly request: unknown
}

export type EngineExecutionResult<Result, Error> =
  | { readonly ok: true; readonly value: Result }
  | { readonly ok: false; readonly error: Error }

export interface EngineExecutionRequest<_Result = unknown, _Error = unknown> {
  readonly id: string
  readonly flowId: string
  readonly params: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly context: ExecutionContext
  readonly execute: () => Promise<EngineExecutionResult<_Result, _Error>>
  readonly signal: (signal: EngineSignalRequest) => Promise<unknown>
}

export interface EngineExecutionHandle<Result = unknown, Error = unknown> {
  readonly id: string
  readonly result: Promise<EngineExecutionResult<Result, Error>>
  readonly status: () => Promise<EngineStatus>
  readonly cancel: (reason?: string) => Promise<void>
  readonly signal: (signal: EngineSignalRequest) => Promise<unknown>
}
