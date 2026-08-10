import { describe, expect, test } from 'bun:test'
import {
  type Engine,
  type EngineExecutionHandle,
  type EngineExecutionRequest,
  ExecutionContext,
  isEngine
} from '../src/index'
import { createSignalFunctions } from '../src/signal/functions'
import { createSignalHandlerChain } from '../src/signal/handler'

class FakeEngine implements Engine {
  start<Result, Error>(
    request: EngineExecutionRequest<Result, Error>
  ): EngineExecutionHandle<Result, Error> {
    return {
      id: request.id,
      result: request.execute(),
      status: async () => 'running',
      cancel: async () => {},
      signal: async (signal) => request.signal(signal)
    }
  }
}

describe('Engine contracts', () => {
  test('recognizes structural engines and delegates neutral requests', async () => {
    const engine = new FakeEngine()
    const request: EngineExecutionRequest<string, never> = {
      id: 'run-1',
      flowId: 'files.editFile',
      params: 'value',
      context: new ExecutionContext({ callId: 'call-1' }),
      execute: async () => ({ ok: true, value: 'value' }),
      signal: async (call) => call.request
    }
    const handle = engine.start(request)

    expect(isEngine(engine)).toBe(true)
    await expect(handle.result).resolves.toEqual({ ok: true, value: 'value' })
    await expect(handle.status()).resolves.toBe('running')
    await expect(handle.signal({ name: 'approve', request: true })).resolves.toBe(true)
  })

  test('dispatches local signals with the current durable namespace and child namespaces', async () => {
    const names: string[] = []
    const context = new ExecutionContext({
      layerPath: ['files'],
      flowPath: ['editFile'],
      callId: 'call-1'
    })
    const signals = createSignalFunctions<{
      approve: { request: { id: string }; response: string }
    }>(context, async ({ name, request }) => {
      names.push(name)
      return (request as { id: string }).id
    })
    const childSignals = createSignalFunctions<{
      approve: { request: { id: string }; response: string }
    }>(context.childFlow('validate', 'call-2'), async ({ name, request }) => {
      names.push(name)
      return (request as { id: string }).id
    })

    await expect(signals.approve({ id: 'root' })).resolves.toBe('root')
    await expect(childSignals.approve({ id: 'child' })).resolves.toBe('child')
    expect(names).toEqual(['files.editFile.approve', 'files.editFile.validate.approve'])
  })

  test('creates immutable child contexts with namespaced paths and inherited state', async () => {
    const handlers = createSignalHandlerChain({ approve: () => 'ok' }, undefined, true)
    const root = new ExecutionContext({
      layerPath: ['files'],
      flowPath: ['editFile'],
      callId: 'call-1',
      providers: { logger: 'logger' },
      signalHandlers: handlers
    })
    const child = root.childFlow('validate', 'call-2').childLayer('rules')

    expect(child.layerPath).toEqual(['files', 'rules'])
    expect(child.flowPath).toEqual(['editFile', 'validate'])
    expect(child.callId).toBe('call-2')
    expect(child.providers).toBe(root.providers)
    expect(child.signalHandlers).toBe(root.signalHandlers)
    expect(child.nextSignalMetadata('approve')).toMatchObject({
      durableName: 'files.rules.editFile.validate.approve',
      occurrence: 1
    })
    expect(child.nextSignalMetadata('approve').occurrence).toBe(2)
  })
})
