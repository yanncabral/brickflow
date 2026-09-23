import { describe, expect, test } from 'bun:test'
import type { BrickPluginContext } from 'brickflow'
import { createTracingPlugin } from '../src/brick-plugin'
import { InMemoryTracer } from '../src/tracer'

function contextOf(
  partial: Omit<Partial<BrickPluginContext>, 'brickId' | 'metadata'> & {
    brickId?: string | undefined
    metadata?: Readonly<Record<string, unknown>> | undefined
  }
): BrickPluginContext {
  const { brickId, metadata, ...rest } = partial
  return {
    callId: 'call-1',
    layerPath: ['app'],
    brickPath: [],
    params: { id: 'ada' },
    isReplay: false,
    ...rest,
    ...(brickId === undefined ? {} : { brickId }),
    ...(metadata === undefined ? {} : { metadata })
  }
}

const root = contextOf({ brickId: 'app.root', brickPath: ['root'], metadata: { run: 't1' } })
const child = contextOf({ brickId: 'app.root.child', brickPath: ['child'] })

describe('plugin-otel tracing', () => {
  test('one span per brick, closed ok on success', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    plugin.onStart?.(root)
    plugin.onSuccess?.(root, { hello: 'ada' })
    const spans = tracer.spans()
    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe('app.root')
    expect(spans[0]?.status).toEqual({ code: 'ok' })
    expect(spans[0]?.attributes['brick.id']).toBe('app.root')
    expect(spans[0]?.attributes['brick.call.id']).toBe('call-1')
    expect(spans[0]?.attributes['brick.layer.path']).toBe('app')
    expect(spans[0]?.attributes['brick.params']).toBe('{"id":"ada"}')
    expect(spans[0]?.attributes['brick.metadata.run']).toBe('"t1"')
    expect(spans[0]?.ended).toBe(true)
  })

  test('root → child hierarchy via brickId prefix', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    plugin.onStart?.(root)
    plugin.onStart?.(child)
    plugin.onSuccess?.(child, 'child-ok')
    plugin.onSuccess?.(root, 'root-ok')
    const spans = tracer.spans()
    expect(spans).toHaveLength(2)
    const childSpan = spans.find((s) => s.name === 'app.root.child')
    const rootSpan = spans.find((s) => s.name === 'app.root')
    expect(childSpan?.parentId).toBe(rootSpan?.id)
    expect(rootSpan?.parentId).toBeUndefined()
  })

  test('direct-run children without brickId-prefix nest under the open root', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    const directRoot = contextOf({ brickId: undefined, brickPath: [] })
    const directChild = contextOf({ brickId: 'child', brickPath: ['child'] })
    plugin.onStart?.(directRoot)
    plugin.onStart?.(directChild)
    plugin.onSuccess?.(directChild, 'ok')
    plugin.onSuccess?.(directRoot, 'ok')
    const spans = tracer.spans()
    const childSpan = spans.find((s) => s.name === 'child')
    const rootSpan = spans.find((s) => s.name === 'app')
    expect(rootSpan).toBeDefined()
    expect(childSpan?.parentId).toBe(rootSpan?.id)
  })

  test('signal becomes a span event', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    plugin.onStart?.(root)
    plugin.onSignal?.(root, { name: 'approve', request: { by: 'ada' }, ok: true, response: 'yes' })
    plugin.onSuccess?.(root, 'ok')
    const spans = tracer.spans()
    expect(spans).toHaveLength(1)
    const event = spans[0]?.events.find((e) => e.name === 'signal.approve')
    expect(event).toBeDefined()
    expect(event?.attributes?.['signal.ok']).toBe(true)
    expect(event?.attributes?.['signal.request']).toBe('{"by":"ada"}')
    expect(event?.attributes?.['signal.response']).toBe('"yes"')
  })

  test('typed failure and defect have distinct outcome markers', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    const failed = contextOf({ brickId: 'app.a', brickPath: ['a'], callId: 'call-f' })
    const defected = contextOf({ brickId: 'app.b', brickPath: ['b'], callId: 'call-d' })
    plugin.onStart?.(failed)
    plugin.onFailure?.(failed, { type: 'user-not-found', id: 'ada' })
    plugin.onStart?.(defected)
    plugin.onDefect?.(defected, new Error('boom'))
    const spans = tracer.spans()
    expect(spans).toHaveLength(2)
    const failureSpan = spans.find((s) => s.name === 'app.a')
    const defectSpan = spans.find((s) => s.name === 'app.b')
    expect(failureSpan?.status.code).toBe('error')
    expect(defectSpan?.status.code).toBe('error')
    expect(failureSpan?.attributes['brick.outcome']).toBe('typed-failure')
    expect(failureSpan?.attributes['brick.failure.typed']).toBe(true)
    expect(defectSpan?.attributes['brick.outcome']).toBe('defect')
    expect(defectSpan?.attributes['brick.failure.typed']).toBe(false)
    expect(failureSpan?.events.some((e) => e.name === 'brick.failure')).toBe(true)
    expect(failureSpan?.events.some((e) => e.name === 'brick.defect')).toBe(false)
    expect(defectSpan?.events.some((e) => e.name === 'brick.defect')).toBe(true)
    expect(defectSpan?.events.some((e) => e.name === 'brick.failure')).toBe(false)
  })

  test('terminal hook + onFinally closes exactly one span', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    plugin.onStart?.(root)
    plugin.onSuccess?.(root, 'ok')
    plugin.onFinally?.(root, { kind: 'success', value: 'ok' })
    expect(tracer.spans()).toHaveLength(1)
  })

  test('onFinally alone closes a span missed by terminal hooks', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    plugin.onStart?.(root)
    plugin.onFinally?.(root, { kind: 'failure', error: { type: 'x' } })
    const spans = tracer.spans()
    expect(spans).toHaveLength(1)
    expect(spans[0]?.status.code).toBe('error')
    expect(spans[0]?.attributes['brick.outcome']).toBe('typed-failure')
  })

  test('replay is skipped by default, opt-in replays', () => {
    const replayed = contextOf({ brickId: 'app.root', brickPath: ['root'], isReplay: true })
    const skippedTracer = new InMemoryTracer()
    const skipped = createTracingPlugin(skippedTracer)
    expect(skipped.replay).toBeUndefined()
    skipped.onStart?.(replayed)
    skipped.onSignal?.(replayed, { name: 'approve', request: 1, ok: true })
    skipped.onSuccess?.(replayed, 'ok')
    expect(skippedTracer.spans()).toHaveLength(0)

    const tracer = new InMemoryTracer()
    const optIn = createTracingPlugin(tracer, { replay: 'emit' })
    expect(optIn.replay).toBe('emit')
    optIn.onStart?.(replayed)
    optIn.onSuccess?.(replayed, 'ok')
    expect(tracer.spans()).toHaveLength(1)
  })

  test('duplicate onStart does not corrupt the span stack', () => {
    const tracer = new InMemoryTracer()
    const plugin = createTracingPlugin(tracer)
    plugin.onStart?.(root)
    plugin.onStart?.(root)
    plugin.onSuccess?.(root, 'ok')
    plugin.onSuccess?.(root, 'ok')
    // Two opens → two spans (stacked); both closed exactly once.
    expect(tracer.spans()).toHaveLength(2)
  })
})
