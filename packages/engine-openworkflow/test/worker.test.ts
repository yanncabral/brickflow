import { afterEach, describe, expect, test } from 'bun:test'
import {
  type Brick,
  type BrickPlugin,
  brick,
  type EngineExecutionRequest,
  ExecutionContext,
  Layer,
  toDurableStepName
} from 'brickflow'
import { BackendSqlite } from 'openworkflow/sqlite'
import {
  DuplicateOpenWorkflowRunIdError,
  OpenWorkflowRunCancelledError,
  OpenWorkflowWorker
} from '../src/index'

function testContext(callId: string): ExecutionContext {
  return new ExecutionContext({ layerPath: [], brickPath: [], callId, providers: {} })
}

interface Probe {
  calls: number
}

function successRequest(
  id: string,
  probe: Probe,
  options?: { brickId?: string; value?: number }
): EngineExecutionRequest<number, 'nope'> {
  return {
    id,
    ...(options?.brickId ? { brickId: options.brickId } : {}),
    params: { value: 1 },
    context: testContext(id),
    execute: async () => {
      probe.calls += 1
      return { ok: true as const, value: options?.value ?? 7 }
    },
    signal: async () => 'pong'
  }
}

const workers: OpenWorkflowWorker[] = []
const backends: BackendSqlite[] = []

function track(worker: OpenWorkflowWorker): OpenWorkflowWorker {
  workers.push(worker)
  return worker
}

function createWorker(): OpenWorkflowWorker {
  return track(new OpenWorkflowWorker())
}

function createSharedBackend(): BackendSqlite {
  const backend = BackendSqlite.connect(':memory:')
  backends.push(backend)
  return backend
}

afterEach(async () => {
  while (workers.length > 0) {
    const worker = workers.pop()
    if (worker) await worker.close()
  }
  while (backends.length > 0) {
    const backend = backends.pop()
    if (backend) await backend.stop()
  }
})

describe('toDurableStepName', () => {
  test('derives a deterministic durable step name from the brickId', () => {
    expect(toDurableStepName('app.users.getUser', 'run-1')).toBe('brickflow/app.users.getUser')
  })

  test('falls back to the run id for direct runs without brickId', () => {
    expect(toDurableStepName(undefined, 'run-1')).toBe('brickflow/run-1')
  })
})

