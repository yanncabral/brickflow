import { describe, expect, test } from 'bun:test'
import {
  type Brick,
  brick,
  DuplicateLocalRunIdError,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  ExecutionContext,
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

type PlainBrick = Brick<{
  params: { value: number }
  result: number
}>

type GrandchildBrick = Brick<{
  params: { id: string }
  result: string
  requires: { logger: { log(message: string): void } }
}>

type ChildBrick = Brick<{
  params: { id: string }
  result: string
  errors: 'missing'
  requires: { repository: { find(id: string): string | undefined } }
  depends: { grandchild: GrandchildBrick }
}>

type ParentBrick = Brick<{
  params: { id: string }
  result: string
  depends: { child: ChildBrick }
}>

const plain = brick<PlainBrick>(({ value }) => value * 2)
const grandchild = brick<GrandchildBrick>(({ id }, { logger }) => {
  logger.log(id)
  return `hello ${id}`
})
const child = brick<ChildBrick>(async ({ id }, { repository }, { grandchild }, { fail }) => {
  const name = repository.find(id)
  if (name === undefined) return fail('missing')
  return grandchild({ id: name })
})
const parent = brick<ParentBrick>(async ({ id }, _requirements, { child }) => child({ id }))

const logger = {
  messages: [] as string[],
  log(message: string) {
    this.messages.push(message)
  }
}
const repository = { find: (id: string) => (id === 'ada' ? 'Ada' : undefined) }

describe('direct Brick execution', () => {
  test('runs a plain Brick with the core local Worker by default', async () => {
    await expect(Promise.resolve(plain.run({ value: 2 }))).resolves.toBe(4)
  })

  test('executes recursive dependency nodes and requirements', async () => {
    const run = parent
      .run(
        { id: 'ada' },
        {
          requirements: { repository, logger },
          dependencies: {
            child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
          }
        }
      )
      .with(P._, () => 'fallback')
    await expect(Promise.resolve(run)).resolves.toBe('hello Ada')
    expect(logger.messages).toContain('Ada')
  })

  test('keeps equal transitive aliases independent in sibling branches', async () => {
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
    }>
    type BranchBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type RootBrick = Brick<{
      params: undefined
      result: readonly [string, string]
      depends: { primary: BranchBrick; secondary: BranchBrick }
    }>

    const branch = brick<BranchBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const root = brick<RootBrick>(async (_params, _requirements, dependencies) =>
      Promise.all([dependencies.primary(undefined), dependencies.secondary(undefined)])
    )

    await expect(
      Promise.resolve(
        root.run(undefined, {
          dependencies: {
            primary: {
              brick: branch,
              dependencies: { repository: { brick: brick<RepositoryBrick>(() => 'primary') } }
            },
            secondary: {
              brick: branch,
              dependencies: { repository: { brick: brick<RepositoryBrick>(() => 'secondary') } }
            }
          }
        })
      )
    ).resolves.toEqual(['primary', 'secondary'])
  })

  test('routes equal dependency signal names through exact recursive paths', async () => {
    type PrimaryBrick = Brick<{
      params: undefined
      result: string
      signals: { approve: { request: { primary: true }; response: string } }
    }>
    type SecondaryBrick = Brick<{
      params: undefined
      result: number
      signals: { approve: { request: { secondary: true }; response: number } }
    }>
    type RootBrick = Brick<{
      params: undefined
      result: readonly [string, number]
      depends: { primary: PrimaryBrick; secondary: SecondaryBrick }
    }>

    const primary = brick<PrimaryBrick>(
      async (_params, _requirements, _dependencies, { signals }) =>
        signals.approve({ primary: true })
    )
    const secondary = brick<SecondaryBrick>(
      async (_params, _requirements, _dependencies, { signals }) =>
        signals.approve({ secondary: true })
    )
    const root = brick<RootBrick>(async (_params, _requirements, dependencies) =>
      Promise.all([dependencies.primary(undefined), dependencies.secondary(undefined)])
    )

    await expect(
      Promise.resolve(
        root.run(undefined, {
          dependencies: { primary: { brick: primary }, secondary: { brick: secondary } },
          signals: {
            primary: { approve: ({ primary }) => (primary ? 'approved' : 'denied') },
            secondary: { approve: ({ secondary }) => (secondary ? 42 : 0) }
          }
        })
      )
    ).resolves.toEqual(['approved', 42])
  })

  test('does not resolve dependency signals by final name suffix', async () => {
    type ChildBrick = Brick<{
      params: undefined
      result: boolean
      signals: { approve: { request: undefined; response: boolean } }
    }>
    type RootBrick = Brick<{
      params: undefined
      result: boolean
      signals: { approve: { request: undefined; response: boolean } }
      depends: { child: ChildBrick }
    }>

    const child = brick<ChildBrick>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve(undefined)
    )
    const root = brick<RootBrick>(async (_params, _requirements, dependencies) =>
      dependencies.child(undefined)
    )

    await expect(
      Promise.resolve(
        root.run(undefined, {
          dependencies: { child: { brick: child } },
          signals: { approve: () => true, child: { approve: () => false } }
        })
      )
    ).resolves.toBe(false)
  })

  test('rejects dotted direct dependency aliases before path dispatch can collide', async () => {
    type LeafBrick = Brick<{
      params: undefined
      result: string
    }>
    type NestedBrick = Brick<{
      params: undefined
      result: string
      depends: { child: LeafBrick }
    }>
    type RootBrick = Brick<{
      params: undefined
      result: string
      depends: { 'parent.child': LeafBrick; parent: NestedBrick }
    }>

    const leaf = brick<LeafBrick>(() => 'leaf')
    const nested = brick<NestedBrick>(async (_params, _requirements, dependencies) =>
      dependencies.child(undefined)
    )
    const root = brick<RootBrick>((async (
      _params: undefined,
      _requirements: Empty,
      dependencies: { 'parent.child': (params: undefined) => Promise<string> }
    ) => dependencies['parent.child'](undefined)) as never)

    const run = root.run(undefined, {
      dependencies: {
        'parent.child': { brick: leaf },
        parent: { brick: nested, dependencies: { child: { brick: leaf } } }
      }
    })

    await expect(Promise.resolve(run)).rejects.toThrow(
      /invalid path segment.*parent\.child.*\.\W.*reserved delimiter/i
    )
  })

  test('rejects empty direct dependency aliases before root signal paths can collide', async () => {
    type ChildBrick = Brick<{
      params: undefined
      result: string
      signals: { approve: { request: undefined; response: string } }
    }>
    type RootBrick = Brick<{
      params: undefined
      result: string
      signals: { approve: { request: undefined; response: string } }
      depends: { '': ChildBrick }
    }>

    let rootSignalCalls = 0
    const child = brick<ChildBrick>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve(undefined)
    )
    const root = brick<RootBrick>((async (
      _params: undefined,
      _requirements: Empty,
      dependencies: { '': (params: undefined) => Promise<string> }
    ) => dependencies[''](undefined)) as never)

    const run = root.run(undefined, {
      dependencies: { '': { brick: child } },
      signals: {
        approve: () => {
          rootSignalCalls += 1
          return 'root'
        }
      }
    } as never)

    await expect(Promise.resolve(run)).rejects.toThrow(/invalid path segment.*must not be empty/i)
    expect(rootSignalCalls).toBe(0)
  })

  test('preserves typed recovery and rejects unexpected defects', async () => {
    const recovered = parent
      .run(
        { id: 'missing' },
        {
          requirements: { repository, logger },
          dependencies: {
            child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
          }
        }
      )
      .with('missing', () => 'anonymous')
    await expect(Promise.resolve(recovered)).resolves.toBe('anonymous')

    const defective = brick<PlainBrick>(() => {
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
            child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
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
    expect(worker.requests[0]?.brickId).toBeUndefined()
  })
})

