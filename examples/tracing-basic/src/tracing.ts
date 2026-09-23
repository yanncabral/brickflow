import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * Minimal in-memory tracing double for the proposed Brick OTel integration.
 *
 * It mirrors the contract in
 * `docs/superpowers/plans/2026-09-23-brick-otel-tracing-plan.md` without
 * depending on the OTel SDK: `createTracingPlugin(inMemoryTracer)` exposes the
 * same span-per-brick mapping a real `createTracingPlugin(otelTracer)` adapter
 * will implement. Once core gains `BrickPlugin` hook call sites (subagent A)
 * and the real adapter lands (subagent B), this file becomes a contract test
 * double and the manual `traceBrick`/`traceSignal` wrappers move into hooks.
 */

export interface SpanEvent {
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
}

export interface SpanContext {
  readonly traceId: string
  readonly spanId: string
}

export interface FinishedSpan extends SpanContext {
  readonly parentSpanId: string | undefined
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly events: readonly SpanEvent[]
  readonly status: string
}

export interface BrickSpanOptions {
  readonly brickId: string
  readonly callId: string
  readonly layerPath: readonly string[]
  readonly brickPath: readonly string[]
  readonly params: Readonly<Record<string, unknown>>
}

/** Top-level param keys only. Values never enter spans (no PII). */
export function paramsShapeOf(params: Readonly<Record<string, unknown>>): string {
  return Object.keys(params).join(',')
}

/**
 * Queryable failure identity without domain data: string failures keep their
 * literal, object failures keep the `type` discriminator or sorted keys.
 */
export function failureShapeOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    if ('type' in error && typeof error.type === 'string') return error.type
    return Object.keys(error).sort().join(',')
  }
  return typeof error
}

function defectTypeOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

function defectMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ActiveSpan {
  readonly context: SpanContext
  readonly #tracer: InMemoryTracer
  readonly #name: string
  readonly #parentSpanId: string | undefined
  readonly #attributes: Record<string, string>
  readonly #events: SpanEvent[] = []
  #ended = false

  constructor(
    tracer: InMemoryTracer,
    context: SpanContext,
    name: string,
    parentSpanId: string | undefined,
    attributes: Record<string, string>
  ) {
    this.#tracer = tracer
    this.context = context
    this.#name = name
    this.#parentSpanId = parentSpanId
    this.#attributes = attributes
  }

  addEvent(name: string, attributes: Readonly<Record<string, string>> = {}): void {
    this.#events.push({ name, attributes: { ...attributes } })
  }

  get ended(): boolean {
    return this.#ended
  }

  /** Typed domain failure: event without error status. Failures are data. */
  recordFailure(shape: string): void {
    this.addEvent('brick.failure', { 'failure.shape': shape })
  }

  /** Unexpected throw: OTel-style exception event plus error status. */
  recordDefect(error: unknown): void {
    this.addEvent('brick.defect', {
      'exception.type': defectTypeOf(error),
      'exception.message': defectMessageOf(error)
    })
  }

  end(status = 'ok'): void {
    if (this.#ended) return
    this.#ended = true
    this.#tracer.finish({
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      parentSpanId: this.#parentSpanId,
      name: this.#name,
      attributes: { ...this.#attributes },
      events: [...this.#events],
      status
    })
  }
}

export class InMemoryTracer {
  readonly #finished: FinishedSpan[] = []
  readonly #storage = new AsyncLocalStorage<ActiveSpan | undefined>()

  get spans(): readonly FinishedSpan[] {
    return this.#finished
  }

  currentSpan(): ActiveSpan | undefined {
    return this.#storage.getStore()
  }

  startSpan(
    name: string,
    attributes: Readonly<Record<string, string>>,
    parent?: ActiveSpan
  ): ActiveSpan {
    const traceId = parent?.context.traceId ?? randomUUID().replaceAll('-', '')
    return new ActiveSpan(
      this,
      { traceId, spanId: randomUUID().replaceAll('-', '') },
      name,
      parent?.context.spanId,
      { ...attributes }
    )
  }

  finish(span: FinishedSpan): void {
    this.#finished.push(span)
  }

  runWithSpan<T>(span: ActiveSpan, fn: () => T): T {
    return this.#storage.run(span, fn)
  }
}

export interface TracingPlugin {
  readonly tracer: InMemoryTracer
  traceBrick<T>(options: BrickSpanOptions, fn: (span: ActiveSpan) => Promise<T>): Promise<T>
  traceSignal<T>(
    signal: { readonly name: string; readonly path: string },
    fn: () => Promise<T>
  ): Promise<T>
}

/**
 * Stand-in for the future OTel `createTracingPlugin(tracer)`. Manual
 * wrappers today; core `BrickPlugin` hooks (`onStart`/`onSuccess`/
 * `onFailure`/`onDefect`/`onSignal`) tomorrow with an identical mapping.
 */
export function createTracingPlugin(tracer = new InMemoryTracer()): TracingPlugin {
  return {
    tracer,
    async traceBrick<T>(
      options: BrickSpanOptions,
      fn: (span: ActiveSpan) => Promise<T>
    ): Promise<T> {
      const parent = tracer.currentSpan()
      const span = tracer.startSpan(
        `brick.${options.brickId}`,
        {
          'brick.id': options.brickId,
          'brick.call_id': options.callId,
          'brick.layer_path': options.layerPath.join('.'),
          'brick.path': options.brickPath.join('.'),
          'brick.params_shape': paramsShapeOf(options.params),
          'brick.replay': 'false'
        },
        parent
      )
      return tracer.runWithSpan(span, async () => {
        try {
          const value = await fn(span)
          span.end('ok')
          return value
        } catch (error) {
          // A span already ended inside `fn` reported its own outcome
          // (typed failure via `recordFailure`); anything else is a defect.
          if (!span.ended) {
            span.recordDefect(error)
            span.end('defect')
          }
          throw error
        }
      })
    },
    async traceSignal<T>(
      signal: { readonly name: string; readonly path: string },
      fn: () => Promise<T>
    ): Promise<T> {
      const span = tracer.currentSpan()
      span?.addEvent('brick.signal.request', {
        'signal.name': signal.name,
        'signal.path': signal.path
      })
      const response = await fn()
      span?.addEvent('brick.signal.response', {
        'signal.name': signal.name,
        'signal.path': signal.path
      })
      return response
    }
  }
}
