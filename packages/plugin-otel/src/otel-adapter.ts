/**
 * Thin adapter from the plugin's minimal {@link Tracer} contract to a real
 * OpenTelemetry tracer.
 *
 * Import from the opt-in subpath so the main entry stays zero-dependency:
 *
 * ```ts
 * import { trace } from '@opentelemetry/api'
 * import { createTracingPlugin } from '@brickflow/plugin-otel'
 * import { wrapOtelTracer } from '@brickflow/plugin-otel/otel-adapter'
 *
 * const plugin = createTracingPlugin(wrapOtelTracer(trace.getTracer('brickflow')))
 * ```
 *
 * Parent propagation uses OTel `context.with(trace.setSpan(...))` so child
 * Brick spans nest under their caller span. This module never imports the
 * OTel SDK — only `@opentelemetry/api` (optional peer).
 */

import {
  type Attributes,
  type Context,
  context,
  type Span as OtelSpan,
  type Tracer as OtelTracer,
  SpanKind,
  SpanStatusCode,
  trace
} from '@opentelemetry/api'
import type { Span, SpanAttributes, SpanStatus, StartSpanOptions, Tracer } from './tracer'

function toOtelAttributes(attributes: SpanAttributes | undefined): Attributes | undefined {
  if (!attributes) return undefined
  const out: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (Array.isArray(value)) out[key] = [...value]
    else out[key] = value
  }
  return out
}

class OtelSpanWrapper implements Span {
  readonly name: string
  private readonly inner: OtelSpan
  private readonly ownContext: Context

  constructor(name: string, inner: OtelSpan, ownContext: Context) {
    this.name = name
    this.inner = inner
    this.ownContext = ownContext
  }

  setAttribute(key: string, value: string | number | boolean | string[]): void {
    if (Array.isArray(value)) this.inner.setAttribute(key, [...value])
    else this.inner.setAttribute(key, value)
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.inner.addEvent(name, toOtelAttributes(attributes))
  }

  setStatus(status: SpanStatus): void {
    if (status.code === 'ok') {
      this.inner.setStatus(
        status.message === undefined
          ? { code: SpanStatusCode.OK }
          : { code: SpanStatusCode.OK, message: status.message }
      )
    } else if (status.code === 'error') {
      this.inner.setStatus(
        status.message === undefined
          ? { code: SpanStatusCode.ERROR }
          : { code: SpanStatusCode.ERROR, message: status.message }
      )
    } else {
      this.inner.setStatus({ code: SpanStatusCode.UNSET })
    }
  }

  recordException(error: unknown): void {
    if (error instanceof Error) this.inner.recordException(error)
    else this.inner.recordException(String(error))
  }

  end(): void {
    this.inner.end()
  }

  /** Escape hatch for advanced composition. */
  unwrap(): OtelSpan {
    return this.inner
  }

  /** @internal OTel context carrying this span, used for child parenting. */
  context(): Context {
    return this.ownContext
  }
}

/**
 * Wrap an `import { trace } from '@opentelemetry/api'` tracer in the minimal
 * plugin {@link Tracer}. The wrapped tracer starts real OTel spans; when the
 * parent Brick span was created by the same wrapper, OTel context parenting
 * nests the child under it.
 */
export function wrapOtelTracer(otelTracer: OtelTracer): Tracer {
  return {
    startSpan(name: string, spanOptions?: StartSpanOptions): Span {
      const parent = spanOptions?.parent
      const parentContext = parent instanceof OtelSpanWrapper ? parent.context() : undefined
      const attributes = toOtelAttributes(spanOptions?.attributes)
      const inner = otelTracer.startSpan(
        name,
        {
          kind: SpanKind.INTERNAL,
          ...(attributes !== undefined ? { attributes } : {})
        },
        parentContext
      )
      return new OtelSpanWrapper(
        name,
        inner,
        trace.setSpan(parentContext ?? context.active(), inner)
      )
    }
  }
}
