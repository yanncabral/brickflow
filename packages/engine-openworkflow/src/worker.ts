import type {
  EngineExecutionHandle,
  EngineExecutionRequest,
  EngineExecutionResult,
  EngineSignalRequest,
  EngineStatus,
  Worker
} from 'brickflow'
import { OpenWorkflow, type Worker as OpenWorkflowRunner, type Workflow } from 'openworkflow'
import type { Backend, WorkflowRun } from 'openworkflow/internal'
import { BackendSqlite } from 'openworkflow/sqlite'
import {
  DuplicateOpenWorkflowRunIdError,
  MissingOpenWorkflowExecutorError,
  OpenWorkflowRunCancelledError,
  OpenWorkflowRunTimeoutError,
  OpenWorkflowWorkerClosedError
} from './errors'
import {
  type DurableEnvelope,
  fromDurableEnvelope,
  rehydrateDefect,
  toDurableEnvelope
} from './serialization'
import { toStepName } from './step-name'

/** Workflow input persisted with each brick run. Must stay JSON-serializable. */
export interface BrickRunInput {
  readonly runId: string
  readonly step: string
}

export type OpenWorkflowBackendOption =
  | Backend
  | { readonly kind: 'sqlite'; readonly path?: string }

export interface OpenWorkflowWorkerOptions {
  /**
   * Durable backend. Defaults to an in-memory sqlite database, which suits
   * tests. For postgres, connect first and pass the instance:
   * `backend: await BackendPostgres.connect(url)`.
   */
  readonly backend?: OpenWorkflowBackendOption
  /** Registered workflow name. Defaults to `brickflow/brick-run`. */
  readonly workflowName?: string
  /** Max concurrent runs claimed by the embedded worker loop. */
  readonly concurrency?: number
  /** Result poll interval in ms. Defaults to 25. */
  readonly resultPollIntervalMs?: number
  /** Max wait for a run result in ms. Defaults to 30000. */
  readonly resultTimeoutMs?: number
}

const DEFAULT_WORKFLOW_NAME = 'brickflow/brick-run'
const IDEMPOTENCY_PREFIX = 'brickflow-run:'
const DEFAULT_POLL_INTERVAL_MS = 25
const DEFAULT_RESULT_TIMEOUT_MS = 30_000

type PendingExecutor = () => Promise<DurableEnvelope>

/**
 * In-process brick closures keyed by run id. Completed runs resume from the
 * persisted checkpoint without touching this map; it only serves replays of
 * in-flight runs after a worker restart in the same process.
 */
const pendingExecutors = new Map<string, PendingExecutor>()

function registerPendingExecutor(runId: string, executor: PendingExecutor): void {
  pendingExecutors.set(runId, executor)
}

function unregisterPendingExecutor(runId: string, executor: PendingExecutor): void {
  if (pendingExecutors.get(runId) === executor) pendingExecutors.delete(runId)
}

function invokePendingExecutor(runId: string): Promise<DurableEnvelope> {
  const executor = pendingExecutors.get(runId)
  if (executor === undefined) throw new MissingOpenWorkflowExecutorError(runId)
  return executor()
}

