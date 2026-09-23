import { describe, expect, test } from 'bun:test'
import {
  type Brick,
  type BrickPlugin,
  brick,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  type EngineStepRunner,
  Layer,
  LocalWorker,
  toDurableStepName,
  UnhandledBrickFailureError,
  type Worker
} from '../src/index'

type GrandchildBrick = Brick<{ params: { id: string }; result: string }>
type ChildBrick = Brick<{
  params: { id: string }
  result: string
  depends: { grandchild: GrandchildBrick }
}>
type ParentBrick = Brick<{
  params: { id: string }
  result: string
  depends: { child: ChildBrick }
}>

function chain() {
  const calls: { parent?: number; child?: number; grandchild?: number } = {}
  const grandchild = brick<GrandchildBrick>(async ({ id }) => {
    calls.grandchild = (calls.grandchild ?? 0) + 1
    return `grandchild:${id}`
  })
  const child = brick<ChildBrick>(async ({ id }, _requirements, { grandchild: runGrandchild }) => {
    calls.child = (calls.child ?? 0) + 1
    return `child(${await runGrandchild({ id })})`
  })
  const parent = brick<ParentBrick>(async ({ id }, _requirements, { child: runChild }) => {
    calls.parent = (calls.parent ?? 0) + 1
    return `parent(${await runChild({ id })})`
  })
  return { calls, grandchild, child, parent }
}

/** Worker that binds an observing step runner, then delegates to a LocalWorker. */
class StepProbeWorker implements Worker {
  readonly stepCalls: string[] = []
  private readonly inner = new LocalWorker()

  start<Result, Failure>(
    request: EngineExecutionRequest<Result, Failure>
  ): EngineExecutionHandle<Result, Failure> {
    const runner: EngineStepRunner = async (name, run) => {
      this.stepCalls.push(name)
      return run()
    }
    request.step = runner
    return this.inner.start(request)
  }
}

describe('toDurableStepName', () => {
  test('derives a deterministic step name from the durable node id', () => {
    expect(toDurableStepName('app.users.getUser', 'run-1')).toBe('brickflow/app.users.getUser')
  })

  test('falls back to the call id for direct-run roots without a node id', () => {
    expect(toDurableStepName(undefined, 'run-1')).toBe('brickflow/run-1')
  })

  test('sanitizes segments that are invalid in step names', () => {
    expect(toDurableStepName('weird id/with spaces', 'run-1')).toBe(
      'brickflow/weird_id/with_spaces'
    )
  })
})

describe('per-brick step runner', () => {
  test('invokes one step per brick with deterministic names', async () => {
    const { calls, grandchild, child, parent } = chain()
    const worker = new StepProbeWorker()

    const result = await parent.run(
      { id: 'ada' },
      {
        dependencies: {
          child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
        },
        worker,
        id: 'call-1'
      }
    )

    expect(result).toBe('parent(child(grandchild:ada))')
    expect(calls).toEqual({ parent: 1, child: 1, grandchild: 1 })
    expect(worker.stepCalls).toEqual([
      'brickflow/call-1',
      'brickflow/child',
      'brickflow/child.grandchild'
    ])
  })

  test('preserves typed failures as data across steps', async () => {
    type Fallible = Brick<{ params: { id: string }; result: string; errors: 'missing' }>
    const fallible = brick<Fallible>(async ({ id }, _req, _deps, { fail }) => {
      if (id === 'missing') return fail('missing')
      return `found:${id}`
    })
    type ParentOfFallible = Brick<{
      params: { id: string }
      result: string
      depends: { child: Fallible }
    }>
    const parentOfFallible = brick<ParentOfFallible>(
      async ({ id }, _req, { child: runChild }) => `parent(${await runChild({ id })})`
    )
    const worker = new StepProbeWorker()

    const error = await Promise.resolve(
      parentOfFallible.run(
        { id: 'missing' },
        { dependencies: { child: { brick: fallible } }, worker, id: 'call-fail' }
      )
    ).then(
      () => 'resolved-unexpectedly',
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(UnhandledBrickFailureError)
    expect((error as UnhandledBrickFailureError).failure).toBe('missing')
    expect(worker.stepCalls).toEqual(['brickflow/call-fail', 'brickflow/child'])
  })

  test('propagates defects through steps without collapsing them', async () => {
    const { child, parent, grandchild } = chain()
    const throwing = brick<GrandchildBrick>(async () => {
      throw new Error('defect-boom')
    })
    const worker = new StepProbeWorker()

    const error = await Promise.resolve(
      parent.run(
        { id: 'ada' },
        {
          dependencies: {
            child: { brick: child, dependencies: { grandchild: { brick: throwing } } }
          },
          worker,
          id: 'call-defect'
        }
      )
    ).then(
      () => 'resolved-unexpectedly',
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('defect-boom')
    expect(worker.stepCalls).toEqual([
      'brickflow/call-defect',
      'brickflow/child',
      'brickflow/child.grandchild'
    ])
    expect(grandchild).toBeDefined()
  })

  test('applies the replay skip|emit gate per brick inside steps', async () => {
    const { calls, grandchild, child, parent } = chain()
    const seen: string[] = []
    const skipPlugin: BrickPlugin = {
      name: 'skip-plugin',
      onStart: () => {
        seen.push('skip:start')
      },
      onSuccess: () => {
        seen.push('skip:success')
      }
    }
    const emitPlugin: BrickPlugin = {
      name: 'emit-plugin',
      replay: 'emit',
      onStart: () => {
        seen.push('emit:start')
      },
      onSuccess: () => {
        seen.push('emit:success')
      }
    }
    const worker = new StepProbeWorker()

    const result = await parent.run(
      { id: 'ada' },
      {
        dependencies: {
          child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
        },
        worker,
        id: 'call-replay',
        plugins: [skipPlugin, emitPlugin],
        isReplay: true
      }
    )

    expect(result).toBe('parent(child(grandchild:ada))')
    expect(calls).toEqual({ parent: 1, child: 1, grandchild: 1 })
    expect(worker.stepCalls).toHaveLength(3)
    expect(seen).toEqual([
      'emit:start',
      'emit:start',
      'emit:start',
      'emit:success',
      'emit:success',
      'emit:success'
    ])
  })

  test('supports signals inside stepped bricks', async () => {
    type Signalled = Brick<{
      params: { id: string }
      result: string
      signals: { approve: { request: { id: string }; response: boolean } }
    }>
    const signalled = brick<Signalled>(async ({ id }, _req, _deps, { signals }) => {
      const approved = await signals.approve({ id })
      return approved ? `approved:${id}` : `denied:${id}`
    })
    const worker = new StepProbeWorker()

    const result = await signalled.run(
      { id: 'ada' },
      {
        signals: {
          approve: async (request: { id: string }) => {
            expect(request).toEqual({ id: 'ada' })
            return true
          }
        },
        worker,
        id: 'call-signal'
      }
    )

    expect(result).toBe('approved:ada')
    expect(worker.stepCalls).toEqual(['brickflow/call-signal'])
  })

  test('uses the durable Layer path as the step name for Layer-bound runs', async () => {
    type GetUser = Brick<{ params: { id: string }; result: string }>
    const getUser = brick<GetUser>(async ({ id }) => `user:${id}`)
    const users = new Layer('users', { getUser }).provide({})
    const worker = new StepProbeWorker()

    const result = await users.getUser.run({ id: 'ada' }, { worker, id: 'call-layer' })

    expect(result).toBe('user:ada')
    expect(worker.stepCalls).toEqual(['brickflow/users.getUser'])
  })
})
