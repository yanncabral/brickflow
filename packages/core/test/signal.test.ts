import { describe, expect, test } from 'bun:test'
import {
  createSignalHandlerChain,
  MissingSignalHandlerError,
  NonBoundarySignalHandlerChainError,
  resolveSignal
} from '../src/signal/handler'
import {
  durableSignalName,
  flattenNamespacedSignalHandlers,
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

  test('rejects empty signal names and namespace segments', () => {
    expect(() => namespaceSignalHandlers([''], { approve: () => 'invalid' })).toThrow(
      /invalid path segment.*must not be empty/i
    )
    expect(() => durableSignalName(['files'], '')).toThrow(
      /invalid path segment.*must not be empty/i
    )
  })

  test('preserves own prototype-named handlers while flattening namespaces', async () => {
    const protoHandler = () => '__proto__'
    const constructorHandler = () => 'constructor'
    const prototypeHandler = () => 'prototype'
    const handlers = Object.create(null) as Record<string, unknown>
    Object.defineProperties(handlers, {
      ['__proto__']: { enumerable: true, value: protoHandler },
      constructor: { enumerable: true, value: constructorHandler },
      prototype: { enumerable: true, value: prototypeHandler }
    })

    const flattened = flattenNamespacedSignalHandlers(handlers)

    expect(Object.isFrozen(flattened)).toBe(true)
    expect(Object.hasOwn(flattened, '__proto__')).toBe(true)
    expect(Object.hasOwn(flattened, 'constructor')).toBe(true)
    expect(Object.hasOwn(flattened, 'prototype')).toBe(true)
    expect(Reflect.get(flattened, '__proto__')?.(undefined)).toBe('__proto__')
    expect(flattened.constructor?.(undefined)).toBe('constructor')
    expect(Reflect.get(flattened, 'prototype')?.(undefined)).toBe('prototype')
  })

  test('ignores inherited signal handlers during resolution', async () => {
    const inherited = () => 'inherited'
    const handlers = Object.create({ approve: inherited }) as Record<string, typeof inherited>
    const boundary = Object.freeze({ handlers, boundary: true })

    await expect(resolveSignal(boundary, 'approve', undefined)).rejects.toEqual(
      new MissingSignalHandlerError('approve')
    )
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
      brickPath: ['editFile'],
      callId: 'call-3',
      occurrence: 2
    })
  })
})
