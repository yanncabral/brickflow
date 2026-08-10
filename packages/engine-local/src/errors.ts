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
