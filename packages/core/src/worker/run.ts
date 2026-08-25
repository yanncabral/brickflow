import { isMatching } from 'ts-pattern'
import type { EngineExecutionHandle, EngineExecutionResult } from '../engine/types'
import type { SupportedPattern } from '../matching/types'
import type { BrickRun } from './types'

interface RegisteredHandler {
  readonly pattern: SupportedPattern<unknown>
  readonly handler: (error: never) => unknown | Promise<unknown>
}

export class UnhandledBrickFailureError extends Error {
  readonly failure: unknown

  constructor(failure: unknown) {
    super(`Unhandled Brick failure: ${readableFailure(failure)}`)
    this.name = 'UnhandledBrickFailureError'
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

class BrickRunImplementation<Error, InitialSuccess, LocalResult, RemainingError> {
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
    return new BrickRunImplementation(this.#handle, [
      ...this.#handlers,
      { pattern: pattern as SupportedPattern<unknown>, handler }
    ])
  }

  // biome-ignore lint/suspicious/noThenProperty: exhaustive BrickRun values are intentionally PromiseLike
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
      throw new UnhandledBrickFailureError(outcome.error)
    }

    throw new UnhandledBrickFailureError(outcome.error)
  }
}

export function createBrickRun<Error, Success>(
  handle: EngineExecutionHandle<Success, Error>
): BrickRun<Error, Success> {
  return new BrickRunImplementation<Error, Success, Success, Error>(handle) as unknown as BrickRun<
    Error,
    Success
  >
}
