import {
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  type Flow,
  type FlowRunOptions,
  flow,
  Layer,
  type Worker
} from '../src/index'

type Empty = Record<never, never>

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
  requires: { repository: { find(id: string): string } }
  depends: { grandchild: GrandchildFlow }
}

interface ConfiguredFlow extends Flow {
  params: { id: string }
  result: string
  depends: { child: ChildFlow }
}

interface SignalledFlow extends Flow {
  params: { id: string }
  result: boolean
  signals: { approve: { request: { id: string }; response: boolean } }
}

const plain = flow<PlainFlow>(({ value }) => value)
const grandchild = flow<GrandchildFlow>(({ id }, { logger }) => {
  logger.log(id)
  return id
})
const child = flow<ChildFlow>(async ({ id }, { repository }, dependencies) =>
  dependencies.grandchild({ id: repository.find(id) })
)
const configured = flow<ConfiguredFlow>(async ({ id }, _requirements, dependencies) =>
  dependencies.child({ id })
)
const signalled = flow<SignalledFlow>(async ({ id }, _requirements, _dependencies, tools) =>
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
      child: { flow: child, dependencies: { grandchild: { flow: grandchild } } }
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
      // @ts-expect-error bare Flow dependency values are rejected
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
      child: { flow: child }
    }
  }
)

declare const customWorker: Worker
configured.run(
  { id: 'ada' },
  {
    requirements: { repository, logger },
    dependencies: {
      child: { flow: child, dependencies: { grandchild: { flow: grandchild } } }
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
  { dependencies: { child: { dependencies: { grandchild: { flow: grandchild } } } } }
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

interface SuppliedSignalledChildFlow extends Flow {
  params: { id: string }
  result: boolean
  signals: { approve: { request: { id: string }; response: boolean } }
}

interface SuppliedSignalledParentFlow extends Flow {
  params: { id: string }
  result: boolean
  depends: { child: SuppliedSignalledChildFlow }
}

const suppliedSignalledChild = flow<SuppliedSignalledChildFlow>(
  async ({ id }, _requirements, _dependencies, { signals }) => signals.approve({ id })
)
const suppliedSignalledParent = flow<SuppliedSignalledParentFlow>(
  async ({ id }, _requirements, { child }) => child({ id })
)
const suppliedSignalsApp = new Layer('app', { parent: suppliedSignalledParent })

suppliedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { flow: suppliedSignalledChild } },
    signals: { child: { approve: ({ id }) => id === 'ada' } }
  }
)
suppliedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { flow: suppliedSignalledChild } },
    // @ts-expect-error supplied dependency signal handlers remain required
    signals: {}
  }
)

interface MixedSignalledParentFlow extends Flow {
  params: { id: string }
  result: boolean
  depends: { child: SuppliedSignalledChildFlow }
  signals: { confirm: { request: { id: string }; response: boolean } }
}

const mixedSignalledParent = flow<MixedSignalledParentFlow>(
  async ({ id }, _requirements, { child }, { signals }) =>
    (await signals.confirm({ id })) && child({ id })
)
const mixedSignalsApp = new Layer('app', { parent: mixedSignalledParent })
mixedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { flow: suppliedSignalledChild } },
    signals: {
      app: { parent: { confirm: ({ id }) => id === 'ada' } },
      child: { approve: ({ id }) => id === 'ada' }
    }
  }
)
mixedSignalsApp.parent.run(
  { id: 'ada' },
  {
    dependencies: { child: { flow: suppliedSignalledChild } },
    // @ts-expect-error mixed signal handlers require the Layer-resolved namespace
    signals: { child: { approve: ({ id }) => id === 'ada' } }
  }
)

const app = new Layer('app', { nested: complete })
const nestedResult: string = await app.nested.configured.run({ id: 'ada' })
void nestedResult

interface ScopedRepositoryFlow extends Flow {
  params: undefined
  result: string
}

interface ScopedCheckoutFlow extends Flow {
  params: undefined
  result: string
  depends: { repository: ScopedRepositoryFlow }
}

interface ScopedPlaceOrderFlow extends Flow {
  params: undefined
  result: string
  depends: { checkout: ScopedCheckoutFlow }
}

const scopedRepository = flow<ScopedRepositoryFlow>(() => 'repository')
const scopedCheckout = flow<ScopedCheckoutFlow>(async (_params, _requirements, dependencies) =>
  dependencies.repository(undefined)
)
const scopedPlaceOrder = flow<ScopedPlaceOrderFlow>(async (_params, _requirements, dependencies) =>
  dependencies.checkout(undefined)
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

interface LayerResolvedRepositoryFlow extends Flow {
  params: undefined
  result: string
  signals: { refresh: { request: undefined; response: string } }
}
interface LayerResolvedCheckoutFlow extends Flow {
  params: undefined
  result: string
  depends: { repository: LayerResolvedRepositoryFlow }
}
interface LayerResolvedOrderFlow extends Flow {
  params: undefined
  result: string
  depends: { checkout: LayerResolvedCheckoutFlow }
}
const layerResolvedRepository = flow<LayerResolvedRepositoryFlow>(() => 'repository')
const layerResolvedCheckout = flow<LayerResolvedCheckoutFlow>(() => 'checkout')
const layerResolvedOrder = flow<LayerResolvedOrderFlow>(() => 'order')
const layerResolvedSignalApp = new Layer('app', {
  order: layerResolvedOrder,
  checkout: new Layer('checkout', {
    checkout: layerResolvedCheckout,
    repository: layerResolvedRepository
  })
})
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
  dependencies: { checkout: { flow: scopedCheckout } }
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
    checkout: { dependencies: { repository: { flow: scopedRepository } } }
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
    checkout: { dependencies: { repository: { flow: scopedRepository } } }
  }
})

