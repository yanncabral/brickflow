import { afterEach, describe, expect, test } from 'bun:test'
import { createTracingPlugin, InMemoryTracer } from '@brickflow/plugin-otel'
import { type Brick, brick, UnhandledBrickFailureError } from 'brickflow'
import { BackendSqlite } from 'openworkflow/sqlite'
import { OpenWorkflowWorker } from '../src/index'

type ChildBrick = Brick<{
  params: { id: string }
  result: string
  signals: { approve: { request: { id: string }; response: { approved: boolean } } }
}>
type ParentBrick = Brick<{
  params: { id: string }
  result: string
  depends: { child: ChildBrick }
}>

class SimulatedCrashError extends Error {
  constructor() {
    super('simulated crash')
    this.name = 'SimulatedCrashError'
  }
}

const workers: OpenWorkflowWorker[] = []
const backends: BackendSqlite[] = []

function track(worker: OpenWorkflowWorker): OpenWorkflowWorker {
  workers.push(worker)
  return worker
}

function createSharedBackend(): BackendSqlite {
  const backend = BackendSqlite.connect(':memory:')
  backends.push(backend)
  return backend
}

afterEach(async () => {
  while (workers.length > 0) {
    const worker = workers.pop()
    if (worker) await worker.close()
  }
  while (backends.length > 0) {
    const backend = backends.pop()
    if (backend) await backend.stop()
  }
})

function groupByName(spans: readonly { name: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const span of spans) counts.set(span.name, (counts.get(span.name) ?? 0) + 1)
  return counts
}

