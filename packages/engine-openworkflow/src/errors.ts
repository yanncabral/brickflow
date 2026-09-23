/** Errors raised by the OpenWorkflow durable Worker adapter. */

export class DuplicateOpenWorkflowRunIdError extends Error {
  readonly runId: string

  constructor(runId: string) {
    super(`OpenWorkflow run ID "${runId}" already exists`)
    this.name = 'DuplicateOpenWorkflowRunIdError'
    this.runId = runId
  }
}

export class OpenWorkflowRunCancelledError extends Error {
  readonly runId: string
  readonly reason: string | undefined

  constructor(runId: string, reason?: string) {
    super(
      reason === undefined
        ? `OpenWorkflow run "${runId}" was cancelled`
        : `OpenWorkflow run "${runId}" was cancelled: ${reason}`
    )
    this.name = 'OpenWorkflowRunCancelledError'
    this.runId = runId
    this.reason = reason
  }
}

export class OpenWorkflowWorkerClosedError extends Error {
  constructor() {
    super('OpenWorkflowWorker is closed')
    this.name = 'OpenWorkflowWorkerClosedError'
  }
}

export class OpenWorkflowRunTimeoutError extends Error {
  readonly runId: string

  constructor(runId: string, timeoutMs: number) {
    super(`Timed out waiting for OpenWorkflow run "${runId}" after ${timeoutMs}ms`)
    this.name = 'OpenWorkflowRunTimeoutError'
    this.runId = runId
  }
}

/**
 * Thrown inside a replayed workflow step when no in-process executor is
 * registered for the run. In-flight (non-checkpointed) runs can only resume
 * in a process that still holds the brick closure; completed runs resume
 * from the persisted checkpoint without needing the closure.
 */
export class MissingOpenWorkflowExecutorError extends Error {
  readonly runId: string

  constructor(runId: string) {
    super(
      `No in-process executor for OpenWorkflow run "${runId}". ` +
        'In-flight runs resume only where the brick closure is still registered.'
    )
    this.name = 'MissingOpenWorkflowExecutorError'
    this.runId = runId
  }
}
