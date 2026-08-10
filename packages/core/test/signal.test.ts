import { describe, expect, test } from 'bun:test'
import {
  createSignalHandlerChain,
  MissingSignalHandlerError,
  NonBoundarySignalHandlerChainError,
  resolveSignal
} from '../src/signal/handler'
import {
  durableSignalName,
  namespaceSignalHandlers,
  signalCallMetadata
} from '../src/signal/namespace'

describe('signals', () => {
  test('builds nested namespaces and durable names', () => {
    const handler = () => 'approved'

    expect(namespaceSignalHandlers(['files', 'editFile'], { approve: handler })).toEqual({
      files: { editFile: { approve: handler } }
    })
    expect(durableSignalName(['files', 'editFile'], 'approve')).toBe('files.editFile.approve')
  })

  test('resolves locally before consulting the parent', async () => {
    const calls: string[] = []
    const parent = createSignalHandlerChain(
      {
        approve: () => {
          calls.push('parent')
          return 'parent'
        }
      },
      undefined,
      true
    )
    const local = createSignalHandlerChain(
      {
        approve: () => {
          calls.push('local')
          return 'local'
        }
      },
      parent
    )

    await expect(resolveSignal(local, 'approve', { id: '1' })).resolves.toBe('local')
    expect(calls).toEqual(['local'])
  })

  test('propagates undefined responses to a parent handler', async () => {
    const parent = createSignalHandlerChain({ approve: async () => 'parent' }, undefined, true)
    const local = createSignalHandlerChain({ approve: () => undefined }, parent)

    await expect(resolveSignal(local, 'approve', { id: '1' })).resolves.toBe('parent')
  })

  test('reports an unhandled signal only after reaching the boundary', async () => {
    const boundary = createSignalHandlerChain({}, undefined, true)
    const local = createSignalHandlerChain({}, boundary)

    await expect(resolveSignal(local, 'files.editFile.approve', { id: '1' })).rejects.toEqual(
      new MissingSignalHandlerError('files.editFile.approve')
    )
  })

  test('rejects an exhausted non-boundary chain as an invariant violation', async () => {
    const local = createSignalHandlerChain({ approve: () => undefined })

    await expect(resolveSignal(local, 'approve', { id: '1' })).rejects.toEqual(
      new NonBoundarySignalHandlerChainError('approve')
    )
  })

  test('creates deterministic call metadata', () => {
    expect(signalCallMetadata(['files'], ['editFile'], 'approve', 'call-3', 2)).toEqual({
      durableName: 'files.editFile.approve',
      signalName: 'approve',
      layerPath: ['files'],
      flowPath: ['editFile'],
      callId: 'call-3',
      occurrence: 2
    })
  })
})