const directlyUnresolvedApp = new Layer('directly-unresolved-app', {
  placeOrder: scopedPlaceOrder
})
directlyUnresolvedApp.placeOrder.run(undefined, {
  dependencies: {
    // @ts-expect-error unresolved direct nodes require their recursive child dependencies
    checkout: { flow: scopedCheckout }
  }
})
directlyUnresolvedApp.placeOrder.run(undefined, {
  dependencies: {
    checkout: {
      flow: scopedCheckout,
      dependencies: { repository: { flow: scopedRepository } }
    }
  }
})

interface DepthLeafFlow extends Flow {
  params: undefined
  result: undefined
}
interface Depth16Flow extends Flow {
  params: undefined
  result: undefined
  depends: { leaf: DepthLeafFlow }
}
interface Depth15Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth16: Depth16Flow }
}
interface Depth14Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth15: Depth15Flow }
}
interface Depth13Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth14: Depth14Flow }
}
interface Depth12Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth13: Depth13Flow }
}
interface Depth11Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth12: Depth12Flow }
}
interface Depth10Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth11: Depth11Flow }
}
interface Depth9Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth10: Depth10Flow }
}
interface Depth8Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth9: Depth9Flow }
}
interface Depth7Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth8: Depth8Flow }
}
interface Depth6Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth7: Depth7Flow }
}
interface Depth5Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth6: Depth6Flow }
}
interface Depth4Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth5: Depth5Flow }
}
interface Depth3Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth4: Depth4Flow }
}
interface Depth2Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth3: Depth3Flow }
}
interface Depth1Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth2: Depth2Flow }
}
interface DepthRootFlow extends Flow {
  params: undefined
  result: undefined
  depends: { depth1: Depth1Flow }
}

declare const depthRoot: ReturnType<typeof flow<DepthRootFlow>>
declare const depth1: ReturnType<typeof flow<Depth1Flow>>
declare const depth2: ReturnType<typeof flow<Depth2Flow>>
declare const depth3: ReturnType<typeof flow<Depth3Flow>>
declare const depth4: ReturnType<typeof flow<Depth4Flow>>
declare const depth5: ReturnType<typeof flow<Depth5Flow>>
declare const depth6: ReturnType<typeof flow<Depth6Flow>>
declare const depth7: ReturnType<typeof flow<Depth7Flow>>
declare const depth8: ReturnType<typeof flow<Depth8Flow>>
declare const depth9: ReturnType<typeof flow<Depth9Flow>>
declare const depth10: ReturnType<typeof flow<Depth10Flow>>
declare const depth11: ReturnType<typeof flow<Depth11Flow>>
declare const depth12: ReturnType<typeof flow<Depth12Flow>>
declare const depth13: ReturnType<typeof flow<Depth13Flow>>
declare const depth14: ReturnType<typeof flow<Depth14Flow>>
declare const depth15: ReturnType<typeof flow<Depth15Flow>>
declare const depth16: ReturnType<typeof flow<Depth16Flow>>
declare const depthLeaf: ReturnType<typeof flow<DepthLeafFlow>>

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
                                                                      flow: depthLeaf,
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

interface DepthSignalLeafFlow extends Flow {
  params: undefined
  result: undefined
  signals: { refresh: { request: undefined; response: boolean } }
}
interface DepthSignal16Flow extends Flow {
  params: undefined
  result: undefined
  depends: { leaf: DepthSignalLeafFlow }
}
interface DepthSignal15Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth16: DepthSignal16Flow }
}
interface DepthSignal14Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth15: DepthSignal15Flow }
}
interface DepthSignal13Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth14: DepthSignal14Flow }
}
interface DepthSignal12Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth13: DepthSignal13Flow }
}
interface DepthSignal11Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth12: DepthSignal12Flow }
}
interface DepthSignal10Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth11: DepthSignal11Flow }
}
interface DepthSignal9Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth10: DepthSignal10Flow }
}
interface DepthSignal8Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth9: DepthSignal9Flow }
}
interface DepthSignal7Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth8: DepthSignal8Flow }
}
interface DepthSignal6Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth7: DepthSignal7Flow }
}
interface DepthSignal5Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth6: DepthSignal6Flow }
}
interface DepthSignal4Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth5: DepthSignal5Flow }
}
interface DepthSignal3Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth4: DepthSignal4Flow }
}
interface DepthSignal2Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth3: DepthSignal3Flow }
}
interface DepthSignal1Flow extends Flow {
  params: undefined
  result: undefined
  depends: { depth2: DepthSignal2Flow }
}
interface DepthSignalRootFlow extends Flow {
  params: undefined
  result: undefined
  depends: { depth1: DepthSignal1Flow }
}

declare const depthSignalRoot: ReturnType<typeof flow<DepthSignalRootFlow>>
type DepthSignalRunOptions = FlowRunOptions<DepthSignalRootFlow>
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

interface BooleanSignalChildFlow extends Flow {
  params: undefined
  result: undefined
  signals: { approve: { request: undefined; response: boolean } }
}
interface StringSignalChildFlow extends Flow {
  params: undefined
  result: undefined
  signals: { approve: { request: undefined; response: string } }
}
interface BooleanSignalParentFlow extends Flow {
  params: undefined
  result: undefined
  depends: { child: BooleanSignalChildFlow }
}
declare const booleanSignalParent: ReturnType<typeof flow<BooleanSignalParentFlow>>
declare const stringSignalChild: ReturnType<typeof flow<StringSignalChildFlow>>
booleanSignalParent.run(undefined, {
  dependencies: {
    // @ts-expect-error incompatible signal contracts at the same dependency path are rejected
    child: { flow: stringSignalChild }
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
