import { describe, expect, test } from 'bun:test'
import {
  type Brick,
  type BrickPlugin,
  type BrickPluginContext,
  type BrickPluginExit,
  brick,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  Layer,
  LocalWorker,
  P,
  type Worker
} from '../src/index'

type ChildBrick = Brick<{
  params: { id: string }
  result: string
  errors: 'missing'
}>

type PureBrick = Brick<{
  params: { id: string }
  result: string
}>

type ParentBrick = Brick<{
  params: { id: string }
  result: string
  depends: { child: ChildBrick }
}>

type SignalledBrick = Brick<{
  params: { id: string }
  result: boolean
  signals: { approve: { request: { id: string }; response: boolean } }
}>

function recorder() {
  const events: string[] = []
  const contexts: BrickPluginContext[] = []
  const exits: BrickPluginExit[] = []
  const plugin = (name: string): BrickPlugin => ({
    name,
    onStart: (context) => {
      events.push(`${name}:start`)
      contexts.push(context)
    },
    onSuccess: (_context, _value) => {
      events.push(`${name}:success`)
    },
    onFailure: (_context, _error) => {
      events.push(`${name}:failure`)
    },
    onDefect: (_context, _error) => {
      events.push(`${name}:defect`)
    },
    onFinally: (_context, exit) => {
      events.push(`${name}:finally:${exit.kind}`)
      exits.push(exit)
    }
  })
  return { events, contexts, exits, plugin }
}

