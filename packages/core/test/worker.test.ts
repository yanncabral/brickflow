import { describe, expect, test } from 'bun:test'
import {
  type Engine,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  type Flow,
  flow,
  Layer,
  LegacyWorker,
  P,
  UnhandledFlowFailureError
} from '../src/index'

type Empty = Record<never, never>

type Failure = 'missing' | { type: 'unavailable'; retryAfter: number }
interface RootFlow extends Flow {
  params: { id: string }
  result: { id: string }
  errors: Failure
  requires: { database: { find(id: string): string } }
  depends: Empty
  signals: {
    approve: { request: { id: string }; response: { approved: boolean } }
  }
}

const root = flow<RootFlow>(({ id }) => ({ id }))

interface ChildFlow extends Flow {
  params: { id: string }
  result: string
  errors: never
  requires: Empty
  depends: Empty
  signals: { approve: { request: { id: string }; response: string } }
}

interface ParentFlow extends Flow {
  params: { id: string }
  result: string
  errors: never
  requires: Empty
  depends: { child: ChildFlow }
  signals: { approve: { request: { id: string }; response: string } }
}

class FakeEngine implements Engine {
  readonly requests: EngineExecutionRequest<unknown, unknown>[] = []
  result: { ok: true; value: unknown } | { ok: false; error: unknown } = {
    ok: true,
    value: { id: 'result' }
  }
  statusValue: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' = 'running'
  cancelledWith: string | undefined

  start<Result, Error>(
    request: EngineExecutionRequest<Result, Error>
  ): EngineExecutionHandle<Result, Error> {
    this.requests.push(request as EngineExecutionRequest<unknown, unknown>)
    return {
      id: request.id,
      result: Promise.resolve(this.result as never),
      status: async () => this.statusValue,
      cancel: async (reason) => {
        this.cancelledWith = reason
      },
      signal: async (signal) => request.signal(signal)
    }
  }
}

class ExecutingEngine implements Engine {
  start<Result, Error>(
    request: EngineExecutionRequest<Result, Error>
  ): EngineExecutionHandle<Result, Error> {
    return {
      id: request.id,
      result: request.execute(),
      status: async () => 'running',
      cancel: async () => {},
      signal: request.signal
    }
  }
}

function setup(engine = new FakeEngine()) {
  const database = { find: (id: string) => id }
  const layer = new Layer('application', { root }).provide({ database })
  return { database, engine, layer, worker: new LegacyWorker({ engine, layer }) }
}

