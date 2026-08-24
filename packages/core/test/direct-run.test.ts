import { describe, expect, test } from 'bun:test'
import {
  DuplicateLocalRunIdError,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  ExecutionContext,
  type Flow,
  flow,
  Layer,
  LocalRunCancelledError,
  LocalWorker,
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

  test('executes recursive dependency nodes and requirements', async () => {
    const run = parent
      .run(
        { id: 'ada' },
        {
          requirements: { repository, logger },
          dependencies: {
            child: { flow: child, dependencies: { grandchild: { flow: grandchild } } }
          }
        }
      )
      .with(P._, () => 'fallback')
    await expect(Promise.resolve(run)).resolves.toBe('hello Ada')
    expect(logger.messages).toContain('Ada')
  })

  test('keeps equal transitive aliases independent in sibling branches', async () => {
    interface RepositoryFlow extends Flow {
      params: undefined
      result: string
    }
    interface BranchFlow extends Flow {
      params: undefined
      result: string
      depends: { repository: RepositoryFlow }
    }
    interface RootFlow extends Flow {
      params: undefined
      result: readonly [string, string]
      depends: { primary: BranchFlow; secondary: BranchFlow }
    }

    const branch = flow<BranchFlow>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const root = flow<RootFlow>(async (_params, _requirements, dependencies) =>
      Promise.all([dependencies.primary(undefined), dependencies.secondary(undefined)])
    )

    await expect(
      Promise.resolve(
        root.run(undefined, {
          dependencies: {
            primary: {
              flow: branch,
              dependencies: { repository: { flow: flow<RepositoryFlow>(() => 'primary') } }
            },
            secondary: {
              flow: branch,
              dependencies: { repository: { flow: flow<RepositoryFlow>(() => 'secondary') } }
            }
          }
        })
      )
    ).resolves.toEqual(['primary', 'secondary'])
  })

  test('routes equal dependency signal names through exact recursive paths', async () => {
    interface PrimaryFlow extends Flow {
      params: undefined
      result: string
      signals: { approve: { request: { primary: true }; response: string } }
    }
    interface SecondaryFlow extends Flow {
      params: undefined
      result: number
      signals: { approve: { request: { secondary: true }; response: number } }
    }
    interface RootFlow extends Flow {
      params: undefined
      result: readonly [string, number]
      depends: { primary: PrimaryFlow; secondary: SecondaryFlow }
    }

    const primary = flow<PrimaryFlow>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve({ primary: true })
    )
    const secondary = flow<SecondaryFlow>(
      async (_params, _requirements, _dependencies, { signals }) =>
        signals.approve({ secondary: true })
    )
    const root = flow<RootFlow>(async (_params, _requirements, dependencies) =>
      Promise.all([dependencies.primary(undefined), dependencies.secondary(undefined)])
    )

    await expect(
      Promise.resolve(
        root.run(undefined, {
          dependencies: { primary: { flow: primary }, secondary: { flow: secondary } },
          signals: {
            primary: { approve: ({ primary }) => (primary ? 'approved' : 'denied') },
            secondary: { approve: ({ secondary }) => (secondary ? 42 : 0) }
          }
        })
      )
    ).resolves.toEqual(['approved', 42])
  })

  test('does not resolve dependency signals by final name suffix', async () => {
    interface ChildFlow extends Flow {
      params: undefined
      result: boolean
      signals: { approve: { request: undefined; response: boolean } }
    }
    interface RootFlow extends Flow {
      params: undefined
      result: boolean
      signals: { approve: { request: undefined; response: boolean } }
      depends: { child: ChildFlow }
    }

    const child = flow<ChildFlow>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve(undefined)
    )
    const root = flow<RootFlow>(async (_params, _requirements, dependencies) =>
      dependencies.child(undefined)
    )

    await expect(
      Promise.resolve(
        root.run(undefined, {
          dependencies: { child: { flow: child } },
          signals: { approve: () => true, child: { approve: () => false } }
        })
      )
    ).resolves.toBe(false)
  })

  test('preserves typed recovery and rejects unexpected defects', async () => {
    const recovered = parent
      .run(
        { id: 'missing' },
        {
          requirements: { repository, logger },
          dependencies: {
            child: { flow: child, dependencies: { grandchild: { flow: grandchild } } }
          }
        }
      )
      .with('missing', () => 'anonymous')
    await expect(Promise.resolve(recovered)).resolves.toBe('anonymous')

    const defective = flow<PlainFlow>(() => {
      throw new Error('defect')
    })
    await expect(Promise.resolve(defective.run({ value: 1 }))).rejects.toThrow('defect')
  })

  test('preserves explicit empty execution IDs and generates omitted IDs', async () => {
    const worker = new RecordingWorker()

    const explicitRun = plain.run({ value: 2 }, { worker, id: '' })
    expect(worker.requests[0]?.id).toBe('')
    expect(explicitRun.id).toBe('')
    await expect(Promise.resolve(explicitRun)).resolves.toBe(4)

    const generatedRun = plain.run({ value: 3 }, { worker })
    expect(worker.requests[1]?.id).not.toBe('')
    expect(generatedRun.id).not.toBe('')
    expect(worker.requests[1]?.id).toBe(generatedRun.id)
    await expect(Promise.resolve(generatedRun)).resolves.toBe(6)
  })

  test('selects a custom Worker and forwards identity and metadata', async () => {
    const worker = new RecordingWorker()
    await parent
      .run(
        { id: 'ada' },
        {
          requirements: { repository, logger },
          dependencies: {
            child: { flow: child, dependencies: { grandchild: { flow: grandchild } } }
          },
          worker,
          id: 'custom-id',
          metadata: { tenant: 'acme' }
        }
      )
      .with(P._, () => 'fallback')

    expect(worker.requests[0]).toMatchObject({
      id: 'custom-id',
      metadata: { tenant: 'acme' }
    })
    expect(worker.requests[0]?.flowId).toBeUndefined()
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

  test('resolves transitive dependency aliases in each caller Layer scope', async () => {
    interface RepositoryFlow extends Flow {
      params: undefined
      result: string
    }
    interface CheckoutFlow extends Flow {
      params: undefined
      result: string
      depends: { repository: RepositoryFlow }
    }
    interface PlaceOrderFlow extends Flow {
      params: undefined
      result: string
      depends: { checkout: CheckoutFlow }
    }

    const checkout = flow<CheckoutFlow>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = flow<PlaceOrderFlow>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const checkoutLayer = new Layer('checkout', {
      checkout,
      repository: flow<RepositoryFlow>(() => 'checkout')
    })
    const reportingLayer = new Layer('reporting', {
      repository: flow<RepositoryFlow>(() => 'reporting')
    })
    const app = new Layer('app', { placeOrder, checkout: checkoutLayer, reporting: reportingLayer })

    await expect(Promise.resolve(app.placeOrder.run(undefined))).resolves.toBe('checkout')
  })

  test('resolves transitive Layer dependencies from a supplied Flow caller scope', async () => {
    interface GrandchildFlow extends Flow {
      params: undefined
      result: string
    }
    interface ChildFlow extends Flow {
      params: undefined
      result: string
      depends: { grandchild: GrandchildFlow }
    }
    interface ParentFlow extends Flow {
      params: undefined
      result: string
      depends: { child: ChildFlow }
    }

    const suppliedChild = flow<ChildFlow>(async (_params, _requirements, dependencies) =>
      dependencies.grandchild(undefined)
    )
    const bound = new Layer('bound', {
      parent: flow<ParentFlow>(async (_params, _requirements, dependencies) =>
        dependencies.child(undefined)
      ),
      grandchild: flow<GrandchildFlow>(() => 'layer')
    })

    await expect(
      Promise.resolve(
        bound.parent.run(undefined, { dependencies: { child: { flow: suppliedChild } } })
      )
    ).resolves.toBe('layer')
  })

  test('resolves a supplied Flow transitive dependency from its nested caller scope', async () => {
    interface GrandchildFlow extends Flow {
      params: undefined
      result: string
    }
    interface ChildFlow extends Flow {
      params: undefined
      result: string
      depends: { grandchild: GrandchildFlow }
    }
    interface ParentFlow extends Flow {
      params: undefined
      result: string
      depends: { child: ChildFlow }
    }

    const suppliedChild = flow<ChildFlow>(async (_params, _requirements, dependencies) =>
      dependencies.grandchild(undefined)
    )
    const nested = new Layer('nested', {
      parent: flow<ParentFlow>(async (_params, _requirements, dependencies) =>
        dependencies.child(undefined)
      ),
      grandchild: flow<GrandchildFlow>(() => 'nested')
    })
    const elsewhere = new Layer('elsewhere', {
      grandchild: flow<GrandchildFlow>(() => 'elsewhere')
    })
    const app = new Layer('app', { nested, elsewhere })

    await expect(
      Promise.resolve(
        app.nested.parent.run(undefined, { dependencies: { child: { flow: suppliedChild } } })
      )
    ).resolves.toBe('nested')
  })

  test('uses a supplied dependency when transitive global Layer matches are ambiguous', async () => {
    interface RepositoryFlow extends Flow {
      params: undefined
      result: string
    }
    interface CheckoutFlow extends Flow {
      params: undefined
      result: string
      depends: { repository: RepositoryFlow }
    }
    interface PlaceOrderFlow extends Flow {
      params: undefined
      result: string
      depends: { checkout: CheckoutFlow }
    }

    const checkout = flow<CheckoutFlow>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = flow<PlaceOrderFlow>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const checkoutLayer = new Layer('checkout', { checkout })
    const reportingLayer = new Layer('reporting', {
      repository: flow<RepositoryFlow>(() => 'reporting')
    })
    const inventoryLayer = new Layer('inventory', {
      repository: flow<RepositoryFlow>(() => 'inventory')
    })
    const suppliedRepository = flow<RepositoryFlow>(() => 'supplied')
    const app = new Layer('app', {
      placeOrder,
      checkout: checkoutLayer,
      reporting: reportingLayer,
      inventory: inventoryLayer
    })

    await expect(
      Promise.resolve(
        app.placeOrder.run(undefined, {
          dependencies: { repository: { flow: suppliedRepository } }
        })
      )
    ).resolves.toBe('supplied')
  })

  test('resolves signals for a supplied-only dependency without an empty Layer namespace', async () => {
    interface SignalledChildFlow extends Flow {
      params: { id: string }
      result: boolean
      signals: { approve: { request: { id: string }; response: boolean } }
    }
    interface SignalledParentFlow extends Flow {
      params: { id: string }
      result: boolean
      depends: { child: SignalledChildFlow }
    }

    const signalledChild = flow<SignalledChildFlow>(
      async ({ id }, _requirements, _dependencies, { signals }) => signals.approve({ id })
    )
    const signalledParent = flow<SignalledParentFlow>(async ({ id }, _requirements, { child }) =>
      child({ id })
    )
    const app = new Layer('app', { parent: signalledParent })

    await expect(
      Promise.resolve(
        app.parent.run(
          { id: 'ada' },
          {
            dependencies: { child: { flow: signalledChild } },
            signals: { child: { approve: ({ id }) => id === 'ada' } }
          }
        )
      )
    ).resolves.toBe(true)
  })

  test('uses only selected Layer signal branches when an ambiguous dependency is supplied', async () => {
    interface RepositoryFlow extends Flow {
      params: undefined
      result: string
      signals: { refresh: { request: undefined; response: string } }
    }
    interface CheckoutFlow extends Flow {
      params: undefined
      result: string
      depends: { repository: RepositoryFlow }
    }
    interface PlaceOrderFlow extends Flow {
      params: undefined
      result: string
      depends: { checkout: CheckoutFlow }
    }

    const checkout = flow<CheckoutFlow>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = flow<PlaceOrderFlow>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const repository = (_value: string) =>
      flow<RepositoryFlow>(async (_params, _requirements, _dependencies, { signals }) =>
        signals.refresh(undefined)
      )
    const app = new Layer('app', {
      placeOrder,
      checkout: new Layer('checkout', { checkout }),
      reporting: new Layer('reporting', { repository: repository('reporting') }),
      inventory: new Layer('inventory', { repository: repository('inventory') })
    })

    await expect(
      Promise.resolve(
        app.placeOrder.run(undefined, {
          dependencies: { repository: { flow: repository('supplied') } },
          signals: { repository: { refresh: () => 'selected' } }
        })
      )
    ).resolves.toBe('selected')
  })

  test('accepts unresolved dependency aliases and gives scoped Layer entries precedence', async () => {
    const layerChild = flow<ChildFlow>(async ({ id }, { repository }, { grandchild }) =>
      grandchild({ id: `layer-${repository.find(id)}` })
    )
    const bound = new Layer('bound', { parent, child: layerChild }).provide({ repository, logger })

    await bound.parent
      .run({ id: 'ada' }, { dependencies: { grandchild: { flow: grandchild } } })
      .with(P._, () => 'fallback')
      .then((value) => expect(value).toBe('hello layer-Ada'))
  })
})

