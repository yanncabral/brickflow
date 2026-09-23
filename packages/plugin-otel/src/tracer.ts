/**
 * Minimal zero-dependency tracing contract for Brick executions.
 *
 * The core `BrickPlugin` contract (owned by another workstream) is expected to
 * call `onStart` / `onSuccess` / `onFailure` / `onDefect` / `onSignal` per
 * Brick invocation. This file defines only the tracer surface the plugin
 * needs, plus an in-memory implementation for tests.
 */

export type SpanStatusCode = 'unset' | 'ok' | 'error'

export interface SpanStatus {
  readonly code: SpanStatusCode
  readonly message?: string | undefined
}

export type SpanAttributeValue = string | number | boolean | string[]

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>

export interface SpanEvent {
  readonly name: string
  readonly attributes?: SpanAttributes | undefined
  readonly timestamp?: number | undefined
}

export interface StartSpanOptions {
  readonly parent?: Span | undefined
  readonly attributes?: SpanAttributes | undefined
}

export interface Span {
  readonly name: string
  setAttribute(key: string, value: SpanAttributeValue): void
  addEvent(name: string, attributes?: SpanAttributes): void
  setStatus(status: SpanStatus): void
  recordException?(error: unknown): void
  end(): void
}

export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span
}

export interface RecordedSpanEvent extends SpanEvent {
  readonly timestamp: number
}

export interface RecordedSpan {
  readonly id: string
  readonly name: string
  readonly parentId: string | undefined
  readonly attributes: Record<string, SpanAttributeValue>
  readonly events: readonly RecordedSpanEvent[]
  readonly status: SpanStatus
  readonly ended: boolean
}

let nextSpanId = 0

class InMemorySpan implements Span {
  readonly id: string
  readonly parentId: string | undefined
  private readonly tracer: InMemoryTracer
  readonly name: string
  private attributesStore: Record<string, SpanAttributeValue> = {}
  private eventsStore: RecordedSpanEvent[] = []
  private statusStore: SpanStatus = { code: 'unset' }
  private endedStore = false

  constructor(tracer: InMemoryTracer, name: string, parentId: string | undefined) {
    this.tracer = tracer
    this.name = name
    this.parentId = parentId
    nextSpanId += 1
    this.id = `span-${nextSpanId}`
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    if (this.endedStore) return
    this.attributesStore[key] = value
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    if (this.endedStore) return
    this.eventsStore.push({
      name,
      ...(attributes ? { attributes } : {}),
      timestamp: Date.now()
    })
  }

  setStatus(status: SpanStatus): void {
    if (this.endedStore) return
    // Error status is sticky: once error, keep the first error.
    if (this.statusStore.code === 'error' && status.code !== 'error') return
    this.statusStore = status.message === undefined ? { code: status.code } : { ...status }
  }

  recordException(error: unknown): void {
    this.addEvent('exception', {
      'exception.message': error instanceof Error ? error.message : String(error)
    })
  }

  end(): void {
    if (this.endedStore) return
    this.endedStore = true
    this.tracer.markEnded(this)
  }

  snapshot(): RecordedSpan {
    return {
      id: this.id,
      name: this.name,
      parentId: this.parentId,
      attributes: { ...this.attributesStore },
      events: [...this.eventsStore],
      status: { ...this.statusStore },
      ended: this.endedStore
    }
  }
}

/**
 * Zero-dependency in-memory tracer. Used by unit tests and as a no-op
 * fallback when no OpenTelemetry provider is configured.
 */
export class InMemoryTracer implements Tracer {
  private readonly live = new Map<string, InMemorySpan>()
  private readonly finished: InMemorySpan[] = []

  startSpan(name: string, options?: StartSpanOptions): Span {
    const parentId = options?.parent instanceof InMemorySpan ? options.parent.id : undefined
    const span = new InMemorySpan(this, name, parentId)
    if (options?.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) span.setAttribute(key, value)
    }
    this.live.set(span.id, span)
    return span
  }

  /** @internal */
  markEnded(span: InMemorySpan): void {
    this.live.delete(span.id)
    this.finished.push(span)
  }

  spans(): readonly RecordedSpan[] {
    return this.finished.map((span) => span.snapshot())
  }

  reset(): void {
    this.live.clear()
    this.finished.length = 0
  }
}
