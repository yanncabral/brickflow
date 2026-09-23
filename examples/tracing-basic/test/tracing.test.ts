import { describe, expect, test } from 'bun:test'
import type { RecordedSpan } from '@brickflow/plugin-otel'
import { runDefectTrace, runGreetingTrace, runMissingUserTrace } from '../src/index'

function spanById(spans: readonly RecordedSpan[], brickId: string): RecordedSpan {
  const span = spans.find((candidate) => candidate.attributes['brick.id'] === brickId)
  if (!span) throw new Error(`missing span for ${brickId}`)
  return span
}

describe('traced parent→child bricks', () => {
  test('child span nests under the parent span with a shared call id', async () => {
    const { greeting, tracer, callId } = await runGreetingTrace()

    expect(greeting).toEqual({ message: 'Hello, Ada!', approved: true })
    const spans = tracer.spans()
    expect(spans).toHaveLength(2)

    const parent = spanById(spans, 'app.getGreeting')
    const child = spanById(spans, 'app.getUser')

    expect(parent.name).toBe('app.getGreeting')
    expect(child.name).toBe('app.getUser')
    expect(child.parentId).toBe(parent.id)
    expect(parent.attributes['brick.call.id']).toBe(callId)
    expect(child.attributes['brick.call.id']).toBe(callId)
  })

  test('span attributes carry paths and param snippets', async () => {
    const { tracer } = await runGreetingTrace()

    const parent = spanById(tracer.spans(), 'app.getGreeting')
    expect(parent.attributes).toMatchObject({
      'brick.id': 'app.getGreeting',
      'brick.layer.path': 'app',
      'brick.path': 'getGreeting'
    })
    // The shipped adapter records param/result snippets (truncated at 2k),
    // unlike the plan's shape-only double: redact PII before real export.
    expect(parent.attributes['brick.params']).toBe('{"id":"ada-secret-id"}')
    expect(parent.status).toEqual({ code: 'ok' })
  })

  test('signal request/response is an event on the requesting brick span', async () => {
    const { tracer } = await runGreetingTrace()

    const parent = spanById(tracer.spans(), 'app.getGreeting')
    expect(parent.events.map((event) => event.name)).toEqual(['signal.approve'])
    expect(parent.events[0]?.attributes).toMatchObject({
      'signal.name': 'approve',
      'signal.ok': true
    })
  })

  test('typed failure records brick.failure with typed outcome and recovers', async () => {
    const { recovered, tracer } = await runMissingUserTrace()

    expect(recovered).toEqual({ message: 'Hello, stranger!', approved: false })

    const spans = tracer.spans()
    const child = spanById(spans, 'app.getUser')
    expect(child.status.code).toBe('error')
    expect(child.attributes['brick.outcome']).toBe('typed-failure')
    expect(child.events.map((event) => event.name)).toEqual(['brick.failure'])
    expect(child.events[0]?.attributes?.['failure.message']).toBe('"user-not-found"')

    const parent = spanById(spans, 'app.getGreeting')
    expect(parent.status.code).toBe('error')
    expect(parent.events.map((event) => event.name)).toContain('brick.failure')

    const serialized = JSON.stringify(spans)
    expect(serialized).not.toContain('brick.defect')
  })

  test('unexpected throw records brick.defect with error status and rejects', async () => {
    const { defect, tracer } = await runDefectTrace()

    expect(defect).toBeInstanceOf(TypeError)

    const spans = tracer.spans()
    const child = spanById(spans, 'app.getUser')
    expect(child.status).toEqual({ code: 'error', message: 'boom' })
    expect(child.attributes['brick.outcome']).toBe('defect')
    expect(child.events.map((event) => event.name)).toEqual(['brick.defect', 'exception'])
    expect(child.events[0]?.attributes).toEqual({ 'defect.message': 'boom' })

    const parent = spanById(spans, 'app.getGreeting')
    expect(parent.status.code).toBe('error')
  })
})