describe('Brick plugins', () => {
  test('emits one span per execution for root and child bricks', async () => {
    const { events, contexts, plugin } = recorder()
    const tracer = plugin('tracer')
    const child = brick<ChildBrick>({ plugins: [tracer] }, ({ id }) => `hello ${id}`)
    const parent = brick<ParentBrick>({ plugins: [tracer] }, async ({ id }, _r, { child }) =>
      child({ id })
    )

    await Promise.resolve(parent.run({ id: 'ada' }, { dependencies: { child: { brick: child } } }))

    expect(events).toEqual([
      'tracer:start',
      'tracer:start',
      'tracer:success',
      'tracer:finally:success',
      'tracer:success',
      'tracer:finally:success'
    ])
    expect(contexts).toHaveLength(2)
    // Child span carries its own params; root span carries root params.
    expect(contexts.map((context) => context.params)).toEqual([{ id: 'ada' }, { id: 'ada' }])
    for (const context of contexts) {
      expect(typeof context.callId).toBe('string')
      expect(context.isReplay).toBe(false)
    }
  })

  test('merges plugins in Worker, Root, Call-site, Child order', async () => {
    const order: string[] = []
    const named = (name: string): BrickPlugin => ({
      name,
      onStart: () => {
        order.push(name)
      }
    })
    const workerPlugin = named('worker')
    const rootPlugin = named('root')
    const callSitePlugin = named('callsite')
    const childPlugin = named('child')

    const workerBase = new LocalWorker()
    const worker: Worker = {
      plugins: [workerPlugin],
      start: <Result, Failure>(request: EngineExecutionRequest<Result, Failure>) =>
        workerBase.start(request) as EngineExecutionHandle<Result, Failure>
    }

    const child = brick<ChildBrick>({ plugins: [childPlugin] }, ({ id }) => `hello ${id}`)
    const parent = brick<ParentBrick>({ plugins: [rootPlugin] }, async ({ id }, _r, { child }) =>
      child({ id }, { plugins: [callSitePlugin] })
    )

    await Promise.resolve(
      parent.run({ id: 'ada' }, { dependencies: { child: { brick: child } }, worker })
    )

    const childStart = order.indexOf('child')
    expect(order.slice(childStart - 3, childStart + 1)).toEqual([
      'worker',
      'root',
      'callsite',
      'child'
    ])
  })

  test('keeps typed failures distinct from defects', async () => {
    const { events, exits, plugin } = recorder()
    const observer = plugin('observer')

    const failing = brick<ChildBrick>({ plugins: [observer] }, (_params, _r, _d, { fail }) =>
      fail('missing')
    )
    await expect(
      Promise.resolve(failing.run({ id: 'ada' }).with('missing', () => 'recovered'))
    ).resolves.toBe('recovered')
    expect(events).toEqual(['observer:start', 'observer:failure', 'observer:finally:failure'])
    expect(exits).toEqual([{ kind: 'failure', error: 'missing' }])

    const { events: defectEvents, exits: defectExits, plugin: defectRecorder } = recorder()
    const defectObserver = defectRecorder('observer')
    const defective = brick<ChildBrick>({ plugins: [defectObserver] }, () => {
      throw new Error('boom')
    })
    await expect(Promise.resolve(defective.run({ id: 'ada' }))).rejects.toThrow('boom')
    expect(defectEvents).toEqual(['observer:start', 'observer:defect', 'observer:finally:defect'])
    expect(defectExits[0]?.kind).toBe('defect')
  })

  test('exposes brickId, callId, paths, params, and metadata in context', async () => {
    const seen: BrickPluginContext[] = []
    const observer: BrickPlugin = {
      onStart: (context) => {
        seen.push(context)
      }
    }
    const child = brick<ChildBrick>(({ id }) => `hello ${id}`)
    const parent = brick<ParentBrick>(async ({ id }, _r, { child }) => child({ id }))
    const app = new Layer('app', { parent, child })

    const run = app.parent.run({ id: 'ada' }, { metadata: { tenant: 'acme' }, plugins: [observer] })
    await Promise.resolve(run.with(P._, () => 'fallback'))

    expect(seen).toHaveLength(2)
    const root = seen[0] as BrickPluginContext
    expect(root.brickId).toBe('app.parent')
    expect(root.callId).toBe(run.id)
    expect(root.layerPath).toEqual(['app'])
    expect(root.brickPath).toEqual(['parent'])
    expect(root.params).toEqual({ id: 'ada' })
    expect(root.metadata).toEqual({ tenant: 'acme' })
  })

  test('emits signal events with request and response', async () => {
    const signals: { name: string; request: unknown; response: unknown }[] = []
    const observer: BrickPlugin = {
      onSignal: (_context, signal) => {
        signals.push({ name: signal.name, request: signal.request, response: signal.response })
      }
    }
    const signalled = brick<SignalledBrick>(
      { plugins: [observer] },
      async ({ id }, _r, _d, { signals }) => signals.approve({ id })
    )

    await expect(
      Promise.resolve(
        signalled.run({ id: 'ada' }, { signals: { approve: ({ id }) => id === 'ada' } })
      )
    ).resolves.toBe(true)
    expect(signals).toEqual([{ name: 'approve', request: { id: 'ada' }, response: true }])
  })

  test('skips replay events by default and emits when the plugin opts in', async () => {
    const defaulted: string[] = []
    const optedIn: string[] = []
    const quiet: BrickPlugin = {
      name: 'quiet',
      onStart: () => {
        defaulted.push('start')
      }
    }
    const noisy: BrickPlugin = {
      name: 'noisy',
      replay: 'emit',
      onStart: () => {
        optedIn.push('start')
      }
    }
    const plain = brick<Brick<{ params: undefined; result: string }>>(
      { plugins: [quiet, noisy] },
      () => 'ok'
    )

    await Promise.resolve(plain.run(undefined, { isReplay: true }))
    expect(defaulted).toEqual([])
    expect(optedIn).toEqual(['start'])

    await Promise.resolve(plain.run(undefined))
    expect(defaulted).toEqual(['start'])
    expect(optedIn).toEqual(['start', 'start'])
  })

  test('throwing onStart does not break successful execution', async () => {
    const events: string[] = []
    const explosive: BrickPlugin = {
      name: 'explosive',
      onStart: () => {
        throw new Error('plugin start boom')
      },
      onSuccess: () => {
        events.push('success-seen')
      },
      onFinally: (_context, exit) => {
        events.push(`finally:${exit.kind}`)
      }
    }
    const ok = brick<PureBrick>({ plugins: [explosive] }, ({ id }) => `hello ${id}`)

    await expect(Promise.resolve(ok.run({ id: 'ada' }))).resolves.toBe('hello ada')
    expect(events).toEqual(['success-seen', 'finally:success'])
  })

  test('throwing onFailure does not mask a typed failure', async () => {
    const explosive: BrickPlugin = {
      name: 'explosive',
      onFailure: () => {
        throw new Error('plugin failure boom')
      }
    }
    const failing = brick<ChildBrick>({ plugins: [explosive] }, (_params, _r, _d, { fail }) =>
      fail('missing')
    )

    await expect(
      Promise.resolve(failing.run({ id: 'ada' }).with('missing', () => 'recovered'))
    ).resolves.toBe('recovered')
  })

  test('throwing onDefect preserves the original defect', async () => {
    const explosive: BrickPlugin = {
      name: 'explosive',
      onDefect: () => {
        throw new Error('plugin defect boom')
      }
    }
    const defective = brick<ChildBrick>({ plugins: [explosive] }, () => {
      throw new Error('original boom')
    })

    await expect(Promise.resolve(defective.run({ id: 'ada' }))).rejects.toThrow('original boom')
  })

  test('throwing onSignal does not break the signal call', async () => {
    const explosive: BrickPlugin = {
      name: 'explosive',
      onSignal: () => {
        throw new Error('plugin signal boom')
      }
    }
    const signalled = brick<SignalledBrick>(
      { plugins: [explosive] },
      async ({ id }, _r, _d, { signals }) => signals.approve({ id })
    )

    await expect(
      Promise.resolve(
        signalled.run({ id: 'ada' }, { signals: { approve: ({ id }) => id === 'ada' } })
      )
    ).resolves.toBe(true)
  })

  test('onFinally still runs when an earlier hook threw', async () => {
    const events: string[] = []
    const explosive: BrickPlugin = {
      name: 'explosive',
      onStart: () => {
        throw new Error('plugin start boom')
      },
      onSuccess: () => {
        throw new Error('plugin success boom')
      },
      onFinally: (_context, exit) => {
        events.push(`finally:${exit.kind}`)
      }
    }
    const ok = brick<PureBrick>({ plugins: [explosive] }, ({ id }) => `hello ${id}`)

    await expect(Promise.resolve(ok.run({ id: 'ada' }))).resolves.toBe('hello ada')
    expect(events).toEqual(['finally:success'])
  })

  test('a throwing plugin does not prevent other plugins from receiving events', async () => {
    const events: string[] = []
    const broken: BrickPlugin = {
      name: 'broken',
      onStart: () => {
        throw new Error('broken start boom')
      },
      onSuccess: () => {
        throw new Error('broken success boom')
      },
      onFinally: () => {
        throw new Error('broken finally boom')
      }
    }
    const healthy: BrickPlugin = {
      name: 'healthy',
      onStart: () => {
        events.push('healthy:start')
      },
      onSuccess: () => {
        events.push('healthy:success')
      },
      onFinally: (_context, exit) => {
        events.push(`healthy:finally:${exit.kind}`)
      }
    }
    const ok = brick<PureBrick>({ plugins: [broken, healthy] }, ({ id }) => `hello ${id}`)

    await expect(Promise.resolve(ok.run({ id: 'ada' }))).resolves.toBe('hello ada')
    expect(events).toEqual(['healthy:start', 'healthy:success', 'healthy:finally:success'])
  })

  test('fake durable worker executing twice respects replay opt-in', async () => {
    const executions: string[] = []
    const defaulted: string[] = []
    const optedIn: string[] = []
    const quiet: BrickPlugin = {
      name: 'quiet',
      onStart: () => {
        defaulted.push('start')
      },
      onFinally: () => {
        defaulted.push('finally')
      }
    }
    const noisy: BrickPlugin = {
      name: 'noisy',
      replay: 'emit',
      onStart: () => {
        optedIn.push('start')
      },
      onFinally: () => {
        optedIn.push('finally')
      }
    }
    const base = new LocalWorker()
    const durableWorker: Worker = {
      start: <Result, Failure>(request: EngineExecutionRequest<Result, Failure>) => {
        executions.push(request.id)
        return base.start(request) as EngineExecutionHandle<Result, Failure>
      }
    }
    const plain = brick<Brick<{ params: undefined; result: string }>>(
      { plugins: [quiet, noisy] },
      () => 'ok'
    )

    // First execution: normal run through the durable worker.
    await Promise.resolve(plain.run(undefined, { worker: durableWorker, id: 'durable-1' }))
    expect(defaulted).toEqual(['start', 'finally'])
    expect(optedIn).toEqual(['start', 'finally'])

    // Second execution: durable replay of the same logical call.
    await Promise.resolve(
      plain.run(undefined, { worker: durableWorker, id: 'durable-1-replay', isReplay: true })
    )
    expect(executions).toEqual(['durable-1', 'durable-1-replay'])
    expect(defaulted).toEqual(['start', 'finally'])
    expect(optedIn).toEqual(['start', 'finally', 'start', 'finally'])
  })
})
