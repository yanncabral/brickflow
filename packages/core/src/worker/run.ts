import { isMatching } from 'ts-pattern'
import { brickExecutionScope } from '../brick/execution-scope'
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

class UnhandledRunFailure {
  constructor(readonly failure: unknown) {}
}

class BrickRunImplementation<Error, InitialSuccess, LocalResult, RemainingError> {
  readonly id: string
  readonly #handle: EngineExecutionHandle<InitialSuccess, Error>
  readonly #handlers: readonly RegisteredHandler[]
  readonly #successHandler: ((value: InitialSuccess) => unknown) | undefined
  #execution?: Promise<LocalResult>

  constructor(
    handle: EngineExecutionHandle<InitialSuccess, Error>,
    handlers: readonly RegisteredHandler[] = [],
    successHandler?: (value: InitialSuccess) => unknown
  ) {
    this.id = handle.id
    this.#handle = handle
    this.#handlers = Object.freeze([...handlers])
    this.#successHandler = successHandler
    Object.freeze(this)
  }

  status() {
    return this.#handle.status()
  }

  cancel(reason?: string) {
    return this.#handle.cancel(reason)
  }

  onSuccess(handler: (value: InitialSuccess) => unknown) {
    return new BrickRunImplementation(this.#handle, this.#handlers, handler)
  }

  onError(pattern: SupportedPattern<RemainingError>, handler: (error: never) => unknown) {
    return new BrickRunImplementation(
      this.#handle,
      [...this.#handlers, { pattern: pattern as SupportedPattern<unknown>, handler }],
      this.#successHandler
    )
  }

  onFailure(pattern: SupportedPattern<RemainingError>, handler: (error: never) => unknown) {
    return this.onError(pattern, handler)
  }

  with(pattern: SupportedPattern<RemainingError>, handler: (error: never) => unknown) {
    return this.onError(pattern, handler)
  }

  // biome-ignore lint/suspicious/noThenProperty: exhaustive BrickRun values are intentionally PromiseLike
  then<TResult1 = LocalResult, TResult2 = never>(
    onfulfilled?: ((value: LocalResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    const propagate = brickExecutionScope.getStore()
    this.#execution ??= this.#execute()
    return this.#execution
      .catch((error: unknown) => {
        if (!(error instanceof UnhandledRunFailure)) throw error
        const boundaryError = new UnhandledBrickFailureError(error.failure)
        // Only a rejection that reaches the owning handler becomes its domain failure.
        // Detached consumers always observe the documented public error.
        if (propagate?.active) propagate.failures.set(boundaryError, error.failure)
        throw boundaryError
      })
      .then(onfulfilled, onrejected)
  }

  async #execute(): Promise<LocalResult> {
    const outcome: EngineExecutionResult<InitialSuccess, Error> = await this.#handle.result
    if (outcome.ok) {
      return (
        this.#successHandler ? await this.#successHandler(outcome.value) : outcome.value
      ) as LocalResult
    }

    for (const registered of this.#handlers) {
      if (!isMatching(registered.pattern)(outcome.error)) continue
      const recovered = await registered.handler(outcome.error as never)
      if (recovered !== undefined) return recovered as LocalResult
      throw new UnhandledRunFailure(outcome.error)
    }

    throw new UnhandledRunFailure(outcome.error)
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
