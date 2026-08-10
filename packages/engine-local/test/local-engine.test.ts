import { describe, expect, test } from 'bun:test'
import { type EngineExecutionRequest, ExecutionContext } from '@flow/core'
import { DuplicateLocalRunIdError, LocalEngine, LocalRunCancelledError } from '../src/index'

function request<Result, Failure>(
  overrides: Partial<EngineExecutionRequest<Result, Failure>> &
    Pick<EngineExecutionRequest<Result, Failure>, 'id' | 'execute'>
): EngineExecutionRequest<Result, Failure> {
  return {
    flowId: 'test.flow',
    params: undefined,
    context: new ExecutionContext({ callId: `call-${overrides.id}` }),
    signal: async ({ request }) => request,
    ...overrides
  }
}

describe('LocalEngine', () => {
  test('starts queued, executes in a microtask, and completes a successful run', async () => {
    let executions = 0
    const engine = new LocalEngine()
    const handle = engine.start(
      request({
        id: 'success',
        execute: async () => {
          executions += 1
          return { ok: true, value: 'done' }
        }
      })
    )

    expect(executions).toBe(0)
    await expect(handle.status()).resolves.toBe('queued')
    await expect(handle.result).resolves.toEqual({ ok: true, value: 'done' })
    await expect(handle.status()).resolves.toBe('completed')
    expect(executions).toBe(1)
  })

  test('is running while execution is pending', async () => {
    let resolve!: (value: { ok: true; value: string }) => void
    const pending = new Promise<{ ok: true; value: string }>((done) => {
      resolve = done
    })
    const handle = new LocalEngine().start(request({ id: 'pending', execute: () => pending }))

    await Promise.resolve()
    await expect(handle.status()).resolves.toBe('running')
    resolve({ ok: true, value: 'done' })
    await expect(handle.result).resolves.toEqual({ ok: true, value: 'done' })
    await expect(handle.status()).resolves.toBe('completed')
  })

  test('preserves a typed failure and marks the run failed', async () => {
    const failure = { code: 'denied' as const }
    const handle = new LocalEngine().start(
      request({ id: 'failure', execute: async () => ({ ok: false, error: failure }) })
    )

    await expect(handle.result).resolves.toEqual({ ok: false, error: failure })
    await expect(handle.status()).resolves.toBe('failed')
  })

  test('rejects an execution defect and marks the run failed', async () => {
    const defect = new Error('boom')
    const handle = new LocalEngine().start(
      request({
        id: 'defect',
        execute: async () => {
          throw defect
        }
      })
    )

    await expect(handle.result).rejects.toBe(defect)
    await expect(handle.status()).resolves.toBe('failed')
  })

  test('cancels idempotently and prevents a running operation from overwriting cancellation', async () => {
    let resolve!: (value: { ok: true; value: string }) => void
    const pending = new Promise<{ ok: true; value: string }>((done) => {
      resolve = done
    })
    const handle = new LocalEngine().start(request({ id: 'cancel', execute: () => pending }))

    await Promise.resolve()
    await handle.cancel('no longer needed')
    await handle.cancel('ignored')
    await expect(handle.status()).resolves.toBe('cancelled')
    await expect(handle.result).rejects.toEqual(
      expect.objectContaining({
        name: 'LocalRunCancelledError',
        runId: 'cancel',
        reason: 'no longer needed'
      })
    )

    resolve({ ok: true, value: 'late' })
    await Promise.resolve()
    await expect(handle.status()).resolves.toBe('cancelled')
  })

  test('rejects signals with the cancellation error after cancellation', async () => {
    const handle = new LocalEngine().start(
      request({ id: 'cancel-signal', execute: async () => ({ ok: true, value: undefined }) })
    )
    const result = handle.result.catch((error: unknown) => error)
    await handle.cancel('stop')

    await expect(handle.signal({ name: 'approve', request: true })).rejects.toBeInstanceOf(
      LocalRunCancelledError
    )
    expect(await result).toBeInstanceOf(LocalRunCancelledError)
  })

  test('delegates signals while active', async () => {
    const calls: unknown[] = []
    const handle = new LocalEngine().start(
      request({
        id: 'signal',
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
  })

  test('runs multiple IDs independently', async () => {
    const engine = new LocalEngine()
    const first = engine.start(
      request({ id: 'independent-1', execute: async () => ({ ok: true, value: 1 }) })
    )
    const second = engine.start(
      request({ id: 'independent-2', execute: async () => ({ ok: false, error: 'nope' }) })
    )

    await expect(first.result).resolves.toEqual({ ok: true, value: 1 })
    await expect(second.result).resolves.toEqual({ ok: false, error: 'nope' })
    await expect(first.status()).resolves.toBe('completed')
    await expect(second.status()).resolves.toBe('failed')
  })

  test('rejects duplicate run IDs synchronously, including completed IDs', async () => {
    const engine = new LocalEngine()
    const first = engine.start(
      request({ id: 'duplicate', execute: async () => ({ ok: true, value: undefined }) })
    )
    await first.result

    expect(() =>
      engine.start(
        request({ id: 'duplicate', execute: async () => ({ ok: true, value: undefined }) })
      )
    ).toThrow(DuplicateLocalRunIdError)
  })
})
