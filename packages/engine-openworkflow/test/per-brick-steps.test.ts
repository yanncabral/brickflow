import { afterEach, describe, expect, test } from 'bun:test'
import { type Brick, brick } from 'brickflow'
import { BackendSqlite } from 'openworkflow/sqlite'
import { OpenWorkflowWorker } from '../src/index'

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

/** Marks the simulated mid-graph crash. Never escapes the run: resume heals it. */
class SimulatedCrashError extends Error {
  constructor() {
    super('simulated crash')
    this.name = 'SimulatedCrashError'
  }
}

const workers: OpenWorkflowWorker[] = []
const backends: BackendSqlite[] = []

function track(worker: OpenWorkflowWorker): OpenWorkflowWorker {
  workers.push(worker)
  return worker
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

describe('OpenWorkflowWorker per-brick steps', () => {
  test('creates one step per brick and resumes without re-executing completed bricks', async () => {
    const calls: { parent?: number; child?: number; grandchild?: number } = {}
    const grandchild = brick<GrandchildBrick>(async ({ id }) => {
      calls.grandchild = (calls.grandchild ?? 0) + 1
      return `grandchild:${id}`
    })
    const child = brick<ChildBrick>(
      async ({ id }, _requirements, { grandchild: runGrandchild }) => {
        calls.child = (calls.child ?? 0) + 1
        return `child(${await runGrandchild({ id })})`
      }
    )
    const parent = brick<ParentBrick>(async ({ id }, _requirements, { child: runChild }) => {
      calls.parent = (calls.parent ?? 0) + 1
      const nested = await runChild({ id })
      // Simulate a crash after the whole child subtree completed and
      // checkpointed: the first parent attempt dies here, resume re-drives it.
      if (calls.parent === 1) throw new SimulatedCrashError()
      return `parent(${nested})`
    })
    const dependencies = {
      child: { brick: child, dependencies: { grandchild: { brick: grandchild } } }
    }

    const worker = track(
      new OpenWorkflowWorker({
        backend: createSharedBackend(),
        stepRetryPolicy: { maximumAttempts: 3, initialInterval: '50ms' }
      })
    )
    const run = parent.run(
      { id: 'ada' },
      { dependencies, worker, id: 'run-per-brick', isReplay: false }
    )

    await expect(Promise.resolve(run)).resolves.toBe('parent(child(grandchild:ada))')
    // Only the pending (never-checkpointed) parent re-executes; completed
    // child bricks are served from their step checkpoints.
    expect(calls).toEqual({ parent: 2, child: 1, grandchild: 1 })
    await expect(run.status()).resolves.toBe('completed')

    const runs = await worker.backend.listWorkflowRuns({ workflowName: 'brickflow/brick-run' })
    expect(runs.data).toHaveLength(1)
    const attempts = await worker.backend.listStepAttempts({
      workflowRunId: runs.data[0]?.id ?? ''
    })
    const completedByName = new Map<string, number>()
    let failedParentAttempts = 0
    for (const attempt of attempts.data) {
      if (attempt.status === 'completed' || attempt.status === 'succeeded') {
        completedByName.set(attempt.stepName, (completedByName.get(attempt.stepName) ?? 0) + 1)
      }
      if (attempt.stepName === 'brickflow/run-per-brick' && attempt.status === 'failed') {
        failedParentAttempts += 1
      }
    }
    expect([...completedByName.entries()].sort()).toEqual([
      ['brickflow/child', 1],
      ['brickflow/child.grandchild', 1],
      ['brickflow/run-per-brick', 1]
    ])
    expect(failedParentAttempts).toBe(1)
  })
})