describe('durable tracing replay', () => {
  test('crash mid-graph heals with one span per brick and no duplicate signals', async () => {
    const calls: { parent?: number; child?: number } = {}
    let signalCalls = 0
    const child = brick<ChildBrick>(async ({ id }, _requirements, _deps, { signals }) => {
      calls.child = (calls.child ?? 0) + 1
      const decision = await signals.approve({ id })
      return decision.approved ? `approved:${id}` : `denied:${id}`
    })
    const parent = brick<ParentBrick>(async ({ id }, _requirements, { child: runChild }) => {
      calls.parent = (calls.parent ?? 0) + 1
      const nested = await runChild({ id })
      // Simulate a crash after the child checkpointed: the first parent
      // attempt dies here, the retry pass re-drives only the parent.
      if (calls.parent === 1) throw new SimulatedCrashError()
      return `parent(${nested})`
    })
    const dependencies = { child: { brick: child } }
    const signalHandlers = {
      approve: async (request: { id: string }) => {
        signalCalls += 1
        expect(request).toEqual({ id: 'ada' })
        return { approved: true }
      }
    }

    const skipTracer = new InMemoryTracer()
    const emitTracer = new InMemoryTracer()
    const plugins = [
      createTracingPlugin(skipTracer),
      createTracingPlugin(emitTracer, { replay: 'emit' })
    ]
    const worker = track(
      new OpenWorkflowWorker({
        backend: createSharedBackend(),
        stepRetryPolicy: { maximumAttempts: 3, initialInterval: '50ms' }
      })
    )

    const result = await Promise.resolve(
      parent.run(
        { id: 'ada' },
        { dependencies, signals: { child: signalHandlers }, worker, id: 'run-tracing', plugins }
      )
    )

    expect(result).toBe('parent(approved:ada)')
    // Only the pending parent re-executed; the checkpointed child did not.
    expect(calls).toEqual({ parent: 2, child: 1 })
    expect(signalCalls).toBe(1)

    for (const [label, tracer] of [
      ['skip', skipTracer],
      ['emit', emitTracer]
    ] as const) {
      const spans = tracer.spans()
      // Direct-run root spans fall back to the 'brick' name; the child span
      // nests under the first parent attempt.
      expect(groupByName(spans), label).toEqual(
        new Map([
          ['child', 1],
          ['brick', 2]
        ])
      )
      const childSpan = spans.find((span) => span.name === 'child')
      const parentSpans = spans.filter((span) => span.name === 'brick')
      expect(childSpan?.status).toEqual({ code: 'ok' })
      expect(childSpan?.attributes['brick.outcome']).toBe('success')
      expect(childSpan?.parentId, label).toBe(parentSpans[0]?.id)
      // Crash attempt closed as defect, heal attempt closed as success:
      // exactly one re-emission, never a duplicate.
      expect(parentSpans.map((span) => span.attributes['brick.outcome']).sort(), label).toEqual([
        'defect',
        'success'
      ])
      // The signal fired once, inside the checkpointed child: no replay copy.
      expect(
        childSpan?.events.filter((event) => event.name === 'signal.approve'),
        label
      ).toHaveLength(1)
    }
  })

  test('isReplay resume of a completed run emits nothing new', async () => {
    type PlainChild = Brick<{ params: { id: string }; result: string }>
    type PlainParent = Brick<{
      params: { id: string }
      result: string
      depends: { child: PlainChild }
    }>
    const calls: { parent?: number; child?: number } = {}
    const child = brick<PlainChild>(async ({ id }) => {
      calls.child = (calls.child ?? 0) + 1
      return `child:${id}`
    })
    const parent = brick<PlainParent>(async ({ id }, _requirements, { child: runChild }) => {
      calls.parent = (calls.parent ?? 0) + 1
      return `parent(${await runChild({ id })})`
    })
    const dependencies = { child: { brick: child } }

    const skipTracer = new InMemoryTracer()
    const emitTracer = new InMemoryTracer()
    const plugins = [
      createTracingPlugin(skipTracer),
      createTracingPlugin(emitTracer, { replay: 'emit' })
    ]
    const backend = createSharedBackend()
    const first = track(new OpenWorkflowWorker({ backend }))
    await Promise.resolve(
      parent.run({ id: 'ada' }, { dependencies, worker: first, id: 'run-replay', plugins })
    )
    expect(calls).toEqual({ parent: 1, child: 1 })
    await first.close()
    workers.splice(workers.indexOf(first), 1)

    const resumed = track(new OpenWorkflowWorker({ backend }))
    const result = await Promise.resolve(
      parent.run(
        { id: 'ada' },
        { dependencies, worker: resumed, id: 'run-replay', plugins, isReplay: true }
      )
    )

    expect(result).toBe('parent(child:ada)')
    // Checkpoints serve everything: no handler re-executes, and neither the
    // skip plugin nor the emit plugin emits anything new.
    expect(calls).toEqual({ parent: 1, child: 1 })
    expect(skipTracer.spans()).toHaveLength(2)
    expect(emitTracer.spans()).toHaveLength(2)
  })

  test('typed failures cross the durable boundary as data', async () => {
    type FallibleChild = Brick<{
      params: { id: string }
      result: string
      errors: { code: string }
    }>
    type FallibleParent = Brick<{
      params: { id: string }
      result: string
      depends: { child: FallibleChild }
    }>
    const fallible = brick<FallibleChild>(async ({ id }, _req, _deps, { fail }) => {
      if (id === 'missing') return fail({ code: 'NOT_FOUND' })
      return `found:${id}`
    })
    const fallibleParent = brick<FallibleParent>(
      async ({ id }, _req, { child: runChild }) => `parent(${await runChild({ id })})`
    )

    const tracer = new InMemoryTracer()
    const worker = track(new OpenWorkflowWorker({ backend: createSharedBackend() }))
    const error = await Promise.resolve(
      fallibleParent.run(
        { id: 'missing' },
        {
          dependencies: { child: { brick: fallible } },
          worker,
          id: 'run-typed-failure',
          plugins: [createTracingPlugin(tracer)]
        }
      )
    ).then(
      () => 'resolved-unexpectedly',
      (cause: unknown) => cause
    )

    // Structured failure preserved as data, never collapsed into an Error.
    expect(error).toBeInstanceOf(UnhandledBrickFailureError)
    expect((error as UnhandledBrickFailureError).failure).toEqual({ code: 'NOT_FOUND' })
    const childSpan = tracer.spans().find((span) => span.name === 'child')
    expect(childSpan?.attributes['brick.outcome']).toBe('typed-failure')
    expect(childSpan?.attributes['brick.failure.typed']).toBe(true)
    expect(childSpan?.events.some((event) => event.name === 'brick.failure')).toBe(true)
    expect(childSpan?.events.some((event) => event.name === 'brick.defect')).toBe(false)
  })
})