describe('Worker and FlowRun', () => {
  test('delegates exactly once with durable root identity, providers, metadata, and signals', async () => {
    const { database, engine, worker } = setup()
    const run = worker.run(
      root,
      { id: 'input' },
      {
        id: 'run-1',
        metadata: { tenant: 'acme' },
        signals: { application: { root: { approve: ({ id }) => ({ approved: id === 'input' }) } } }
      }
    )

    expect(engine.requests).toHaveLength(1)
    expect(run.id).toBe('run-1')
    expect(engine.requests[0]).toMatchObject({
      id: 'run-1',
      flowId: 'application.root',
      params: { id: 'input' },
      metadata: { tenant: 'acme' }
    })
    expect(engine.requests[0]?.context.providers).toEqual({ database })
    await expect(
      engine.requests[0]?.signal({ name: 'application.root.approve', request: { id: 'input' } })
    ).resolves.toEqual({ approved: true })

    const again = run.with(P._, () => ({ id: 'fallback' }))
    await expect(Promise.resolve(again)).resolves.toEqual({ id: 'result' })
    await expect(Promise.resolve(again)).resolves.toEqual({ id: 'result' })
    expect(engine.requests).toHaveLength(1)
  })

  test('resolves distinct Flow callbacks by durable path and preserves propagated child namespaces', async () => {
    const child = flow<ChildFlow>(async ({ id }, _requirements, _dependencies, { signals }) =>
      signals.approve({ id })
    )
    const parent = flow<ParentFlow>(async ({ id }, _requirements, { child }, { signals }) => {
      const own = await signals.approve({ id: `parent-${id}` })
      const nested = await child({ id: `child-${id}` })
      return `${own}|${nested}`
    })
    const files = new Layer('files', { editFile: parent, child })
    const worker = new LegacyWorker({ engine: new FakeEngine(), layer: files })
    const calls: string[] = []

    worker.run(
      parent,
      { id: '1' },
      {
        id: 'nested-run',
        signals: {
          files: {
            editFile: {
              approve: ({ id }) => {
                calls.push(`parent:${id}`)
                return 'parent-approved'
              }
            },
            child: {
              approve: ({ id }) => {
                calls.push(`sibling:${id}`)
                return 'sibling-approved'
              }
            }
          }
        }
      }
    )

    const request = (worker.engine as FakeEngine).requests[0]
    await expect(
      request?.signal({ name: 'files.editFile.approve', request: { id: 'parent-1' } })
    ).resolves.toBe('parent-approved')
    await expect(
      request?.signal({ name: 'files.child.approve', request: { id: 'child-1' } })
    ).resolves.toBe('sibling-approved')
    await expect(
      request?.signal({ name: 'files.child.approve', request: { id: 'sibling-1' } })
    ).resolves.toBe('sibling-approved')
    expect(calls).toEqual(['parent:parent-1', 'sibling:child-1', 'sibling:sibling-1'])
  })

  test('executes Flow tools and dependency calls with their resolved durable namespaces', async () => {
    const child = flow<ChildFlow>(async ({ id }, _requirements, _dependencies, { signals }) =>
      signals.approve({ id })
    )
    const parent = flow<ParentFlow>(async ({ id }, _requirements, { child }, { signals }) => {
      const own = await signals.approve({ id: `parent-${id}` })
      const nested = await child({ id: `child-${id}` })
      return `${own}|${nested}`
    })
    const files = new Layer('files', { editFile: parent, child })
    const worker = new LegacyWorker({ engine: new ExecutingEngine(), layer: files })
    const calls: string[] = []

    const value = await worker.run(
      parent,
      { id: '1' },
      {
        signals: {
          files: {
            editFile: {
              approve: ({ id }) => {
                calls.push(`parent:${id}`)
                return 'parent-approved'
              }
            },
            child: {
              approve: ({ id }) => {
                calls.push(`child:${id}`)
                return 'child-approved'
              }
            }
          }
        }
      }
    )

    expect(value).toBe('parent-approved|child-approved')
    expect(calls).toEqual(['parent:parent-1', 'child:child-1'])
  })

  test('merges nested Layer providers and passes the full effective environment per invocation', async () => {
    interface DatabaseFlow extends Flow {
      params: undefined
      result: string
      errors: never
      requires: { database: { name: string } }
      depends: Empty
      signals: Empty
    }
    interface LoggerFlow extends Flow {
      params: undefined
      result: string
      errors: never
      requires: { logger: { name: string } }
      depends: { database: DatabaseFlow }
      signals: Empty
    }
    const seen: Readonly<Record<string, unknown>>[] = []
    const database = flow<DatabaseFlow>((_params, requirements) => {
      seen.push(requirements)
      return requirements.database.name
    })
    const logger = flow<LoggerFlow>(async (_params, requirements, dependencies) => {
      seen.push(requirements)
      return `${requirements.logger.name}:${await dependencies.database(undefined)}`
    })
    const nested = new Layer('services', { database }).provide({ database: { name: 'db' } })
    const layer = new Layer('application', { logger, nested }).provide({ logger: { name: 'log' } })
    const worker = new LegacyWorker({ engine: new ExecutingEngine(), layer })

    expect(await worker.run(logger, undefined)).toBe('log:db')
    expect(seen).toEqual([
      { logger: { name: 'log' }, database: { name: 'db' } },
      { logger: { name: 'log' }, database: { name: 'db' } }
    ])
  })

  test('rejects conflicting nested providers unless a top-level provider overrides them', async () => {
    interface ServiceFlow extends Flow {
      params: undefined
      result: string
      errors: never
      requires: { service: { name: string } }
      depends: Empty
      signals: Empty
    }
    const first = flow<ServiceFlow>((_params, { service }) => service.name)
    const second = flow<ServiceFlow>((_params, { service }) => service.name)
    const left = new Layer('left', { first }).provide({ service: { name: 'left' } })
    const right = new Layer('right', { second }).provide({ service: { name: 'right' } })

    const conflicting = new Layer('application', { left, right })
    expect(() => new LegacyWorker({ engine: new ExecutingEngine(), layer: conflicting })).toThrow(
      /conflicting nested layer provider.*service/i
    )

    const overridden = conflicting.provide({
      service: { name: 'top' }
    } as never)
    const worker = new LegacyWorker({ engine: new ExecutingEngine(), layer: overridden })
    expect(await worker.run(first, undefined)).toBe('top')
  })

  test('rejects ambiguous root paths and dependency contracts', () => {
    const duplicateRootLayer = new Layer('application', {
      first: new Layer('first', { root }),
      second: new Layer('second', { root })
    }).provide({ database: { find: (id: string) => id } })
    const duplicateRootWorker = new LegacyWorker({
      engine: new FakeEngine(),
      layer: duplicateRootLayer
    })
    expect(() =>
      duplicateRootWorker.run(
        root,
        { id: '1' },
        {
          signals: {
            application: { first: { root: { approve: () => ({ approved: true }) } } }
          } as never
        }
      )
    ).toThrow(/ambiguous root flow.*application\.first\.root.*application\.second\.root/i)

    const firstChild = flow<ChildFlow>(({ id }) => id)
    const secondChild = flow<ChildFlow>(({ id }) => id)
    const parent = flow<ParentFlow>(async ({ id }, _r, { child }) => child({ id }))
    const ambiguousDependencyLayer = new Layer('files', {
      parent,
      first: new Layer('first', { child: firstChild }),
      second: new Layer('second', { child: secondChild })
    })
    const worker = new LegacyWorker({
      engine: new ExecutingEngine(),
      layer: ambiguousDependencyLayer
    })
    expect(
      Promise.resolve(worker.run(parent, { id: '1' }, { signals: {} as never }))
    ).rejects.toThrow(/ambiguous dependency.*child.*files\.first\.child.*files\.second\.child/i)
  })

  test('reports a missing dependency alias when execution reaches the call', async () => {
    const parent = flow<ParentFlow>(async ({ id }, _requirements, { child }) => child({ id }))
    const worker = new LegacyWorker({
      engine: new ExecutingEngine(),
      layer: new Layer('files', { parent })
    })

    await expect(
      Promise.resolve(worker.run(parent, { id: '1' }, { signals: {} as never }))
    ).rejects.toThrow(/missing dependency.*child.*configured layer/i)
  })

  test('allows a parent call to handle a child signal locally and propagate undefined to the boundary', async () => {
    const child = flow<ChildFlow>(async ({ id }, _requirements, _dependencies, { signals }) =>
      signals.approve({ id })
    )
    const locallyHandled = flow<ParentFlow>(async ({ id }, _requirements, { child }) =>
      child({ id }, { signals: { approve: ({ id: childId }) => `local:${childId}` } })
    )
    const propagated = flow<ParentFlow>(async ({ id }, _requirements, { child }) =>
      child({ id }, { signals: { approve: () => undefined } })
    )
    const layer = new Layer('files', { locallyHandled, propagated, child })
    const boundary = {
      files: { child: { approve: ({ id }: { id: string }) => `boundary:${id}` } }
    }

    expect(
      await new LegacyWorker({ engine: new ExecutingEngine(), layer }).run(
        locallyHandled,
        { id: '1' },
        {
          signals: boundary as never
        }
      )
    ).toBe('local:1')
    expect(
      await new LegacyWorker({ engine: new ExecutingEngine(), layer }).run(
        propagated,
        { id: '2' },
        {
          signals: boundary as never
        }
      )
    ).toBe('boundary:2')
  })

  test('exposes status and cancel without a public signal method', async () => {
    const { engine, worker } = setup()
    const run = worker.run(
      root,
      { id: 'input' },
      {
        signals: { application: { root: { approve: () => ({ approved: true }) } } }
      }
    )

    await expect(run.status()).resolves.toBe('running')
    await run.cancel('operator request')
    expect(engine.cancelledWith).toBe('operator request')
    expect('signal' in run).toBe(false)
  })

  test('recovers typed failures through matching', async () => {
    const { engine, worker } = setup()
    engine.result = { ok: false, error: { type: 'unavailable', retryAfter: 3 } }

    const value = await worker
      .run(
        root,
        { id: 'input' },
        {
          signals: { application: { root: { approve: () => ({ approved: true }) } } }
        }
      )
      .with('missing', () => ({ id: 'missing-fallback' }))
      .with({ type: 'unavailable' }, (error) => ({ id: `retry-${error.retryAfter}` }))

    expect(value).toEqual({ id: 'retry-3' })
  })

  test('stops at the first matching recovery handler when it propagates', async () => {
    const { engine, worker } = setup()
    engine.result = { ok: false, error: 'missing' }
    const calls: string[] = []
    const unsafeRun = worker
      .run(
        root,
        { id: 'input' },
        {
          signals: { application: { root: { approve: () => ({ approved: true }) } } }
        }
      )
      .with(P._, () => {
        calls.push('first')
        return undefined
      })
      .with(P._, () => {
        calls.push('second')
        return { id: 'incorrect-recovery' }
      }) as unknown as PromiseLike<unknown>

    await expect(Promise.resolve(unsafeRun)).rejects.toBeInstanceOf(UnhandledFlowFailureError)
    expect(calls).toEqual(['first'])
  })

  test('rejects failures that escape the typed boundary through any', async () => {
    const { engine, worker } = setup()
    engine.result = { ok: false, error: 'missing' }
    const unsafeRun: PromiseLike<unknown> = worker.run(
      root,
      { id: 'input' },
      {
        signals: { application: { root: { approve: () => ({ approved: true }) } } }
      }
    ) as unknown as PromiseLike<unknown>

    await expect(Promise.resolve(unsafeRun)).rejects.toBeInstanceOf(UnhandledFlowFailureError)
    await expect(Promise.resolve(unsafeRun)).rejects.toThrow(/unhandled flow failure.*missing/i)
  })

  test('propagates engine defects unchanged', async () => {
    const defect = new Error('engine defect')
    const engine: Engine = {
      start() {
        return {
          id: 'run-defect',
          result: Promise.reject(defect),
          status: async () => 'failed',
          cancel: async () => {},
          signal: async () => undefined
        }
      }
    }
    const layer = new Layer('application', { root }).provide({
      database: { find: (id: string) => id }
    })
    const worker = new LegacyWorker({ engine, layer })

    await expect(
      Promise.resolve(
        worker
          .run(
            root,
            { id: 'input' },
            {
              signals: { application: { root: { approve: () => ({ approved: true }) } } }
            }
          )
          .with(P._, () => ({ id: 'fallback' }))
      )
    ).rejects.toBe(defect)
  })

  test('rejects roots outside the configured layer without runtime provider-key validation', () => {
    const engine = new FakeEngine()
    const absent = flow<RootFlow>(({ id }) => ({ id }))
    const layer = new Layer('application', { root })
    const worker = new LegacyWorker({ engine, layer })

    expect(() =>
      worker.run(
        absent,
        { id: 'input' },
        {
          signals: { application: { root: { approve: () => ({ approved: true }) } } }
        }
      )
    ).toThrow(/root flow.*configured layer/i)
    expect(() =>
      worker.run(
        root,
        { id: 'input' },
        {
          signals: { application: { root: { approve: () => ({ approved: true }) } } }
        }
      )
    ).not.toThrow()
    expect(engine.requests).toHaveLength(1)
  })
})
