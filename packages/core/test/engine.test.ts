import { describe, expect, test } from 'bun:test'
import { ExecutionContext } from '../src/index'
import { createSignalFunctions } from '../src/signal/functions'
import { createSignalHandlerChain } from '../src/signal/handler'

describe('ExecutionContext', () => {
  test('dispatches local signals with the current durable namespace and child namespaces', async () => {
    const names: string[] = []
    const context = new ExecutionContext({
      layerPath: ['files'],
      brickPath: ['editFile'],
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
    }>(context.childBrick('validate', 'call-2'), async ({ name, request }) => {
      names.push(name)
      return (request as { id: string }).id
    })

    await expect(signals.approve({ id: 'root' })).resolves.toBe('root')
    await expect(childSignals.approve({ id: 'child' })).resolves.toBe('child')
    expect(names).toEqual(['files.editFile.approve', 'files.editFile.validate.approve'])
  })

  test('rejects invalid constructor path segments', () => {
    for (const invalid of ['', 'nested.path']) {
      expect(
        () => new ExecutionContext({ layerPath: ['files', invalid], callId: 'call-layer' })
      ).toThrow(/invalid path segment/i)
      expect(
        () => new ExecutionContext({ brickPath: ['editFile', invalid], callId: 'call-brick' })
      ).toThrow(/invalid path segment/i)
    }
  })

  test('rejects invalid child path segments', () => {
    const context = new ExecutionContext({
      layerPath: ['files'],
      brickPath: ['editFile'],
      callId: 'call-1'
    })

    for (const invalid of ['', 'nested.path']) {
      expect(() => context.childLayer(invalid)).toThrow(/invalid path segment/i)
      expect(() => context.childBrick(invalid, 'call-2')).toThrow(/invalid path segment/i)
    }
  })

  test('creates immutable child contexts with namespaced paths and inherited state', async () => {
    const handlers = createSignalHandlerChain({ approve: () => 'ok' }, undefined, true)
    const root = new ExecutionContext({
      layerPath: ['files'],
      brickPath: ['editFile'],
      callId: 'call-1',
      providers: { logger: 'logger' },
      signalHandlers: handlers
    })
    const child = root.childBrick('validate', 'call-2').childLayer('rules')

    expect(child.layerPath).toEqual(['files', 'rules'])
    expect(child.brickPath).toEqual(['editFile', 'validate'])
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
