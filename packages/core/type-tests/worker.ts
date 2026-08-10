import { type Engine, Flow, type FlowRun, Layer, P, Worker } from '../src/index'

type Empty = Record<never, never>
type Failure = 'missing' | { type: 'unavailable'; retryAfter: number }

class RootFlow extends Flow<{
  params: { id: string }
  result: { id: string }
  errors: Failure
  requires: { database: { find(id: string): string } }
  depends: Empty
  signals: {
    approve: { request: { id: string }; response: { approved: boolean } }
  }
}> {}

class QuietFlow extends Flow<{
  params: undefined
  result: number
  errors: never
  requires: Empty
  depends: Empty
  signals: Empty
}> {}

const root = new RootFlow({ depends: {}, requires: ['database'] }, ({ id }) => ({ id }))
const quiet = new QuietFlow(() => 1)
const layer = new Layer('application', { root, quiet }).provide({
  database: { find: (id: string) => id }
})
declare const engine: Engine
const worker = new Worker({ engine, layer })

// @ts-expect-error v1 Worker requires a Layer
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
          // @ts-expect-error boundary signal response must match the signal definition
          approve: () => ({ approved: 'yes' })
        }
      }
    }
  }
)
worker.run(
  root,
  // @ts-expect-error params must match the root Flow
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
// @ts-expect-error TS1320: incomplete FlowRun has a deliberately poisoned then
await incomplete

const partiallyHandled = incomplete.with('missing', () => ({ id: 'fallback' }))
// @ts-expect-error TS1320: a remaining typed failure keeps the run non-awaitable
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

class ChildSignalFlow extends Flow<{
  params: undefined
  result: string
  errors: never
  requires: Empty
  depends: Empty
  signals: { ping: { request: undefined; response: string } }
}> {}
class ParentSignalFlow extends Flow<{
  params: undefined
  result: string
  errors: never
  requires: Empty
  depends: { child: typeof ChildSignalFlow }
  signals: Empty
}> {}
const childSignal = new ChildSignalFlow({ depends: {} }, async (_p, _r, _d, { signals }) =>
  signals.ping(undefined)
)
const parentSignal = new ParentSignalFlow(
  { depends: { child: ChildSignalFlow } },
  async (_p, _r, { child }) => child(undefined)
)
class UnrelatedSignalFlow extends Flow<{
  params: undefined
  result: string
  errors: never
  requires: Empty
  depends: Empty
  signals: { unrelated: { request: undefined; response: string } }
}> {}
const unrelatedSignal = new UnrelatedSignalFlow({ depends: {} }, () => 'unrelated')
const signalLayer = new Layer('signals', { parentSignal, childSignal, unrelatedSignal })
const signalWorker = new Worker({ engine, layer: signalLayer })
// @ts-expect-error recursive dependency signals require a boundary callback
signalWorker.run(parentSignal, undefined)
signalWorker.run(parentSignal, undefined, {
  signals: { signals: { childSignal: { ping: () => 'pong' } } }
})
signalWorker.run(parentSignal, undefined, {
  signals: { signals: { childSignal: { ping: () => 'pong' } } }
})

const quietRun = worker.run(quiet, undefined)
const quietResult: number = await quietRun
void quietResult

// @ts-expect-error runs do not expose outbound signal dispatch
complete.signal({ name: 'approve', request: { id: '1' } })
