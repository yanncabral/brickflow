import {
  type Brick,
  type BrickRunOptions,
  brick,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  Layer,
  type Worker
} from '../src/index'

type Empty = Record<never, never>

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
  requires: { repository: { find(id: string): string } }
  depends: { grandchild: GrandchildBrick }
}>

type ConfiguredBrick = Brick<{
  params: { id: string }
  result: string
  depends: { child: ChildBrick }
}>

type SignalledBrick = Brick<{
  params: { id: string }
  result: boolean
  signals: { approve: { request: { id: string }; response: boolean } }
}>

const plain = brick<PlainBrick>(({ value }) => value)
const grandchild = brick<GrandchildBrick>(({ id }, { logger }) => {
  logger.log(id)
  return id
})
const child = brick<ChildBrick>(async ({ id }, { repository }, dependencies) =>
  dependencies.grandchild({ id: repository.find(id) })
)
const configured = brick<ConfiguredBrick>(async ({ id }, _requirements, dependencies) =>
  dependencies.child({ id })
)
const signalled = brick<SignalledBrick>(async ({ id }, _requirements, _dependencies, tools) =>
  tools.signals.approve({ id })
)

const repository = { find: (id: string) => id }
const logger = { log: (_message: string) => undefined }

const plainResult: number = await plain.run({ value: 1 })
void plainResult

const configuredResult: string = await configured.run(
  { id: 'ada' },
  {
    requirements: { repository, logger },
    dependencies: {
      child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
    }
  }
)
void configuredResult

// @ts-expect-error missing required direct configuration
configured.run({ id: 'ada' })
configured.run(
  { id: 'ada' },
  // @ts-expect-error missing transitive dependency alias
  { requirements: { repository, logger }, dependencies: { child } }
)
configured.run(
  { id: 'ada' },
  // @ts-expect-error incompatible dependency implementation
  { requirements: { repository, logger }, dependencies: { child: plain, grandchild } }
)
// @ts-expect-error requirements use an explicit namespace
configured.run({ id: 'ada' }, { repository, logger, dependencies: { child, grandchild } })

configured.run(
  { id: 'ada' },
  {
    requirements: { repository, logger },
    dependencies: {
      // @ts-expect-error bare Brick dependency values are rejected
      child
    }
  }
)
configured.run(
  { id: 'ada' },
  {
    requirements: { repository, logger },
    dependencies: {
      // @ts-expect-error nested dependencies are required while child remains unresolved
      child: { brick: child }
    }
  }
)

declare const customWorker: Worker
configured.run(
  { id: 'ada' },
  {
    requirements: { repository, logger },
    dependencies: {
      child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
    },
    worker: customWorker
  }
)

const partial = new Layer('configured', { configured, child, grandchild }).provide({ repository })
// @ts-expect-error logger remains unresolved
partial.configured.run({ id: 'ada' })
partial.configured.run({ id: 'ada' }, { requirements: { logger } })

const missingGrandchild = new Layer('missing-grandchild', { configured, child }).provide({
  repository,
  logger
})
// @ts-expect-error grandchild remains unresolved
missingGrandchild.configured.run({ id: 'ada' })
missingGrandchild.configured.run(
  { id: 'ada' },
  { dependencies: { child: { dependencies: { grandchild: { brick: grandchild } } } } }
)

const nestedProvider = new Layer('nested-provider', { child, grandchild }).provide({
  repository,
  logger
})
const providerApp = new Layer('provider-app', { configured, nestedProvider })
const nestedProviderResult: string = await providerApp.configured.run({ id: 'ada' })
void nestedProviderResult

const complete = partial.provide({ logger })
const boundResult: string = await complete.configured.run({ id: 'ada' })
void boundResult

signalled.run({ id: 'ada' }, { signals: { approve: ({ id }) => id === 'ada' } })
// @ts-expect-error direct signal handlers are required
signalled.run({ id: 'ada' })

