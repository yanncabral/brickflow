import { isMatching, P } from 'ts-pattern'
import type { HandlerExecutionScope } from '../brick/execution-scope'
import type { EngineExecutionHandle, EngineExecutionResult } from '../engine/types'
import type { SupportedPattern } from '../matching/types'
import type { BrickRun, BrickRunControls } from './types'

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

// Shared only between compatible runtime copies; constructor-created errors are
// deliberately unmarked so throwing one remains an unexpected defect.
const failureObserverProtocol = Symbol.for('brickflow.failure-observer.v1')
const runProtocol = Symbol.for('brickflow.run.v1')
const unhandledFailureProtocol = Symbol.for('brickflow.unhandled-failure.v1')

function boundaryFailure(
  failure: unknown,
  token: object,
  scope?: HandlerExecutionScope
): UnhandledBrickFailureError {
  const error = new UnhandledBrickFailureError(failure)
  Object.defineProperty(error, unhandledFailureProtocol, { value: token })
  if (scope?.active) scope.failures.set(error, failure)
  return error
}

function isProtocolFailure(
  value: unknown,
  token: object | undefined
): value is { readonly failure: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    token !== undefined &&
    Reflect.get(value, unhandledFailureProtocol) === token &&
    Object.hasOwn(value, 'failure')
  )
}

function notifyFailure(observerTarget: unknown, error: Error, failure: unknown): void {
  if (typeof observerTarget !== 'function') return
  const observer: unknown = Reflect.get(observerTarget, failureObserverProtocol)
  if (typeof observer === 'function') Reflect.apply(observer, undefined, [error, failure])
}

class UnhandledRunFailure {
  constructor(readonly failure: unknown) {}
}

class BrickRunImplementation<Error, InitialSuccess, LocalResult, RemainingError> {
  readonly id: string
  readonly [runProtocol]: object
  readonly #handle: EngineExecutionHandle<InitialSuccess, Error>
  readonly #handlers: readonly RegisteredHandler[]
  readonly #successHandler: ((value: InitialSuccess) => unknown) | undefined
  readonly #scope: HandlerExecutionScope | undefined
  readonly #consumption: { execution?: Promise<LocalResult>; token?: object }

  constructor(
    handle: EngineExecutionHandle<InitialSuccess, Error>,
    handlers: readonly RegisteredHandler[] = [],
    successHandler?: (value: InitialSuccess) => unknown,
    scope?: HandlerExecutionScope,
    consumption: { execution?: Promise<LocalResult>; token?: object } = {}
  ) {
    this.id = handle.id
    this.#handle = handle
    this.#handlers = Object.freeze([...handlers])
    this.#successHandler = successHandler
    this.#scope = scope
    this.#consumption = consumption
    this[runProtocol] = consumption.token ??= Object.freeze({})
    Object.freeze(this)
  }

