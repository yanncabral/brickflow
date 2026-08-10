import { isMatching } from 'ts-pattern'
import type { MatchingBuilder, MatchingOutcome, MatchingThunk, SupportedPattern } from './types'

interface RegisteredHandler {
  readonly pattern: SupportedPattern<unknown>
  readonly handler: (error: never) => unknown | Promise<unknown>
}

class ImmutableMatchingBuilder<Error, InitialSuccess, LocalResult, RemainingError>
  implements MatchingBuilder<Error, InitialSuccess, LocalResult, RemainingError>
{
  readonly #thunk: MatchingThunk<InitialSuccess, Error>
  readonly #handlers: readonly RegisteredHandler[]
  #execution?: Promise<MatchingOutcome<LocalResult, RemainingError>>

  constructor(thunk: MatchingThunk<InitialSuccess, Error>, handlers: readonly RegisteredHandler[]) {
    this.#thunk = thunk
    this.#handlers = Object.freeze([...handlers])
    Object.freeze(this)
  }

  with<const Pattern extends SupportedPattern<RemainingError>, HandlerResult>(
    pattern: Pattern extends readonly unknown[] ? never : Pattern,
    handler: (
      error: import('./types').MatchedError<RemainingError, Pattern>
    ) => HandlerResult | Promise<HandlerResult>
  ): MatchingBuilder<
    Error,
    InitialSuccess,
    LocalResult | import('./types').RecoveryValue<HandlerResult>,
    import('./types').RemainingErrors<RemainingError, Pattern, HandlerResult>
  > {
    const registered: RegisteredHandler = {
      pattern: pattern as SupportedPattern<unknown>,
      handler: handler as RegisteredHandler['handler']
    }
    return new ImmutableMatchingBuilder(this.#thunk, [...this.#handlers, registered])
  }

  // biome-ignore lint/suspicious/noThenProperty: matching builders are intentionally memoized PromiseLike values
  then<TResult1 = MatchingOutcome<LocalResult, RemainingError>, TResult2 = never>(
    onfulfilled?:
      | ((value: MatchingOutcome<LocalResult, RemainingError>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.#execution ??= this.#execute()
    return this.#execution.then(onfulfilled, onrejected)
  }

  async #execute(): Promise<MatchingOutcome<LocalResult, RemainingError>> {
    const outcome = await this.#thunk()
    if (outcome.ok) {
      return outcome as unknown as MatchingOutcome<LocalResult, RemainingError>
    }

    for (const registered of this.#handlers) {
      if (!isMatching(registered.pattern)(outcome.error)) {
        continue
      }

      const recovered = await registered.handler(outcome.error as never)
      return recovered === undefined
        ? (outcome as unknown as MatchingOutcome<LocalResult, RemainingError>)
        : { ok: true, value: recovered as LocalResult }
    }

    return outcome as unknown as MatchingOutcome<LocalResult, RemainingError>
  }
}

export function createMatchingBuilder<Error, Success>(
  thunk: MatchingThunk<Success, Error>
): MatchingBuilder<Error, Success> {
  return new ImmutableMatchingBuilder(thunk, [])
}