const signalledLayer = new Layer('signals', { signalled })
signalledLayer.signalled.run(
  { id: 'ada' },
  { signals: { signals: { signalled: { approve: ({ id }) => id === 'ada' } } } }
)
// @ts-expect-error bound signal handlers are required
signalledLayer.signalled.run({ id: 'ada' })

type SuppliedSignalledChildBrick = Brick<{
  params: { id: string }
  result: boolean
  signals: { approve: { request: { id: string }; response: boolean } }
}>

type SuppliedSignalledParentBrick = Brick<{
  params: { id: string }
  result: boolean
  depends: { child: SuppliedSignalledChildBrick }
}>

const suppliedSignalledChild = brick<SuppliedSignalledChildBrick>(
  async ({ id }, _requirements, _dependencies, { signals }) => signals.approve({ id })
)
const suppliedSignalledParent = brick<SuppliedSignalledParentBrick>(
  async ({ id }, _requirements, { child }) => child({ id })
)
const suppliedSignalsApp = new Layer('app', { parent: suppliedSignalledParent })

suppliedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { brick: suppliedSignalledChild } },
    signals: { child: { approve: ({ id }) => id === 'ada' } }
  }
)
suppliedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { brick: suppliedSignalledChild } },
    // @ts-expect-error supplied dependency signal handlers remain required
    signals: {}
  }
)

type MixedSignalledParentBrick = Brick<{
  params: { id: string }
  result: boolean
  depends: { child: SuppliedSignalledChildBrick }
  signals: { confirm: { request: { id: string }; response: boolean } }
}>

const mixedSignalledParent = brick<MixedSignalledParentBrick>(
  async ({ id }, _requirements, { child }, { signals }) =>
    (await signals.confirm({ id })) && child({ id })
)
const mixedSignalsApp = new Layer('app', { parent: mixedSignalledParent })
mixedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { brick: suppliedSignalledChild } },
    signals: {
      app: { parent: { confirm: ({ id }) => id === 'ada' } },
      child: { approve: ({ id }) => id === 'ada' }
    }
  }
)
mixedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { brick: suppliedSignalledChild } },
    // @ts-expect-error mixed signal handlers require the Layer-resolved namespace
    signals: { child: { approve: ({ id }) => id === 'ada' } }
  }
)

const app = new Layer('app', { nested: complete })
const nestedResult: string = await app.nested.configured.run({ id: 'ada' })
void nestedResult

type ScopedRepositoryBrick = Brick<{
  params: undefined
  result: string
}>

type ScopedCheckoutBrick = Brick<{
  params: undefined
  result: string
  depends: { repository: ScopedRepositoryBrick }
}>

type ScopedPlaceOrderBrick = Brick<{
  params: undefined
  result: string
  depends: { checkout: ScopedCheckoutBrick }
}>

const scopedRepository = brick<ScopedRepositoryBrick>(() => 'repository')
const scopedCheckout = brick<ScopedCheckoutBrick>(async (_params, _requirements, dependencies) =>
  dependencies.repository(undefined)
)
const scopedPlaceOrder = brick<ScopedPlaceOrderBrick>(
  async (_params, _requirements, dependencies) => dependencies.checkout(undefined)
)

const checkoutWithLocalRepository = new Layer('checkout', {
  checkout: scopedCheckout,
  repository: scopedRepository
})
const reportingWithRepository = new Layer('reporting', { repository: scopedRepository })
const locallyResolvedApp = new Layer('app', {
  placeOrder: scopedPlaceOrder,
  checkout: checkoutWithLocalRepository,
  reporting: reportingWithRepository
})
locallyResolvedApp.placeOrder.run(undefined)