  static bind(value: unknown, scope: HandlerExecutionScope): unknown {
    if (!(value instanceof BrickRunImplementation) || value.#scope === scope) return value
    return new BrickRunImplementation(
      value.#handle,
      value.#handlers,
      value.#successHandler,
      scope,
      value.#consumption
    )
  }

  status() {
    return this.#handle.status()
  }

  cancel(reason?: string) {
    return this.#handle.cancel(reason)
  }

  onSuccess(handler: (value: InitialSuccess) => unknown) {
    return new BrickRunImplementation(this.#handle, this.#handlers, handler, this.#scope)
  }

  onError(pattern: SupportedPattern<RemainingError>, handler: (error: never) => unknown) {
    return new BrickRunImplementation(
      this.#handle,
      [...this.#handlers, { pattern: pattern as SupportedPattern<unknown>, handler }],
      this.#successHandler,
      this.#scope
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
    const propagate = this.#scope
    this.#consumption.execution ??= this.#execute()
    return this.#consumption.execution
      .catch((error: unknown) => {
        if (!(error instanceof UnhandledRunFailure)) throw error
        // Only a rejection that reaches the owning handler becomes its domain failure.
        // Detached consumers always observe the documented public error.
        const boundary = boundaryFailure(error.failure, this[runProtocol], propagate)
        notifyFailure(onrejected, boundary, error.failure)
        throw boundary
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

interface StructuralRun extends BrickRunControls, PromiseLike<unknown> {
  onSuccess(handler: (value: never) => unknown): unknown
  onError(pattern: SupportedPattern<unknown>, handler: (error: never) => unknown): unknown
  onFailure(pattern: SupportedPattern<unknown>, handler: (error: never) => unknown): unknown
  with(pattern: SupportedPattern<unknown>, handler: (error: never) => unknown): unknown
}

function isStructuralRun(value: unknown): value is StructuralRun {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    ['then', 'status', 'cancel', 'onSuccess', 'onError', 'onFailure', 'with'].every(
      (key) => typeof Reflect.get(value, key) === 'function'
    ) &&
    typeof Reflect.get(value, 'id') === 'string'
  )
}

class ObservedFailure {
  constructor(readonly failure: unknown) {}
}

// A terminal failure channel survives wrappers that forward then callbacks while
// hiding run metadata, and observes failures after the selected handler finishes.
function consumeObserved(source: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let observed: { error: unknown; failure: unknown } | undefined
    const onRejected = (error: unknown) => {
      reject(observed && observed.error === error ? new ObservedFailure(observed.failure) : error)
    }
    Object.defineProperty(onRejected, failureObserverProtocol, {
      value: (error: unknown, failure: unknown) => {
        observed = { error, failure }
      }
    })
    if ((typeof source === 'object' || typeof source === 'function') && source !== null) {
      const then: unknown = Reflect.get(source, 'then')
      if (typeof then === 'function') {
        Reflect.apply(then, source, [resolve, onRejected])
        return
      }
    }
    resolve(source)
  })
}

function protocolToken(value: unknown): object | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const token: unknown = Reflect.get(value, runProtocol)
  return typeof token === 'object' && token !== null ? token : undefined
}

// Delegate consumption to preserve the original chain's memoization, handlers,
// and execution controls, including when that chain belongs to another copy.
class StructuralRunView implements StructuralRun {
  readonly [runProtocol]: object
  readonly #run: StructuralRun
  #execution: Promise<unknown> | undefined
  readonly #scope: HandlerExecutionScope

  constructor(run: StructuralRun, scope: HandlerExecutionScope) {
    this.#run = run
    this.#scope = scope
    this[runProtocol] = protocolToken(run) ?? Object.freeze({})
    Object.freeze(this)
  }

  static bind(run: StructuralRun, scope: HandlerExecutionScope): StructuralRunView {
    return run instanceof StructuralRunView && run.#scope === scope
      ? run
      : new StructuralRunView(run, scope)
  }

  get id() {
    return this.#run.id
  }
  status() {
    return this.#run.status()
  }
  cancel(reason?: string) {
    return this.#run.cancel(reason)
  }
  onSuccess(handler: (value: never) => unknown) {
    return bindBrickRunToHandler(this.#run.onSuccess(handler), this.#scope)
  }
  onError(pattern: SupportedPattern<unknown>, handler: (error: never) => unknown) {
    return bindBrickRunToHandler(this.#run.onError(pattern, handler), this.#scope)
  }
  onFailure(pattern: SupportedPattern<unknown>, handler: (error: never) => unknown) {
    return bindBrickRunToHandler(this.#run.onFailure(pattern, handler), this.#scope)
  }
  with(pattern: SupportedPattern<unknown>, handler: (error: never) => unknown) {
    return bindBrickRunToHandler(this.#run.with(pattern, handler), this.#scope)
  }

  // biome-ignore lint/suspicious/noThenProperty: exhaustive BrickRun values are intentionally PromiseLike
  then<Result = unknown, Rejected = never>(
    onfulfilled?: ((value: unknown) => Result | PromiseLike<Result>) | null,
    onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null
  ): PromiseLike<Result | Rejected> {
    this.#execution ??= this.#consume()
    return this.#execution
      .catch((error: unknown) => {
        if (isProtocolFailure(error, this[runProtocol]) && error instanceof Error) {
          notifyFailure(onrejected, error, error.failure)
        }
        throw error
      })
      .then(onfulfilled, onrejected)
  }

  async #consume(): Promise<unknown> {
    let token: object | undefined
    try {
      // Compatible copies and transparent wrappers share their original consumption.
      // Other implementations can report domain failures through the public handlers.
      const source = protocolToken(this.#run)
        ? this.#run
        : this.#run.onError(P._, (failure) => {
            throw new ObservedFailure(failure)
          })
      token = protocolToken(source)
      return await consumeObserved(source)
    } catch (error) {
      if (error instanceof ObservedFailure || isProtocolFailure(error, token)) {
        throw boundaryFailure(error.failure, this[runProtocol], this.#scope)
      }
      throw error
    }
  }
}

export function bindBrickRunToHandler(value: unknown, scope: HandlerExecutionScope): unknown {
  if (value instanceof BrickRunImplementation) return BrickRunImplementation.bind(value, scope)
  return isStructuralRun(value) ? StructuralRunView.bind(value, scope) : value
}
