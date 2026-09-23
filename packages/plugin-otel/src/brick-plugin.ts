/**
 * Brick tracing plugin: one span per Brick invocation, signal/failure
 * telemetry as span events, replay-safe by default.
 *
 * This module depends only on the minimal {@link Tracer} contract in
 * `./tracer.ts` (zero runtime dependencies) and on core's `BrickPlugin`
 * contract (type-only import). Use the `otel-adapter` subpath to back it
 * with a real OpenTelemetry tracer.
 *
 * Core emits a terminal hook (`onSuccess`/`onFailure`/`onDefect`) *and*
 * `onFinally` per invocation; span close is idempotent, so the first
 * terminal hook wins and `onFinally` only closes spans missed otherwise.
 *
 * Parent propagation: core contexts carry no parent pointer, so the plugin
 * derives nesting per `callId`: the parent is the open span whose `brickId`
 * is the longest proper dot-prefix of the starting span's id (e.g. `child`
 * parents `child.repositoryWorker` in direct runs, `app.users` parents
 * `app.users.getUser` in Layer-bound runs). When ids do not nest (direct-run
 * roots have no `brickId`), the most recently opened span for the same
 * `callId` is used. Parallel same-brick invocations are tracked as a stack
 * per span key.
 */

import type {
  BrickPlugin,
  BrickPluginContext,
  BrickPluginExit,
  BrickPluginReplay,
  BrickPluginSignalEvent
} from 'brickflow'
import type { Span, SpanAttributes, Tracer } from './tracer'

export interface TracingPluginOptions {
  /** Opt in to emitting spans/events during durable replay. Default `'skip'`. */
  readonly replay?: BrickPluginReplay | undefined
  /** Override the span name. Default: `brickId`, else `brickPath` joined, else `'brick'`. */
  readonly spanName?: ((context: BrickPluginContext) => string) | undefined
}

const MAX_INLINE_JSON = 2000
const ROOT_KEY = '<root>'

function spanKey(context: BrickPluginContext): string {
  return `${context.callId}::${context.brickId ?? ROOT_KEY}`
}

function displayId(context: BrickPluginContext): string {
  if (context.brickId !== undefined) return context.brickId
  const path = [...context.layerPath, ...context.brickPath].join('.')
  return path === '' ? 'brick' : path
}

