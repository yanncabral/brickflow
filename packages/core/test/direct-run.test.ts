import { describe, expect, test } from 'bun:test'
import {
  DuplicateLocalRunIdError,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  type Flow,
  flow,
  Layer,
  LocalRunCancelledError,
  P,
  type Worker
} from '../src/index'

type Empty = Record<never, never>

class RecordingWorker implements Worker {
  requests: EngineExecutionRequest<unknown, unknown>[] = []

  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure> {
    this.requests.push(request as EngineExecutionRequest<unknown, unknown>)
    return {
      id: request.id,
      result: request.execute(),
      status: async () => 'running',
      cancel: async () => {},
      signal: request.signal
    }
  }
}

interface PlainFlow extends Flow {
  params: { value: number }
  result: number
}

interface GrandchildFlow extends Flow {
  params: { id: string }
  result: string
  requires: { logger: { log(message: string): void } }
}

interface ChildFlow extends Flow {
  params: { id: string }
  result: string
  errors: 'missing'
  requires: { repository: { find(id: string): string | undefined } }
  depends: { grandchild: GrandchildFlow }
}

interface ParentFlow extends Flow {
  params: { id: string }
  result: string
  depends: { child: ChildFlow }
}

const plain = flow<PlainFlow>(({ value }) => value * 2)
const grandchild = flow<GrandchildFlow>(({ id }, { logger }) => {
  logger.log(id)
  return `hello ${id}`
})
const child = flow<ChildFlow>(async ({ id }, { repository }, { grandchild }, { fail }) => {
  const name = repository.find(id)
  if (name === undefined) return fail('missing')
  return grandchild({ id: name })
})
const parent = flow<ParentFlow>(async ({ id }, _requirements, { child }) => child({ id }))

const logger = {
  messages: [] as string[],
  log(message: string) {
    this.messages.push(message)
  }
}
const repository = { find: (id: string) => (id === 'ada' ? 'Ada' : undefined) }

describe('direct Flow execution', () => {
  test('runs a plain Flow with the core local Worker by default', async () => {
    await expect(Promise.resolve(plain.run({ value: 2 }))).resolves.toBe(4)
  })

  test('flattens transitive dependency aliases and requirements', async () => {
    const run = parent
      .run(
        { id: 'ada' },
        { requirements: { repository, logger }, dependencies: { child, grandchild } }
      )
      .with(P._, () => 'fallback')
    await expect(Promise.resolve(run)).resolves.toBe('hello Ada')
    expect(logger.messages).toContain('Ada')
  })

  test('preserves typed recovery and rejects unexpected defects', async () => {
    const recovered = parent
      .run(
        { id: 'missing' },
        { requirements: { repository, logger }, dependencies: { child, grandchild } }
      )
      .with('missing', () => 'anonymous')
    await expect(Promise.resolve(recovered)).resolves.toBe('anonymous')

    const defective = flow<PlainFlow>(() => {
      throw new Error('defect')
    })
    await expect(Promise.resolve(defective.run({ value: 1 }))).rejects.toThrow('defect')
  })

  test('selects a custom Worker and forwards identity and metadata', async () => {
    const worker = new RecordingWorker()
    await parent
      .run(
        { id: 'ada' },
        {
          requirements: { repository, logger },
          dependencies: { child, grandchild },
          worker,
          id: 'custom-id',
          metadata: { tenant: 'acme' }
        }
      )
      .with(P._, () => 'fallback')

    expect(worker.requests[0]).toMatchObject({
      id: 'custom-id',
      flowId: 'direct',
      metadata: { tenant: 'acme' }
    })
  })
})

describe('Layer-bound Flow execution', () => {
  test('binds entries immutably and supports nested durable paths', async () => {
    const users = new Layer('users', { parent, child, grandchild }).provide({ repository, logger })
    const app = new Layer('app', { users })
    const worker = new RecordingWorker()

    await app.users.parent
      .run({ id: 'ada' }, { worker })
      .with(P._, () => 'fallback')
      .then((value) => expect(value).toBe('hello Ada'))
    expect(worker.requests[0]?.flowId).toBe('app.users.parent')
    expect(users.parent).not.toBe(parent)
    expect(parent).toBe(parent)
    expect(Object.isFrozen(users.parent)).toBe(true)
  })

  test('allows one Flow to be bound to different provider sets', async () => {
    const first = new Layer('first', { child, grandchild }).provide({
      repository: { find: () => 'First' },
      logger
    })
    const second = new Layer('second', { child, grandchild }).provide({
      repository: { find: () => 'Second' },
      logger
    })

    await first.child
      .run({ id: '1' })
      .with(P._, () => 'fallback')
      .then((value) => expect(value).toBe('hello First'))
    await second.child
      .run({ id: '1' })
      .with(P._, () => 'fallback')
      .then((value) => expect(value).toBe('hello Second'))
  })
})

describe('core local Worker behavior', () => {
  test('reports status, rejects duplicate explicit IDs, and supports cancellation', async () => {
    const run = plain.run({ value: 1 }, { id: 'local-status' })
    expect(await run.status()).toBe('queued')
    expect(() => plain.run({ value: 2 }, { id: 'local-status' })).toThrow(DuplicateLocalRunIdError)
    const result = Promise.resolve(run)
    await run.cancel('stop')
    expect(await run.status()).toBe('cancelled')
    await expect(result).rejects.toBeInstanceOf(LocalRunCancelledError)
  })

  test('delegates boundary signals', async () => {
    interface SignalledFlow extends Flow {
      params: { id: string }
      result: boolean
      signals: { approve: { request: { id: string }; response: boolean } }
    }
    const signalled = flow<SignalledFlow>(async ({ id }, _r, _d, { signals }) =>
      signals.approve({ id })
    )

    await expect(
      Promise.resolve(
        signalled.run({ id: 'ada' }, { signals: { approve: ({ id }) => id === 'ada' } })
      )
    ).resolves.toBe(true)
  })
})

void ({} as Empty)