type LayerResolvedRepositoryBrick = Brick<{
  params: undefined
  result: string
  signals: { refresh: { request: undefined; response: string } }
}>
type LayerResolvedCheckoutBrick = Brick<{
  params: undefined
  result: string
  depends: { repository: LayerResolvedRepositoryBrick }
}>
type LayerResolvedOrderBrick = Brick<{
  params: undefined
  result: string
  depends: { checkout: LayerResolvedCheckoutBrick }
}>
const layerResolvedRepository = brick<LayerResolvedRepositoryBrick>(() => 'repository')
const layerResolvedCheckout = brick<LayerResolvedCheckoutBrick>(() => 'checkout')
const layerResolvedOrder = brick<LayerResolvedOrderBrick>(() => 'order')
const layerResolvedSignalApp = new Layer('app', {
  order: layerResolvedOrder,
  checkout: new Layer('checkout', {
    checkout: layerResolvedCheckout,
    repository: layerResolvedRepository
  }),
  reporting: new Layer('reporting', { repository: layerResolvedRepository })
})
// @ts-expect-error the locally resolved nested repository signal handler is required
layerResolvedSignalApp.order.run(undefined)
layerResolvedSignalApp.order.run(undefined, {
  signals: { app: { checkout: { repository: { refresh: () => 'refreshed' } } } }
})
layerResolvedSignalApp.order.run(undefined, {
  signals: {
    app: {
      checkout: {
        // @ts-expect-error fully resolved transitive signal path must not duplicate checkout
        checkout: { repository: { refresh: () => 'wrong' } }
      }
    }
  }
})

const suppliedCheckoutApp = new Layer('supplied-checkout-app', {
  placeOrder: scopedPlaceOrder,
  repository: scopedRepository
})
suppliedCheckoutApp.placeOrder.run(undefined, {
  dependencies: { checkout: { brick: scopedCheckout } }
})

const checkoutWithoutRepository = new Layer('checkout-without-repository', {
  checkout: scopedCheckout
})
const inventoryWithRepository = new Layer('inventory', { repository: scopedRepository })
const ambiguouslyResolvedApp = new Layer('ambiguous-app', {
  placeOrder: scopedPlaceOrder,
  checkout: checkoutWithoutRepository,
  reporting: reportingWithRepository,
  inventory: inventoryWithRepository
})
// @ts-expect-error checkout's transitive repository alias is globally ambiguous
ambiguouslyResolvedApp.placeOrder.run(undefined)
ambiguouslyResolvedApp.placeOrder.run(undefined, {
  dependencies: {
    checkout: { dependencies: { repository: { brick: scopedRepository } } }
  }
})

const uniquelyResolvedApp = new Layer('unique-app', {
  placeOrder: scopedPlaceOrder,
  checkout: checkoutWithoutRepository,
  reporting: reportingWithRepository
})
uniquelyResolvedApp.placeOrder.run(undefined)

const transitivelyUnresolvedApp = new Layer('transitively-unresolved-app', {
  placeOrder: scopedPlaceOrder,
  checkout: checkoutWithoutRepository
})
// @ts-expect-error genuinely unresolved transitive aliases remain required
transitivelyUnresolvedApp.placeOrder.run(undefined)
transitivelyUnresolvedApp.placeOrder.run(undefined, {
  dependencies: {
    checkout: { dependencies: { repository: { brick: scopedRepository } } }
  }
})

const directlyUnresolvedApp = new Layer('directly-unresolved-app', {
  placeOrder: scopedPlaceOrder
})
directlyUnresolvedApp.placeOrder.run(undefined, {
  dependencies: {
    // @ts-expect-error unresolved direct nodes require their recursive child dependencies
    checkout: { brick: scopedCheckout }
  }
})
directlyUnresolvedApp.placeOrder.run(undefined, {
  dependencies: {
    checkout: {
      brick: scopedCheckout,
      dependencies: { repository: { brick: scopedRepository } }
    }
  }
})