describe('OpenWorkflowWorker', () => {
  test('runs a brick through a durable step and completes', async () => {
    const worker = createWorker()
    const probe: Probe = { calls: 0 }
    const handle = worker.start(successRequest('run-success', probe))

    expect(handle.id).toBe('run-success')
    await expect(handle.result).resolves.toEqual({ ok: true, value: 7 })
    expect(probe.calls).toBe(1)
    await expect(handle.status()).resolves.toBe('completed')
  })

  test('rejects duplicate run ids within one worker instance', async () => {
    const worker = createWorker()
    const probe: Probe = { calls: 0 }
    const handle = worker.start(successRequest('run-dupe', probe))

    expect(() => worker.start(successRequest('run-dupe', probe))).toThrow(
      DuplicateOpenWorkflowRunIdError
    )
    await expect(handle.result).resolves.toEqual({ ok: true, value: 7 })
  })

  test('preserves typed failures as data across the durable boundary', async () => {
    const worker = createWorker()
    const request: EngineExecutionRequest<string, { code: string }> = {
      id: 'run-failure',
      brickId: 'app.getUser',
      params: { id: 'missing' },
      context: testContext('run-failure'),
      execute: async () => ({ ok: false as const, error: { code: 'NOT_FOUND' } }),
      signal: async () => {
        throw new Error('no signals expected')
      }
    }
    const handle = worker.start(request)

    const result = await handle.result
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(result.ok ? null : result.error instanceof Error).toBe(false)
    await expect(handle.status()).resolves.toBe('failed')
  })

  test('rejects defects as unexpected errors without collapsing them into data', async () => {
    const worker = createWorker()
    const request: EngineExecutionRequest<string, 'nope'> = {
      id: 'run-defect',
      params: {},
      context: testContext('run-defect'),
      execute: async () => {
        throw new Error('boom')
      },
      signal: async () => {
        throw new Error('no signals expected')
      }
    }
    const handle = worker.start(request)

    const error = await handle.result.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('boom')
    await expect(handle.status()).resolves.toBe('failed')
  })

  test('executes a real brick graph with dependencies through runDirectBrick', async () => {
    type Child = Brick<{ params: { id: string }; result: string }>
    type Parent = Brick<{
      params: { id: string }
      result: string
      depends: { child: Child }
    }>
    const child = brick<Child>(async ({ id }) => `user:${id}`)
    const parent = brick<Parent>(async ({ id }, _requirements, { child: runChild }) => {
      const name = await runChild({ id })
      return `hello ${name}`
    })

    const worker = createWorker()
    const run = parent.run(
      { id: 'ada' },
      {
        dependencies: { child: { brick: child } },
        worker,
        id: 'run-graph'
      }
    )
    await expect(Promise.resolve(run)).resolves.toBe('hello user:ada')
  })

  test('propagates typed brick failures and defects through runDirectBrick', async () => {
    type Fallible = Brick<{ params: { id: string }; result: string; errors: 'missing' }>
    const fallible = brick<Fallible>(async ({ id }, _req, _deps, { fail }) => {
      if (id === 'missing') return fail('missing')
      return `found:${id}`
    })
    type Throwing = Brick<{ params: { id: string }; result: string }>
    const throwing = brick<Throwing>(async () => {
      throw new Error('defect-boom')
    })

    const worker = createWorker()
    const recovered = await Promise.resolve(
      fallible
        .run({ id: 'missing' }, { worker, id: 'run-fail-graph' })
        .with('missing', () => 'recovered')
    )
    expect(recovered).toBe('recovered')

    const defect = await Promise.resolve(
      throwing.run({ id: 'x' }, { worker, id: 'run-defect-graph' })
    ).then(
      () => 'resolved-unexpectedly',
      (cause: unknown) => (cause as Error).message
    )
    expect(defect).toBe('defect-boom')
  })

  test('supports signals across the worker boundary', async () => {
    type Signalled = Brick<{
      params: { id: string }
      result: string
      signals: { approve: { request: { message: string }; response: { approved: boolean } } }
    }>
    const signalled = brick<Signalled>(
      async ({ id }, _requirements, _dependencies, { signals }) => {
        const decision = await signals.approve({ message: `hello ${id}` })
        return decision.approved ? `approved:${id}` : `denied:${id}`
      }
    )

    const worker = createWorker()
    const run = signalled.run(
      { id: 'ada' },
      {
        signals: {
          approve: async (request: { message: string }) => {
            expect(request).toEqual({ message: 'hello ada' })
            return { approved: true }
          }
        },
        worker,
        id: 'run-signal'
      }
    )
    await expect(Promise.resolve(run)).resolves.toBe('approved:ada')
  })

  test('resumes from the checkpoint without re-executing after a worker restart', async () => {
    const backend = createSharedBackend()
    const shared = track(new OpenWorkflowWorker({ backend }))
    const probe: Probe = { calls: 0 }
    const request = successRequest('run-resume', probe, { brickId: 'app.getUser' })
    const first = shared.start(request)
    await expect(first.result).resolves.toEqual({ ok: true, value: 7 })
    expect(probe.calls).toBe(1)
    // Simulate a crash: stop the worker loop, keep the backend alive.
    await shared.close()
    workers.splice(workers.indexOf(shared), 1)

    const restarted = track(new OpenWorkflowWorker({ backend }))
    const second = restarted.start(successRequest('run-resume', probe, { brickId: 'app.getUser' }))
    await expect(second.result).resolves.toEqual({ ok: true, value: 7 })
    expect(probe.calls).toBe(1)
    await expect(second.status()).resolves.toBe('completed')
  })

  test('does not re-emit skip plugins on replay', async () => {
    const seen: string[] = []
    const skipPlugin: BrickPlugin = {
      name: 'skip-plugin',
      onStart: async () => {
        seen.push('skip:start')
      },
      onSuccess: async () => {
        seen.push('skip:success')
      }
    }
    const emitPlugin: BrickPlugin = {
      name: 'emit-plugin',
      replay: 'emit',
      onStart: async () => {
        seen.push('emit:start')
      },
      onSuccess: async () => {
        seen.push('emit:success')
      }
    }
    type Simple = Brick<{ params: { id: string }; result: string }>
    const simple = brick<Simple>(async ({ id }) => `ok:${id}`)

    const shared = track(new OpenWorkflowWorker({ backend: createSharedBackend() }))
    await simple.run(
      { id: 'ada' },
      { worker: shared, id: 'run-plugins', plugins: [skipPlugin, emitPlugin] }
    )
    expect(seen).toEqual(['skip:start', 'emit:start', 'skip:success', 'emit:success'])
    const backend = shared.backend
    await shared.close()
    workers.splice(workers.indexOf(shared), 1)

    const restarted = track(new OpenWorkflowWorker({ backend }))
    const replayed = await Promise.resolve(
      simple.run(
        { id: 'ada' },
        { worker: restarted, id: 'run-plugins', plugins: [skipPlugin, emitPlugin] }
      )
    )
    expect(replayed).toBe('ok:ada')
    expect(seen).toEqual(['skip:start', 'emit:start', 'skip:success', 'emit:success'])
  })

  test('supports cooperative cancellation', async () => {
    const worker = createWorker()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const request: EngineExecutionRequest<string, 'nope'> = {
      id: 'run-cancel',
      params: {},
      context: testContext('run-cancel'),
      execute: async () => {
        await gate
        return { ok: true as const, value: 'late' }
      },
      signal: async () => 'pong'
    }
    const handle = worker.start(request)

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await handle.status()
      if (status === 'running' || status === 'queued') break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    await handle.cancel('no longer needed')
    const error = await handle.result.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(OpenWorkflowRunCancelledError)
    await expect(handle.status()).resolves.toBe('cancelled')

    release()
    const late = await handle.result.catch((cause: unknown) => cause)
    expect(late).toBeInstanceOf(OpenWorkflowRunCancelledError)
    await expect(handle.signal({ name: 'approve', request: {} })).rejects.toBeInstanceOf(
      OpenWorkflowRunCancelledError
    )
  })

  test('delegates signals to the engine request', async () => {
    const worker = createWorker()
    const seen: unknown[] = []
    const request: EngineExecutionRequest<string, 'nope'> = {
      id: 'run-signal-delegate',
      params: {},
      context: testContext('run-signal-delegate'),
      execute: async () => ({ ok: true as const, value: 'done' }),
      signal: async ({ name, request: payload }) => {
        seen.push({ name, payload })
        return { approved: true }
      }
    }
    const handle = worker.start(request)
    await expect(handle.signal({ name: 'approve', request: { message: 'hi' } })).resolves.toEqual({
      approved: true
    })
    expect(seen).toEqual([{ name: 'approve', payload: { message: 'hi' } }])
    await handle.result
  })

  test('runs a Layer-bound brick and records the durable step name', async () => {
    type GetUser = Brick<{ params: { id: string }; result: string }>
    const getUser = brick<GetUser>(async ({ id }) => `user:${id}`)
    const users = new Layer('users', { getUser }).provide({})

    const worker = createWorker()
    const run = users.getUser.run({ id: 'ada' }, { worker, id: 'run-layer' })
    await expect(Promise.resolve(run)).resolves.toBe('user:ada')
  })
})
