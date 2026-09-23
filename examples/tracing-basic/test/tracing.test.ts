import { describe, expect, test } from 'bun:test'
import { runDefectTrace, runGreetingTrace, runMissingUserTrace } from '../src/index'
import type { FinishedSpan } from '../src/tracing'

function spanById(spans: readonly FinishedSpan[], brickId: string): FinishedSpan {
  const span = spans.find((candidate) => candidate.attributes['brick.id'] === brickId)
  if (!span) throw new Error(`missing span for ${brickId}`)
  return span
}

describe('traced parent→child bricks', () => {
  test('child span nests under the parent span with shared trace and call ids', async () => {
    const { greeting, tracer, callId } = await runGreetingTrace()

    expect(greeting).toEqual({ message: 'Hello, Ada!', approved: true })
    expect(tracer.spans).toHaveLength(2)

    const parent = spanById(tracer.spans, 'app.getGreeting')
    const child = spanById(tracer.spans, 'app.getUser')

    expect(parent.name).toBe('brick.app.getGreeting')
    expect(child.name).toBe('brick.app.getUser')
    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.traceId).toBe(parent.traceId)
    expect(parent.attributes['brick.call_id']).toBe(callId)
    expect(child.attributes['brick.call_id']).toBe(callId)
  })

  test('span attributes carry paths and param shapes, never values', async () => {
    const { tracer } = await runGreetingTrace()

    const parent = spanById(tracer.spans, 'app.getGreeting')
    expect(parent.attributes).toMatchObject({
      'brick.id': 'app.getGreeting',
      'brick.layer_path': 'app',
      'brick.path': 'getGreeting',
      'brick.params_shape': 'id',
      'brick.replay': 'false'
    })
    expect(parent.status).toBe('ok')

    const serialized = JSON.stringify(tracer.spans)
    expect(serialized).not.toContain('ada-secret-id')
    expect(serialized).not.toContain('Ada')
  })

  test('signal request/response are events on the requesting brick span', async () => {
    const { tracer } = await runGreetingTrace()

    const parent = spanById(tracer.spans, 'app.getGreeting')
    expect(parent.events.map((event) => event.name)).toEqual([
      'brick.signal.request',
      'brick.signal.response'
    ])
    expect(parent.events[0]?.attributes).toMatchObject({
      'signal.name': 'approve',
      'signal.path': 'app.getGreeting.approve'
    })
  })

  test('typed failure records brick.failure without error status and recovers', async () => {
    const { recovered, tracer } = await runMissingUserTrace()

    expect(recovered).toEqual({ message: 'Hello, stranger!', approved: false })

    const child = spanById(tracer.spans, 'app.getUser')
    expect(child.status).toBe('failure')
    expect(child.events.map((event) => event.name)).toEqual(['brick.failure'])
    expect(child.events[0]?.attributes).toEqual({ 'failure.shape': 'user-not-found' })

    const parent = spanById(tracer.spans, 'app.getGreeting')
    expect(parent.status).toBe('failure')

    const serialized = JSON.stringify(tracer.spans)
    expect(serialized).not.toContain('brick.defect')
  })

  test('unexpected throw records brick.defect with error status and rejects', async () => {
    const { defect, tracer } = await runDefectTrace()

    expect(defect).toBeInstanceOf(TypeError)

    const child = spanById(tracer.spans, 'app.getUser')
    expect(child.status).toBe('defect')
    expect(child.events.map((event) => event.name)).toEqual(['brick.defect'])
    expect(child.events[0]?.attributes).toEqual({
      'exception.type': 'TypeError',
      'exception.message': 'boom'
    })

    const parent = spanById(tracer.spans, 'app.getGreeting')
    expect(parent.status).toBe('defect')
  })
})