describe('core local Worker behavior', () => {
  function localRequest<Result, Failure>(
    overrides: Partial<EngineExecutionRequest<Result, Failure>> &
      Pick<EngineExecutionRequest<Result, Failure>, 'id' | 'execute'>
  ): EngineExecutionRequest<Result, Failure> {
    return {
      params: undefined,
      context: new ExecutionContext({ callId: `call-${overrides.id}` }),
      signal: async ({ request }) => request,
      ...overrides
    }
  }

  test('covers queued, running, completed, typed failure, defect, and independent IDs', async () => {
    let resolvePending!: (value: { ok: true; value: string }) => void
    const pending = new Promise<{ ok: true; value: string }>((resolve) => {
      resolvePending = resolve
    })
    const worker = new LocalWorker()
    const success = worker.start(
      localRequest({ id: 'success', execute: async () => ({ ok: true, value: 1 }) })
    )
    const running = worker.start(localRequest({ id: 'running', execute: () => pending }))
    const failure = { code: 'denied' as const }
    const failed = worker.start(
      localRequest({ id: 'failed', execute: async () => ({ ok: false, error: failure }) })
    )
    const defect = new Error('boom')
    const defective = worker.start(
      localRequest({
        id: 'defective',
        execute: async () => {
          throw defect
        }
      })
    )

    await expect(success.status()).resolves.toBe('queued')
    await Promise.resolve()
    await expect(running.status()).resolves.toBe('running')
    await expect(success.result).resolves.toEqual({ ok: true, value: 1 })
    await expect(success.status()).resolves.toBe('completed')
    await expect(failed.result).resolves.toEqual({ ok: false, error: failure })
    await expect(failed.status()).resolves.toBe('failed')
    await expect(defective.result).rejects.toBe(defect)
    await expect(defective.status()).resolves.toBe('failed')
    resolvePending({ ok: true, value: 'done' })
    await expect(running.result).resolves.toEqual({ ok: true, value: 'done' })
  })

  test('keeps cancellation idempotent through late completion and rejects later signals', async () => {
    let resolvePending!: (value: { ok: true; value: string }) => void
    const pending = new Promise<{ ok: true; value: string }>((resolve) => {
      resolvePending = resolve
    })
    const handle = new LocalWorker().start(
      localRequest({ id: 'cancel-race', execute: () => pending })
    )
    const result = handle.result.catch((error: unknown) => error)

    await Promise.resolve()
    await handle.cancel('stop')
    await handle.cancel('ignored')
    await expect(handle.status()).resolves.toBe('cancelled')
    expect(await result).toEqual(
      expect.objectContaining({
        name: 'LocalRunCancelledError',
        runId: 'cancel-race',
        reason: 'stop'
      })
    )
    await expect(handle.signal({ name: 'approve', request: true })).rejects.toBeInstanceOf(
      LocalRunCancelledError
    )
    resolvePending({ ok: true, value: 'late' })
    await Promise.resolve()
    await expect(handle.status()).resolves.toBe('cancelled')
  })

  test('delegates signals while active and rejects duplicate IDs after completion', async () => {
    const calls: unknown[] = []
    const worker = new LocalWorker()
    const handle = worker.start(
      localRequest({
        id: 'duplicate-after-completion',
        execute: async () => ({ ok: true, value: undefined }),
        signal: async (call) => {
          calls.push(call)
          return 'approved'
        }
      })
    )

    await expect(handle.signal({ name: 'approve', request: { id: 1 } })).resolves.toBe('approved')
    expect(calls).toEqual([{ name: 'approve', request: { id: 1 } }])
    await handle.result
    expect(() =>
      worker.start(
        localRequest({
          id: 'duplicate-after-completion',
          execute: async () => ({ ok: true, value: undefined })
        })
      )
    ).toThrow(DuplicateLocalRunIdError)
  })

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