function isBackend(value: OpenWorkflowBackendOption): value is Backend {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createWorkflowRun' in value &&
    typeof (value as { createWorkflowRun?: unknown }).createWorkflowRun === 'function'
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class OpenWorkflowRun<Result, Failure> implements EngineExecutionHandle<Result, Failure> {
  readonly id: string
  readonly result: Promise<EngineExecutionResult<Result, Failure>>
  readonly workflowRunId: Promise<string>
  private resolveWorkflowRunId: (runId: string) => void = () => {}
  private owRunId: string | undefined
  private cancelled: OpenWorkflowRunCancelledError | undefined
  private terminalStatus: EngineStatus | undefined
  private exactResult: EngineExecutionResult<Result, Failure> | undefined
  private exactDefect: unknown
  private hasExactDefect = false

  constructor(
    private readonly owner: OpenWorkflowWorker,
    private readonly request: EngineExecutionRequest<Result, Failure>
  ) {
    this.id = request.id
    let resolveRunId!: (runId: string) => void
    this.workflowRunId = new Promise<string>((resolve) => {
      resolveRunId = resolve
    })
    this.resolveWorkflowRunId = resolveRunId
    this.result = this.drive()
  }

  async status(): Promise<EngineStatus> {
    if (this.cancelled !== undefined) return 'cancelled'
    if (this.terminalStatus !== undefined) return this.terminalStatus
    if (this.owRunId === undefined) return 'queued'
    try {
      const run = await this.owner.backend.getWorkflowRun({ workflowRunId: this.owRunId })
      if (!run) return 'queued'
      return this.describe(run)
    } catch {
      return this.terminalStatus ?? 'queued'
    }
  }

  async cancel(reason?: string): Promise<void> {
    if (
      this.cancelled !== undefined ||
      this.terminalStatus === 'completed' ||
      this.terminalStatus === 'failed'
    ) {
      return
    }
    this.cancelled = new OpenWorkflowRunCancelledError(this.request.id, reason)
    if (this.owRunId !== undefined) {
      try {
        await this.owner.client.cancelWorkflowRun(this.owRunId)
      } catch {
        // Best-effort: the driver loop still observes the cancelled flag.
      }
    }
  }

  async signal(signal: EngineSignalRequest): Promise<unknown> {
    if (this.cancelled !== undefined) throw this.cancelled
    return this.request.signal(signal)
  }

  private describe(run: WorkflowRun): EngineStatus {
    switch (run.status) {
      case 'pending':
        return 'queued'
      case 'running':
      case 'sleeping':
        return 'running'
      case 'completed':
      case 'succeeded': {
        try {
          const outcome = this.readOutcome(run.output)
          return outcome.ok ? 'completed' : 'failed'
        } catch {
          return 'failed'
        }
      }
      case 'failed':
        return 'failed'
      case 'canceled':
        return 'cancelled'
    }
  }

  private readOutcome(output: WorkflowRun['output']): EngineExecutionResult<Result, Failure> {
    if (this.exactResult !== undefined) return this.exactResult
    return fromDurableEnvelope(output) as EngineExecutionResult<Result, Failure>
  }

  private async drive(): Promise<EngineExecutionResult<Result, Failure>> {
    const stepName = toStepName(this.request.brickId, this.request.id)
    const executor: PendingExecutor = async () => {
      try {
        const outcome = await this.request.execute()
        this.exactResult = outcome
        return toDurableEnvelope(outcome)
      } catch (error) {
        this.exactDefect = error
        this.hasExactDefect = true
        throw error
      }
    }
    registerPendingExecutor(this.request.id, executor)
    try {
      await this.owner.ensureRunner()
      if (this.cancelled !== undefined) throw this.cancelled
      const owHandle = await this.owner.client.runWorkflow(
        this.owner.spec,
        { runId: this.request.id, step: stepName },
        { idempotencyKey: `${IDEMPOTENCY_PREFIX}${this.request.id}` }
      )
      this.owRunId = owHandle.workflowRun.id
      this.resolveWorkflowRunId(owHandle.workflowRun.id)
      if (this.cancelled !== undefined) {
        try {
          await this.owner.client.cancelWorkflowRun(owHandle.workflowRun.id)
        } catch {
          // The driver loop below still observes the cancelled flag.
        }
        throw this.cancelled
      }
      return await this.awaitOutcome()
    } finally {
      unregisterPendingExecutor(this.request.id, executor)
    }
  }

  private async awaitOutcome(): Promise<EngineExecutionResult<Result, Failure>> {
    const startedAt = Date.now()
    const timeoutMs = this.owner.resultTimeoutMs
    const owRunId = this.owRunId as string
    for (;;) {
      if (this.cancelled !== undefined) {
        this.terminalStatus = 'cancelled'
        throw this.cancelled
      }
      const run = await this.owner.backend.getWorkflowRun({ workflowRunId: owRunId })
      if (!run) throw new Error(`Workflow run ${owRunId} no longer exists`)
      switch (run.status) {
        case 'completed':
        case 'succeeded': {
          const outcome = this.readOutcome(run.output)
          this.terminalStatus = outcome.ok ? 'completed' : 'failed'
          return outcome
        }
        case 'failed': {
          this.terminalStatus = 'failed'
          if (this.hasExactDefect) throw this.exactDefect
          throw rehydrateDefect(run.error, `Brick run "${this.request.id}" failed`)
        }
        case 'canceled': {
          this.terminalStatus = 'cancelled'
          throw new OpenWorkflowRunCancelledError(this.request.id)
        }
        case 'pending':
        case 'running':
        case 'sleeping': {
          if (Date.now() - startedAt > timeoutMs) {
            throw new OpenWorkflowRunTimeoutError(this.request.id, timeoutMs)
          }
          await sleep(this.owner.resultPollIntervalMs)
          break
        }
      }
    }
  }
}

/**
 * Durable `Worker` backed by OpenWorkflow.
 *
 * Each engine request becomes one OpenWorkflow run with a single durable
 * step named from the Layer-bound `brickId` (or the run id for direct
 * runs). Typed failures persist as `{ ok: false, error }` step-output data;
 * unexpected defects fail the run and reject the handle. Replays of a
 * completed run id resolve from the persisted checkpoint without
 * re-executing the brick, so `replay: 'skip'` plugins never re-emit.
 */
export class OpenWorkflowWorker implements Worker {
  readonly backend: Backend
  readonly client: OpenWorkflow
  readonly spec: Workflow<BrickRunInput, DurableEnvelope, BrickRunInput>['spec']
  readonly resultPollIntervalMs: number
  readonly resultTimeoutMs: number
  private readonly ownsBackend: boolean
  private readonly concurrency: number
  private readonly runIds = new Set<string>()
  private readonly active = new Set<OpenWorkflowRun<unknown, unknown>>()
  private runner: OpenWorkflowRunner | undefined
  private runnerStarting: Promise<void> | undefined
  private closed = false

  constructor(options: OpenWorkflowWorkerOptions = {}) {
    const backendOption = options.backend
    if (backendOption !== undefined && isBackend(backendOption)) {
      this.backend = backendOption
      this.ownsBackend = false
    } else {
      const path =
        backendOption === undefined || typeof backendOption === 'string'
          ? undefined
          : (backendOption as { readonly path?: string }).path
      this.backend = BackendSqlite.connect(path ?? ':memory:')
      this.ownsBackend = true
    }
    this.client = new OpenWorkflow({ backend: this.backend })
    const workflowName = options.workflowName ?? DEFAULT_WORKFLOW_NAME
    const workflow = this.client.defineWorkflow<BrickRunInput, DurableEnvelope>(
      { name: workflowName, retryPolicy: { maximumAttempts: 1 } },
      async ({ input, step }) =>
        step.run({ name: input.step, retryPolicy: { maximumAttempts: 1 } }, () =>
          invokePendingExecutor(input.runId)
        )
    )
    this.spec = workflow.workflow.spec
    this.concurrency = options.concurrency ?? 1
    this.resultPollIntervalMs = options.resultPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.resultTimeoutMs = options.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS
  }

  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure> {
    if (this.closed) throw new OpenWorkflowWorkerClosedError()
    if (this.runIds.has(request.id)) throw new DuplicateOpenWorkflowRunIdError(request.id)
    this.runIds.add(request.id)
    const run = new OpenWorkflowRun<Result, Failure>(this, request)
    const tracked = run as OpenWorkflowRun<unknown, unknown>
    this.active.add(tracked)
    void run.result.then(
      () => {
        this.active.delete(tracked)
      },
      () => {
        this.active.delete(tracked)
      }
    )
    return run
  }

  /** Start the embedded OpenWorkflow worker loop (idempotent). */
  async ensureRunner(): Promise<void> {
    if (this.runner !== undefined) {
      if (this.runnerStarting !== undefined) await this.runnerStarting
      return
    }
    const runner = this.client.newWorker({ concurrency: this.concurrency })
    this.runner = runner
    this.runnerStarting = runner.start()
    await this.runnerStarting
  }

  /** Stop the worker loop and release an owned backend. */
  async close(): Promise<void> {
    this.closed = true
    for (const run of [...this.active]) {
      try {
        await run.cancel('worker closed')
      } catch {
        // Handles settle through their own driver loop.
      }
    }
    const runner = this.runner
    this.runner = undefined
    this.runnerStarting = undefined
    if (runner !== undefined) await runner.stop()
    if (this.ownsBackend) await this.backend.stop()
  }
}