function toJsonSnippet(value: unknown): string | undefined {
  if (value === undefined) return undefined
  try {
    const raw = JSON.stringify(value) ?? String(value)
    return raw.length > MAX_INLINE_JSON ? `${raw.slice(0, MAX_INLINE_JSON)}…[truncated]` : raw
  } catch {
    return String(value)
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  const snippet = toJsonSnippet(error)
  return snippet ?? String(error)
}

function isProperPrefix(parentId: string, childId: string): boolean {
  return (
    childId.length > parentId.length &&
    childId.startsWith(parentId) &&
    childId[parentId.length] === '.'
  )
}

/**
 * Create a replay-safe tracing plugin backed by a minimal {@link Tracer}.
 *
 * Mapping:
 * - `onStart` opens one child span named `brickId` (fallback: durable layer
 *   + brick path) with attributes `brick.id`, `brick.call.id`,
 *   `brick.layer.path`, `brick.path`, plus `brick.params` and
 *   `brick.metadata.*` snippets.
 * - `onSuccess` sets status `ok` (`brick.outcome=success`) and ends the span.
 * - `onFailure` (typed domain failure) sets status `error` with
 *   `brick.outcome=typed-failure` + `brick.failure.typed=true` and a
 *   `brick.failure` event, then ends the span.
 * - `onDefect` (unexpected throw) sets status `error` with
 *   `brick.outcome=defect` + `brick.failure.typed=false` and a
 *   `brick.defect` event (+ `recordException` when supported), then ends.
 * - `onSignal` records a `signal.<name>` span event with `signal.ok` plus
 *   request/response (or error) snippets.
 * - `onFinally` closes any span left open (missed terminal hook) using the
 *   exit kind; otherwise a no-op.
 * - Replay-safe: when `context.isReplay` is true the plugin no-ops unless
 *   created with `{ replay: 'emit' }`.
 */
export function createTracingPlugin(tracer: Tracer, options?: TracingPluginOptions): BrickPlugin {
  const allowReplay = (options?.replay ?? 'skip') === 'emit'
  // Stacks per span key; supports recursive/parallel same-brick invocations.
  const open = new Map<string, Span[]>()
  // Insertion-ordered registry of open spans for parent derivation.
  const registry = new Set<{ key: string; span: Span; brickId: string | undefined }>()

  const shouldSkip = (context: BrickPluginContext): boolean => context.isReplay && !allowReplay

  const push = (context: BrickPluginContext, span: Span): void => {
    const key = spanKey(context)
    const stack = open.get(key)
    if (stack) stack.push(span)
    else open.set(key, [span])
    registry.add({ key, span, brickId: context.brickId })
  }

  const pop = (context: BrickPluginContext): Span | undefined => {
    const key = spanKey(context)
    const stack = open.get(key)
    const span = stack?.pop()
    if (stack && stack.length === 0) open.delete(key)
    if (span) {
      for (const entry of registry) {
        if (entry.span === span) {
          registry.delete(entry)
          break
        }
      }
    }
    return span
  }

  const peek = (context: BrickPluginContext): Span | undefined => {
    const stack = open.get(spanKey(context))
    return stack?.at(-1)
  }

  const resolveParent = (context: BrickPluginContext): Span | undefined => {
    let longest: { span: Span; length: number } | undefined
    let latest: Span | undefined
    for (const entry of registry) {
      if (entry.key.split('::')[0] !== context.callId) continue
      latest = entry.span
      if (
        entry.brickId !== undefined &&
        context.brickId !== undefined &&
        isProperPrefix(entry.brickId, context.brickId) &&
        (longest === undefined || entry.brickId.length > longest.length)
      ) {
        longest = { span: entry.span, length: entry.brickId.length }
      }
    }
    return longest?.span ?? latest
  }

  const close = (
    context: BrickPluginContext,
    outcome: 'success' | 'typed-failure' | 'defect',
    detail: {
      status: 'ok' | 'error'
      message?: string
      event?: { name: string; attributes?: SpanAttributes }
    }
  ): void => {
    const span = pop(context)
    if (!span) return
    span.setAttribute('brick.outcome', outcome)
    if (detail.event) span.addEvent(detail.event.name, detail.event.attributes)
    span.setStatus(
      detail.message === undefined
        ? { code: detail.status }
        : { code: detail.status, message: detail.message }
    )
    span.end()
  }

  return {
    name: 'brick-otel-tracing',
    ...(allowReplay ? { replay: 'emit' as const } : {}),

    onStart(context: BrickPluginContext): void {
      if (shouldSkip(context)) return
      const name = options?.spanName ? options.spanName(context) : displayId(context)
      const attributes: Record<string, string> = {
        'brick.call.id': context.callId,
        'brick.layer.path': context.layerPath.join('.'),
        'brick.path': context.brickPath.join('.')
      }
      if (context.brickId !== undefined) attributes['brick.id'] = context.brickId
      const params = toJsonSnippet(context.params)
      if (params !== undefined) attributes['brick.params'] = params
      const span = tracer.startSpan(name, {
        ...(resolveParent(context) ? { parent: resolveParent(context) as Span } : {}),
        attributes
      })
      const metadata = context.metadata
      if (metadata) {
        for (const [k, v] of Object.entries(metadata)) {
          span.setAttribute(`brick.metadata.${k}`, toJsonSnippet(v) ?? String(v))
        }
      }
      push(context, span)
    },

    onSuccess(context: BrickPluginContext, value: unknown): void {
      if (shouldSkip(context)) return
      const span = pop(context)
      if (!span) return
      span.setAttribute('brick.outcome', 'success')
      const result = toJsonSnippet(value)
      if (result !== undefined) span.setAttribute('brick.result', result)
      span.setStatus({ code: 'ok' })
      span.end()
    },

    onFailure(context: BrickPluginContext, error: unknown): void {
      if (shouldSkip(context)) return
      const span = pop(context)
      if (!span) return
      const message = failureMessage(error)
      const detail = toJsonSnippet(error)
      span.setAttribute('brick.outcome', 'typed-failure')
      span.setAttribute('brick.failure.typed', true)
      span.addEvent('brick.failure', {
        'failure.message': message,
        ...(detail !== undefined ? { 'failure.detail': detail } : {})
      })
      span.setStatus({ code: 'error', message })
      span.end()
    },

    onDefect(context: BrickPluginContext, error: unknown): void {
      if (shouldSkip(context)) return
      const span = pop(context)
      if (!span) return
      const message = error instanceof Error ? error.message : failureMessage(error)
      span.setAttribute('brick.outcome', 'defect')
      span.setAttribute('brick.failure.typed', false)
      span.addEvent('brick.defect', { 'defect.message': message })
      try {
        span.recordException?.(error)
      } catch {
        // recordException is best-effort; status below already captures the defect.
      }
      span.setStatus({ code: 'error', message })
      span.end()
    },

    onSignal(context: BrickPluginContext, signal: BrickPluginSignalEvent): void {
      if (shouldSkip(context)) return
      const span = peek(context)
      if (!span) return
      const request = toJsonSnippet(signal.request)
      const response = toJsonSnippet(signal.response)
      const error = toJsonSnippet(signal.error)
      span.addEvent(`signal.${signal.name}`, {
        'signal.name': signal.name,
        'signal.ok': signal.ok,
        ...(request !== undefined ? { 'signal.request': request } : {}),
        ...(response !== undefined ? { 'signal.response': response } : {}),
        ...(error !== undefined ? { 'signal.error': error } : {})
      })
    },

    onFinally(context: BrickPluginContext, exit: BrickPluginExit): void {
      if (shouldSkip(context)) return
      if (exit.kind === 'success') {
        const span = peek(context)
        if (!span) return
        close(context, 'success', { status: 'ok' })
        return
      }
      if (exit.kind === 'failure') {
        if (!peek(context)) return
        close(context, 'typed-failure', {
          status: 'error',
          message: failureMessage(exit.error),
          event: {
            name: 'brick.failure',
            attributes: { 'failure.message': failureMessage(exit.error) }
          }
        })
        return
      }
      if (!peek(context)) return
      close(context, 'defect', {
        status: 'error',
        message: failureMessage(exit.error),
        event: {
          name: 'brick.defect',
          attributes: { 'defect.message': failureMessage(exit.error) }
        }
      })
    }
  }
}
