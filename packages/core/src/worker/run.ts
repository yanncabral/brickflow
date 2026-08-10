import { isMatching } from 'ts-pattern'
import type { EngineExecutionHandle, EngineExecutionResult } from '../engine/types'
import type { SupportedPattern } from '../matching/types'
import type { FlowRun } from './types'

interface RegisteredHandler {
  readonly pattern: SupportedPattern<unknown>
  readonly handler: (error: never) => unknown | Promise<unknown>
}

export class UnhandledFlowFailureError extends Error {
  readonly failure: unknown

  constructor(failure: unknown) {
    super(`Unhandled Flow failure: ${readableFailure(failure)}`)
    this.name = 'UnhandledFlowFailureError'
    this.failure = failure
  }
}

function readableFailure(failure: unknown): string {
  if (typeof failure === 'string') return failure
  try {
    return JSON.stringify(failure)
  } catch {
    return String(failure)
  }
}

class FlowRunImplementation<Error, InitialSuccess, LocalResult, RemainingError> {
  readonly id: string
  readonly #handle: EngineExecutionHandle<InitialSuccess, Error>
  readonly #handlers: readonly RegisteredHandler[]
  #execution?: Promise<LocalResult>

  constructor(
    handle: EngineExecutionHandle<InitialSuccess, Error>,
    handlers: readonly RegisteredHandler[] = []
  ) {
    this.id = handle.id
    this.#handle = handle
    this.#handlers = Object.freeze([...handlers])
    Object.freeze(this)
  }

  status() {
    return this.#handle.status()
  }

  cancel(reason?: string) {
    return this.#handle.cancel(reason)
  }

  with(pattern: SupportedPattern<RemainingError>, handler: (error: never) => unknown) {
    return new FlowRunImplementation(this.#handle, [
      ...this.#handlers,
      { pattern: pattern as SupportedPattern<unknown>, handler }
    ])
  }

  // biome-ignore lint/suspicious/noThenProperty: exhaustive FlowRun values are intentionally PromiseLike
  then<TResult1 = LocalResult, TResult2 = never>(
    onfulfilled?: ((value: LocalResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.#execution ??= this.#execute()
    return this.#execution.then(onfulfilled, onrejected)
  }

  async #execute(): Promise<LocalResult> {
    const outcome: EngineExecutionResult<InitialSuccess, Error> = await this.#handle.result
    if (outcome.ok) return outcome.value as unknown as LocalResult

    for (const registered of this.#handlers) {
      if (!isMatching(registered.pattern)(outcome.error)) continue
      const recovered = await registered.handler(outcome.error as never)
      if (recovered !== undefined) return recovered as LocalResult
      throw new UnhandledFlowFailureError(outcome.error)
    }

    throw new UnhandledFlowFailureError(outcome.error)
  }
}

export function createFlowRun<Error, Success>(
  handle: EngineExecutionHandle<Success, Error>
): FlowRun<Error, Success> {
  return new FlowRunImplementation<Error, Success, Success, Error>(handle) as unknown as FlowRun<
    Error,
    Success
  >
}