describe('Layer-bound Brick execution', () => {
  test('binds entries immutably and supports nested durable paths', async () => {
    const users = new Layer('users', { parent, child, grandchild }).provide({ repository, logger })
    const app = new Layer('app', { users })
    const worker = new RecordingWorker()

    await app.users.parent
      .run({ id: 'ada' }, { worker })
      .with(P._, () => 'fallback')
      .then((value) => expect(value).toBe('hello Ada'))
    expect(worker.requests[0]?.brickId).toBe('app.users.parent')
    expect(users.parent).not.toBe(parent)
    expect(parent).toBe(parent)
    expect(Object.isFrozen(users.parent)).toBe(true)
  })

  test('allows one Brick to be bound to different provider sets', async () => {
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
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
    }>
    type CheckoutBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type PlaceOrderBrick = Brick<{
      params: undefined
      result: string
      depends: { checkout: CheckoutBrick }
    }>

    const checkout = brick<CheckoutBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = brick<PlaceOrderBrick>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const checkoutLayer = new Layer('checkout', {
      checkout,
      repository: brick<RepositoryBrick>(() => 'checkout')
    })
    const reportingLayer = new Layer('reporting', {
      repository: brick<RepositoryBrick>(() => 'reporting')
    })
    const app = new Layer('app', { placeOrder, checkout: checkoutLayer, reporting: reportingLayer })

    await expect(Promise.resolve(app.placeOrder.run(undefined))).resolves.toBe('checkout')
  })

  test('resolves transitive Layer dependencies from a supplied Brick caller scope', async () => {
    type GrandchildBrick = Brick<{
      params: undefined
      result: string
    }>
    type ChildBrick = Brick<{
      params: undefined
      result: string
      depends: { grandchild: GrandchildBrick }
    }>
    type ParentBrick = Brick<{
      params: undefined
      result: string
      depends: { child: ChildBrick }
    }>

    const suppliedChild = brick<ChildBrick>(async (_params, _requirements, dependencies) =>
      dependencies.grandchild(undefined)
    )
    const bound = new Layer('bound', {
      parent: brick<ParentBrick>(async (_params, _requirements, dependencies) =>
        dependencies.child(undefined)
      ),
      grandchild: brick<GrandchildBrick>(() => 'layer')
    })

    await expect(
      Promise.resolve(
        bound.parent.run(undefined, { dependencies: { child: { brick: suppliedChild } } })
      )
    ).resolves.toBe('layer')
  })

  test('resolves a supplied Brick transitive dependency from its nested caller scope', async () => {
    type GrandchildBrick = Brick<{
      params: undefined
      result: string
    }>
    type ChildBrick = Brick<{
      params: undefined
      result: string
      depends: { grandchild: GrandchildBrick }
    }>
    type ParentBrick = Brick<{
      params: undefined
      result: string
      depends: { child: ChildBrick }
    }>

    const suppliedChild = brick<ChildBrick>(async (_params, _requirements, dependencies) =>
      dependencies.grandchild(undefined)
    )
    const nested = new Layer('nested', {
      parent: brick<ParentBrick>(async (_params, _requirements, dependencies) =>
        dependencies.child(undefined)
      ),
      grandchild: brick<GrandchildBrick>(() => 'nested')
    })
    const elsewhere = new Layer('elsewhere', {
      grandchild: brick<GrandchildBrick>(() => 'elsewhere')
    })
    const app = new Layer('app', { nested, elsewhere })

    await expect(
      Promise.resolve(
        app.nested.parent.run(undefined, { dependencies: { child: { brick: suppliedChild } } })
      )
    ).resolves.toBe('nested')
  })

  test('requires and routes only the selected Layer dependency signal namespace', async () => {
    type ChildBrick = Brick<{
      params: undefined
      result: string
      signals: { approve: { request: undefined; response: string } }
    }>
    type ParentBrick = Brick<{
      params: undefined
      result: string
      depends: { child: ChildBrick }
    }>

    const child = brick<ChildBrick>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve(undefined)
    )
    const parent = brick<ParentBrick>(async (_params, _requirements, dependencies) =>
      dependencies.child(undefined)
    )
    const app = new Layer('app', {
      parent,
      child,
      unused: new Layer('unused', { other: child })
    })

    await expect(
      Promise.resolve(
        app.parent.run(undefined, {
          signals: { app: { child: { approve: () => 'selected' } } }
        })
      )
    ).resolves.toBe('selected')
  })

  test('uses nested Layer IDs rather than entry keys for selected signal paths', async () => {
    type ChildBrick = Brick<{
      params: undefined
      result: string
      signals: { approve: { request: undefined; response: string } }
    }>
    type ParentBrick = Brick<{
      params: undefined
      result: string
      depends: { child: ChildBrick }
    }>

    const child = brick<ChildBrick>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve(undefined)
    )
    const parent = brick<ParentBrick>(async (_params, _requirements, dependencies) =>
      dependencies.child(undefined)
    )
    const app = new Layer('app', {
      parent,
      accounts: new Layer('users', { child })
    })

    await expect(
      Promise.resolve(
        app.parent.run(undefined, {
          signals: { app: { users: { child: { approve: () => 'users' } } } }
        })
      )
    ).resolves.toBe('users')
  })

  test('splits supplied own signals from Layer-resolved descendant signals', async () => {
    type LeafBrick = Brick<{
      params: undefined
      result: string
      signals: { read: { request: undefined; response: string } }
    }>
    type GrandchildBrick = Brick<{
      params: undefined
      result: string
      depends: { leaf: LeafBrick }
      signals: { refresh: { request: undefined; response: boolean } }
    }>
    type ChildBrick = Brick<{
      params: undefined
      result: string
      depends: { grandchild: GrandchildBrick }
      signals: { approve: { request: undefined; response: boolean } }
    }>
    type ParentBrick = Brick<{
      params: undefined
      result: string
      depends: { child: ChildBrick }
    }>

    const leaf = brick<LeafBrick>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.read(undefined)
    )
    const grandchild = brick<GrandchildBrick>(
      async (_params, _requirements, dependencies, { signals }) => {
        await signals.refresh(undefined)
        return dependencies.leaf(undefined)
      }
    )
    const child = brick<ChildBrick>(async (_params, _requirements, dependencies, { signals }) => {
      await signals.approve(undefined)
      return dependencies.grandchild(undefined)
    })
    const parent = brick<ParentBrick>(async (_params, _requirements, dependencies) =>
      dependencies.child(undefined)
    )
    const app = new Layer('app', { parent, grandchild })

    await expect(
      Promise.resolve(
        app.parent.run(undefined, {
          dependencies: {
            child: {
              brick: child,
              dependencies: {
                grandchild: { dependencies: { leaf: { brick: leaf } } }
              }
            }
          },
          signals: {
            child: {
              approve: () => true,
              grandchild: { leaf: { read: () => 'supplied-leaf' } }
            },
            app: { grandchild: { refresh: () => true } }
          }
        })
      )
    ).resolves.toBe('supplied-leaf')
  })

  test('keeps unresolved descendants independent under selected sibling branches', async () => {
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
    }>
    type BranchBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type ParentBrick = Brick<{
      params: undefined
      result: readonly [string, string]
      depends: { primary: BranchBrick; secondary: BranchBrick }
    }>

    const branch = brick<BranchBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const parent = brick<ParentBrick>(async (_params, _requirements, dependencies) =>
      Promise.all([dependencies.primary(undefined), dependencies.secondary(undefined)])
    )
    const app = new Layer('app', {
      parent,
      primary: new Layer('primary', { primary: branch }),
      secondary: new Layer('secondary', { secondary: branch })
    })

    await expect(
      Promise.resolve(
        app.parent.run(undefined, {
          dependencies: {
            primary: {
              dependencies: { repository: { brick: brick<RepositoryBrick>(() => 'primary') } }
            },
            secondary: {
              dependencies: { repository: { brick: brick<RepositoryBrick>(() => 'secondary') } }
            }
          }
        })
      )
    ).resolves.toEqual(['primary', 'secondary'])
  })

  test('uses a supplied dependency when transitive global Layer matches are ambiguous', async () => {
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
    }>
    type CheckoutBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type PlaceOrderBrick = Brick<{
      params: undefined
      result: string
      depends: { checkout: CheckoutBrick }
    }>

    const checkout = brick<CheckoutBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = brick<PlaceOrderBrick>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const checkoutLayer = new Layer('checkout', { checkout })
    const reportingLayer = new Layer('reporting', {
      repository: brick<RepositoryBrick>(() => 'reporting')
    })
    const inventoryLayer = new Layer('inventory', {
      repository: brick<RepositoryBrick>(() => 'inventory')
    })
    const suppliedRepository = brick<RepositoryBrick>(() => 'supplied')
    const app = new Layer('app', {
      placeOrder,
      checkout: checkoutLayer,
      reporting: reportingLayer,
      inventory: inventoryLayer
    })

    await expect(
      Promise.resolve(
        app.placeOrder.run(undefined, {
          dependencies: {
            checkout: { dependencies: { repository: { brick: suppliedRepository } } }
          }
        })
      )
    ).resolves.toBe('supplied')
  })

  test('resolves signals for a supplied-only dependency without an empty Layer namespace', async () => {
    type SignalledChildBrick = Brick<{
      params: { id: string }
      result: boolean
      signals: { approve: { request: { id: string }; response: boolean } }
    }>
    type SignalledParentBrick = Brick<{
      params: { id: string }
      result: boolean
      depends: { child: SignalledChildBrick }
    }>

    const signalledChild = brick<SignalledChildBrick>(
      async ({ id }, _requirements, _dependencies, { signals }) => signals.approve({ id })
    )
    const signalledParent = brick<SignalledParentBrick>(async ({ id }, _requirements, { child }) =>
      child({ id })
    )
    const app = new Layer('app', { parent: signalledParent })

    await expect(
      Promise.resolve(
        app.parent.run(
          { id: 'ada' },
          {
            dependencies: { child: { brick: signalledChild } },
            signals: { child: { approve: ({ id }) => id === 'ada' } }
          }
        )
      )
    ).resolves.toBe(true)
  })

  test('uses only selected Layer signal branches when an ambiguous dependency is supplied', async () => {
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
      signals: { refresh: { request: undefined; response: string } }
    }>
    type CheckoutBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type PlaceOrderBrick = Brick<{
      params: undefined
      result: string
      depends: { checkout: CheckoutBrick }
    }>

    const checkout = brick<CheckoutBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = brick<PlaceOrderBrick>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const repository = (_value: string) =>
      brick<RepositoryBrick>(async (_params, _requirements, _dependencies, { signals }) =>
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
          dependencies: {
            checkout: {
              dependencies: { repository: { brick: repository('supplied') } }
            }
          },
          signals: { checkout: { repository: { refresh: () => 'selected' } } }
        })
      )
    ).resolves.toBe('selected')
  })

  test('uses exact absolute paths for fully Layer-resolved transitive signals', async () => {
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
      signals: { refresh: { request: undefined; response: string } }
    }>
    type CheckoutBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type PlaceOrderBrick = Brick<{
      params: undefined
      result: string
      depends: { checkout: CheckoutBrick }
    }>

    const repository = brick<RepositoryBrick>(
      async (_params, _requirements, _dependencies, { signals }) => signals.refresh(undefined)
    )
    const checkout = brick<CheckoutBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined)
    )
    const placeOrder = brick<PlaceOrderBrick>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const app = new Layer('app', {
      placeOrder,
      checkout: new Layer('checkout', { checkout, repository })
    })

    await expect(
      Promise.resolve(
        app.placeOrder.run(undefined, {
          signals: { app: { checkout: { repository: { refresh: () => 'refreshed' } } } }
        })
      )
    ).resolves.toBe('refreshed')
  })

  test('local signal overrides follow Layer-resolved callee paths', async () => {
    type RepositoryBrick = Brick<{
      params: undefined
      result: string
      signals: { refresh: { request: undefined; response: string } }
    }>
    type CheckoutBrick = Brick<{
      params: undefined
      result: string
      depends: { repository: RepositoryBrick }
    }>
    type PlaceOrderBrick = Brick<{
      params: undefined
      result: string
      depends: { checkout: CheckoutBrick }
    }>

    const repository = brick<RepositoryBrick>(
      async (_params, _requirements, _dependencies, { signals }) => signals.refresh(undefined)
    )
    const suppliedCheckout = brick<CheckoutBrick>(async (_params, _requirements, dependencies) =>
      dependencies.repository(undefined, { signals: { refresh: () => 'local' } })
    )
    const placeOrder = brick<PlaceOrderBrick>(async (_params, _requirements, dependencies) =>
      dependencies.checkout(undefined)
    )
    const app = new Layer('app', {
      placeOrder,
      checkout: new Layer('checkout', { repository })
    })

    await expect(
      Promise.resolve(
        app.placeOrder.run(undefined, {
          dependencies: { checkout: { brick: suppliedCheckout } },
          signals: { app: { checkout: { repository: { refresh: () => 'boundary' } } } }
        })
      )
    ).resolves.toBe('local')
  })

  test('rejects dotted and empty local signal overrides before descendant interception', async () => {
    type LeafBrick = Brick<{
      params: undefined
      result: string
      signals: { approve: { request: undefined; response: string } }
    }>
    type ChildBrick = Brick<{
      params: undefined
      result: string
      depends: { leaf: LeafBrick }
    }>
    type RootBrick = Brick<{
      params: undefined
      result: string
      depends: { child: ChildBrick }
    }>

    let descendantCalls = 0
    const leaf = brick<LeafBrick>(async (_params, _requirements, _dependencies, { signals }) =>
      signals.approve(undefined)
    )
    const child = brick<ChildBrick>(async (_params, _requirements, dependencies) =>
      dependencies.leaf(undefined)
    )

    for (const invalid of ['leaf.approve', '']) {
      const root = brick<RootBrick>(async (_params, _requirements, dependencies) =>
        dependencies.child(undefined, {
          signals: {
            [invalid]: () => {
              descendantCalls += 1
              return 'intercepted'
            }
          }
        } as never)
      )

      const run = root.run(undefined, {
        dependencies: {
          child: { brick: child, dependencies: { leaf: { brick: leaf } } }
        },
        signals: {
          child: {
            leaf: {
              approve: () => {
                descendantCalls += 1
                return 'boundary'
              }
            }
          }
        }
      })

      await expect(Promise.resolve(run)).rejects.toThrow(/invalid path segment/i)
    }
    expect(descendantCalls).toBe(0)
  })

  test('rejects empty bound dependency aliases before path collisions', async () => {
    type LeafBrick = Brick<{
      params: undefined
      result: string
    }>
    type RootBrick = Brick<{
      params: undefined
      result: string
      depends: { '': LeafBrick }
    }>

    const leaf = brick<LeafBrick>(() => 'leaf')
    const root = brick<RootBrick>((async (
      _params: undefined,
      _requirements: Empty,
      dependencies: { '': (params: undefined) => Promise<string> }
    ) => dependencies[''](undefined)) as never)
    const app = new Layer('app', { root })
    const run = app.root.run(undefined, {
      dependencies: { '': { brick: leaf } }
    } as never)

    await expect(Promise.resolve(run)).rejects.toThrow(/invalid path segment.*must not be empty/i)
  })

  test('rejects dotted bound dependency aliases before nested paths can collide', async () => {
    type LeafBrick = Brick<{
      params: undefined
      result: string
    }>
    type RootBrick = Brick<{
      params: undefined
      result: string
      depends: { 'parent.child': LeafBrick }
    }>

    const leaf = brick<LeafBrick>(() => 'leaf')
    const root = brick<RootBrick>((async (
      _params: undefined,
      _requirements: Empty,
      dependencies: { 'parent.child': (params: undefined) => Promise<string> }
    ) => dependencies['parent.child'](undefined)) as never)
    const app = new Layer('app', { root })
    const run = app.root.run(undefined, {
      dependencies: { 'parent.child': { brick: leaf } }
    })

    await expect(Promise.resolve(run)).rejects.toThrow(
      /invalid path segment.*parent\.child.*\.\W.*reserved delimiter/i
    )
  })

  test('rejects empty signal names before namespaced dispatch can collide', async () => {
    type SignalledBrick = Brick<{
      params: undefined
      result: string
      signals: { '': { request: undefined; response: string } }
    }>

    const signalled = brick<SignalledBrick>((async (
      _params: undefined,
      _requirements: Empty,
      _dependencies: Empty,
      { signals }: { signals: { '': (request: undefined) => Promise<string> } }
    ) => signals[''](undefined)) as never)
    expect(() =>
      signalled.run(undefined, {
        signals: { '': () => 'invalid' }
      } as never)
    ).toThrow(/invalid path segment.*must not be empty/i)
  })

  test('rejects dotted signal names before namespaced dispatch can collide', async () => {
    type SignalledBrick = Brick<{
      params: undefined
      result: string
      signals: { 'status.refresh': { request: undefined; response: string } }
    }>

    const signalled = brick<SignalledBrick>((async (
      _params: undefined,
      _requirements: Empty,
      _dependencies: Empty,
      { signals }: { signals: { 'status.refresh': (request: undefined) => Promise<string> } }
    ) => signals['status.refresh'](undefined)) as never)
    expect(() =>
      signalled.run(undefined, {
        signals: { 'status.refresh': () => 'invalid' }
      })
    ).toThrow(/invalid path segment.*status\.refresh.*\.\W.*reserved delimiter/i)
  })

  test('accepts unresolved dependency aliases and gives scoped Layer entries precedence', async () => {
    const layerChild = brick<ChildBrick>(async ({ id }, { repository }, { grandchild }) =>
      grandchild({ id: `layer-${repository.find(id)}` })
    )
    const bound = new Layer('bound', { parent, child: layerChild }).provide({ repository, logger })

    await bound.parent
      .run(
        { id: 'ada' },
        { dependencies: { child: { dependencies: { grandchild: { brick: grandchild } } } } }
      )
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
    type SignalledBrick = Brick<{
      params: { id: string }
      result: boolean
      signals: { approve: { request: { id: string }; response: boolean } }
    }>
    const signalled = brick<SignalledBrick>(async ({ id }, _r, _d, { signals }) =>
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