type DepthLeafBrick = Brick<{
  params: undefined
  result: undefined
}>
type Depth16Brick = Brick<{
  params: undefined
  result: undefined
  depends: { leaf: DepthLeafBrick }
}>
type Depth15Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth16: Depth16Brick }
}>
type Depth14Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth15: Depth15Brick }
}>
type Depth13Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth14: Depth14Brick }
}>
type Depth12Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth13: Depth13Brick }
}>
type Depth11Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth12: Depth12Brick }
}>
type Depth10Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth11: Depth11Brick }
}>
type Depth9Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth10: Depth10Brick }
}>
type Depth8Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth9: Depth9Brick }
}>
type Depth7Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth8: Depth8Brick }
}>
type Depth6Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth7: Depth7Brick }
}>
type Depth5Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth6: Depth6Brick }
}>
type Depth4Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth5: Depth5Brick }
}>
type Depth3Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth4: Depth4Brick }
}>
type Depth2Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth3: Depth3Brick }
}>
type Depth1Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth2: Depth2Brick }
}>
type DepthRootBrick = Brick<{
  params: undefined
  result: undefined
  depends: { depth1: Depth1Brick }
}>

declare const depthRoot: ReturnType<typeof brick<DepthRootBrick>>
declare const depth1: ReturnType<typeof brick<Depth1Brick>>
declare const depth2: ReturnType<typeof brick<Depth2Brick>>
declare const depth3: ReturnType<typeof brick<Depth3Brick>>
declare const depth4: ReturnType<typeof brick<Depth4Brick>>
declare const depth5: ReturnType<typeof brick<Depth5Brick>>
declare const depth6: ReturnType<typeof brick<Depth6Brick>>
declare const depth7: ReturnType<typeof brick<Depth7Brick>>
declare const depth8: ReturnType<typeof brick<Depth8Brick>>
declare const depth9: ReturnType<typeof brick<Depth9Brick>>
declare const depth10: ReturnType<typeof brick<Depth10Brick>>
declare const depth11: ReturnType<typeof brick<Depth11Brick>>
declare const depth12: ReturnType<typeof brick<Depth12Brick>>
declare const depth13: ReturnType<typeof brick<Depth13Brick>>
declare const depth14: ReturnType<typeof brick<Depth14Brick>>
declare const depth15: ReturnType<typeof brick<Depth15Brick>>
declare const depth16: ReturnType<typeof brick<Depth16Brick>>
declare const depthLeaf: ReturnType<typeof brick<DepthLeafBrick>>

