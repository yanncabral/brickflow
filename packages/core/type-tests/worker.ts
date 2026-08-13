import { type Engine, type Flow, type FlowRun, flow, Layer, P, Worker } from '../src/index'

type Failure = 'missing' | { type: 'unavailable'; retryAfter: number }

interface RootFlow extends Flow {
  params: { id: string }
  result: { id: string }
  errors: Failure
  requires: { database: { find(id: string): string } }
  signals: { approve: { request: { id: string }; response: { approved: boolean } } }
}

interface QuietFlow extends Flow {
  params: undefined
  result: number
}

const root = flow<RootFlow>(({ id }) => ({ id }))
const quiet = flow<QuietFlow>(() => 1)
const layer = new Layer('application', { root, quiet }).provide({
  database: { find: (id: string) => id }
})
declare const engine: Engine
const worker = new Worker({ engine, layer })

// @ts-expect-error Worker requires a Layer
new Worker({ engine })
// @ts-expect-error signal options are required when effective root signals exist
worker.run(root, { id: '1' })
// @ts-expect-error boundary signal handlers must be total
worker.run(root, { id: '1' }, { signals: {} })
worker.run(
  root,
  { id: '1' },
  {
    signals: {
      application: {
        root: {
          // @ts-expect-error boundary signal response must match definition
          approve: () => ({ approved: 'yes' })
        }
      }
    }
  }
)
worker.run(
  root,
  // @ts-expect-error params must match root Flow
  { missing: true },
  { signals: { application: { root: { approve: () => ({ approved: true }) } } } }
)

const incomplete = worker.run(
  root,
  { id: '1' },
  {
    id: 'run-1',
    metadata: { tenant: 'acme' },
    signals: { application: { root: { approve: ({ id }) => ({ approved: id === '1' }) } } }
  }
)
incomplete satisfies FlowRun<Failure, { id: string }>
// @ts-expect-error incomplete FlowRun has poisoned then
await incomplete
const partiallyHandled = incomplete.with('missing', () => ({ id: 'fallback' }))
// @ts-expect-error remaining typed failure keeps run non-awaitable
await partiallyHandled
const complete = partiallyHandled.with({ type: 'unavailable' }, (error) => ({
  id: `retry-${error.retryAfter}`
}))
const result: { id: string } = await complete
void result
const catchAll = incomplete.with(P._, () => ({ id: 'fallback' }))
const catchAllResult: { id: string } = await catchAll
void catchAllResult

const sideEffectOnly = incomplete.with('missing', () => undefined)
// @ts-expect-error returning undefined does not consume the failure
await sideEffectOnly

interface ChildSignalFlow extends Flow {
  params: undefined
  result: string
  signals: { ping: { request: undefined; response: string } }
}
interface ParentSignalFlow extends Flow {
  params: undefined
  result: string
  depends: { childSignal: ChildSignalFlow }
}
interface UnrelatedSignalFlow extends Flow {
  params: undefined
  result: string
  signals: { unrelated: { request: undefined; response: string } }
}
const childSignal = flow<ChildSignalFlow>(async (_p, _r, _d, { signals }) =>
  signals.ping(undefined)
)
const parentSignal = flow<ParentSignalFlow>(async (_p, _r, { childSignal }) =>
  childSignal(undefined)
)
const unrelatedSignal = flow<UnrelatedSignalFlow>(() => 'unrelated')
const signalLayer = new Layer('signals', { parentSignal, childSignal, unrelatedSignal })
const signalWorker = new Worker({ engine, layer: signalLayer })
// @ts-expect-error recursive dependency signals require boundary callback
signalWorker.run(parentSignal, undefined)
signalWorker.run(parentSignal, undefined, {
  signals: { signals: { childSignal: { ping: () => 'pong' } } }
})

signalWorker.run(parentSignal, undefined, {
  signals: {
    signals: {
      childSignal: { ping: () => 'pong' },
      // @ts-expect-error unrelated Flow signals are excluded from the root dependency graph
      unrelatedSignal: { unrelated: () => 'ignored' }
    }
  }
})

const quietResult: number = await worker.run(quiet, undefined)
void quietResult
// @ts-expect-error runs do not expose outbound signal dispatch
complete.signal({ name: 'approve', request: { id: '1' } })
