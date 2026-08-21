import {
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  type Flow,
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
    dependencies: { child, grandchild }
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

declare const customWorker: Worker
configured.run(
  { id: 'ada' },
  {
    requirements: { repository, logger },
    dependencies: { child, grandchild },
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
missingGrandchild.configured.run({ id: 'ada' }, { dependencies: { grandchild } })

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

const app = new Layer('app', { nested: complete })
const nestedResult: string = await app.nested.configured.run({ id: 'ada' })
void nestedResult

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
