import type { SignalHandlerChain, UnknownSignalHandlers } from './types'

export class NonBoundarySignalHandlerChainError extends Error {
  readonly signalName: string

  constructor(signalName: string) {
    super(`Signal handler chain exhausted before reaching a boundary for "${signalName}"`)
    this.name = 'NonBoundarySignalHandlerChainError'
    this.signalName = signalName
  }
}

export class MissingSignalHandlerError extends Error {
  readonly signalName: string

  constructor(signalName: string) {
    super(`No boundary handler resolved signal "${signalName}"`)
    this.name = 'MissingSignalHandlerError'
    this.signalName = signalName
  }
}

export function createSignalHandlerChain(
  handlers: UnknownSignalHandlers,
  parent?: SignalHandlerChain,
  boundary = false
): SignalHandlerChain {
  const chain: SignalHandlerChain = parent
    ? { handlers: Object.freeze({ ...handlers }), parent, boundary }
    : { handlers: Object.freeze({ ...handlers }), boundary }
  return Object.freeze(chain)
}

export async function resolveSignal<Response>(
  chain: SignalHandlerChain,
  signalName: string,
  request: unknown
): Promise<Response> {
  const handler = Object.hasOwn(chain.handlers, signalName) ? chain.handlers[signalName] : undefined
  if (handler) {
    const response = await handler(request)
    if (response !== undefined) {
      return response as Response
    }
  }

  if (chain.parent) {
    return resolveSignal<Response>(chain.parent, signalName, request)
  }

  if (chain.boundary) {
    throw new MissingSignalHandlerError(signalName)
  }

  throw new NonBoundarySignalHandlerChainError(signalName)
}