const depthBoundedLayer = new Layer('depth-bounded', {
  depthRoot,
  depth1,
  depth2,
  depth3,
  depth4,
  depth5,
  depth6,
  depth7,
  depth8,
  depth9,
  depth10,
  depth11,
  depth12,
  depth13,
  depth14,
  depth15,
  depth16
})
// @ts-expect-error depth exhaustion conservatively retains unresolved aliases
depthBoundedLayer.depthRoot.run(undefined)
depthBoundedLayer.depthRoot.run(undefined, {
  dependencies: {
    depth1: {
      dependencies: {
        depth2: {
          dependencies: {
            depth3: {
              dependencies: {
                depth4: {
                  dependencies: {
                    depth5: {
                      dependencies: {
                        depth6: {
                          dependencies: {
                            depth7: {
                              dependencies: {
                                depth8: {
                                  dependencies: {
                                    depth9: {
                                      dependencies: {
                                        depth10: {
                                          dependencies: {
                                            depth11: {
                                              dependencies: {
                                                depth12: {
                                                  dependencies: {
                                                    depth13: {
                                                      dependencies: {
                                                        depth14: {
                                                          dependencies: {
                                                            depth15: {
                                                              dependencies: {
                                                                depth16: {
                                                                  dependencies: {
                                                                    leaf: {
                                                                      brick: depthLeaf,
                                                                      dependencies: {}
                                                                    }
                                                                  }
                                                                }
                                                              }
                                                            }
                                                          }
                                                        }
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
})

// @ts-expect-error depth fallback does not accept an empty dependency graph
depthBoundedLayer.depthRoot.run(undefined, { dependencies: {} })
depthBoundedLayer.depthRoot.run(undefined, {
  dependencies: {
    // @ts-expect-error depth fallback requires the known next alias
    depth1: { dependencies: {} }
  }
})

type DepthSignalLeafBrick = Brick<{
  params: undefined
  result: undefined
  signals: { refresh: { request: undefined; response: boolean } }
}>
type DepthSignal16Brick = Brick<{
  params: undefined
  result: undefined
  depends: { leaf: DepthSignalLeafBrick }
}>
type DepthSignal15Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth16: DepthSignal16Brick }
}>
type DepthSignal14Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth15: DepthSignal15Brick }
}>
type DepthSignal13Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth14: DepthSignal14Brick }
}>
type DepthSignal12Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth13: DepthSignal13Brick }
}>
type DepthSignal11Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth12: DepthSignal12Brick }
}>
type DepthSignal10Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth11: DepthSignal11Brick }
}>
type DepthSignal9Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth10: DepthSignal10Brick }
}>
type DepthSignal8Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth9: DepthSignal9Brick }
}>
type DepthSignal7Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth8: DepthSignal8Brick }
}>
type DepthSignal6Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth7: DepthSignal7Brick }
}>
type DepthSignal5Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth6: DepthSignal6Brick }
}>
type DepthSignal4Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth5: DepthSignal5Brick }
}>
type DepthSignal3Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth4: DepthSignal4Brick }
}>
type DepthSignal2Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth3: DepthSignal3Brick }
}>
type DepthSignal1Brick = Brick<{
  params: undefined
  result: undefined
  depends: { depth2: DepthSignal2Brick }
}>
type DepthSignalRootBrick = Brick<{
  params: undefined
  result: undefined
  depends: { depth1: DepthSignal1Brick }
}>

declare const depthSignalRoot: ReturnType<typeof brick<DepthSignalRootBrick>>
type DepthSignalRunOptions = BrickRunOptions<DepthSignalRootBrick>
// @ts-expect-error depth exhaustion must not make required deeper signal config disappear
const omittedDepthSignalOptions: DepthSignalRunOptions = { dependencies: {} as never }
const emptyDepthSignalOptions: DepthSignalRunOptions = {
  dependencies: {} as never,
  // @ts-expect-error depth exhaustion must reject an empty signal config
  signals: {}
}
const incompleteDepthSignalOptions: DepthSignalRunOptions = {
  dependencies: {} as never,
  // @ts-expect-error depth exhaustion must reject incomplete known signal paths
  signals: { depth1: {} }
}
void depthSignalRoot
void omittedDepthSignalOptions
void emptyDepthSignalOptions
void incompleteDepthSignalOptions

type BooleanSignalChildBrick = Brick<{
  params: undefined
  result: undefined
  signals: { approve: { request: undefined; response: boolean } }
}>
type StringSignalChildBrick = Brick<{
  params: undefined
  result: undefined
  signals: { approve: { request: undefined; response: string } }
}>
type BooleanSignalParentBrick = Brick<{
  params: undefined
  result: undefined
  depends: { child: BooleanSignalChildBrick }
}>
declare const booleanSignalParent: ReturnType<typeof brick<BooleanSignalParentBrick>>
declare const stringSignalChild: ReturnType<typeof brick<StringSignalChildBrick>>
booleanSignalParent.run(undefined, {
  dependencies: {
    // @ts-expect-error incompatible signal contracts at the same dependency path are rejected
    child: { brick: stringSignalChild }
  },
  signals: { child: { approve: () => true } }
})

const worker: Worker = {
  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure> {
    return {
      id: request.id,
      result: request.execute(),
      status: async () => 'running',
      cancel: async () => {},
      signal: request.signal
    }
  }
}
void worker
void ({} as Empty)
