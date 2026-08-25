import { assertValidPathSegment } from '../path-segment'
import { signalCallMetadata } from '../signal/namespace'
import type { SignalCallMetadata, SignalHandlerChain } from '../signal/types'

export interface ExecutionContextOptions {
  readonly layerPath?: readonly string[]
  readonly flowPath?: readonly string[]
  readonly callId: string
  readonly providers?: Readonly<Record<string, unknown>>
  readonly signalHandlers?: SignalHandlerChain
}

export class ExecutionContext {
  readonly layerPath: readonly string[]
  readonly flowPath: readonly string[]
  readonly callId: string
  readonly providers: Readonly<Record<string, unknown>>
  readonly signalHandlers: SignalHandlerChain | undefined
  readonly #signalOccurrences = new Map<string, number>()

  constructor(options: ExecutionContextOptions) {
    const layerPath = [...(options.layerPath ?? [])]
    const flowPath = [...(options.flowPath ?? [])]
    for (const segment of layerPath) assertValidPathSegment(segment)
    for (const segment of flowPath) assertValidPathSegment(segment)
    this.layerPath = Object.freeze(layerPath)
    this.flowPath = Object.freeze(flowPath)
    this.callId = options.callId
    this.providers = options.providers ?? Object.freeze({})
    this.signalHandlers = options.signalHandlers
    Object.freeze(this)
  }

  childLayer(segment: string): ExecutionContext {
    assertValidPathSegment(segment)
    return new ExecutionContext({
      layerPath: [...this.layerPath, segment],
      flowPath: this.flowPath,
      callId: this.callId,
      providers: this.providers,
      ...(this.signalHandlers ? { signalHandlers: this.signalHandlers } : {})
    })
  }

  childFlow(segment: string, callId: string): ExecutionContext {
    assertValidPathSegment(segment)
    return new ExecutionContext({
      layerPath: this.layerPath,
      flowPath: [...this.flowPath, segment],
      callId,
      providers: this.providers,
      ...(this.signalHandlers ? { signalHandlers: this.signalHandlers } : {})
    })
  }

  withSignalHandlers(signalHandlers: SignalHandlerChain): ExecutionContext {
    return new ExecutionContext({
      layerPath: this.layerPath,
      flowPath: this.flowPath,
      callId: this.callId,
      providers: this.providers,
      signalHandlers
    })
  }

  nextSignalMetadata(signalName: string): SignalCallMetadata {
    const occurrence = (this.#signalOccurrences.get(signalName) ?? 0) + 1
    this.#signalOccurrences.set(signalName, occurrence)
    return signalCallMetadata(this.layerPath, this.flowPath, signalName, this.callId, occurrence)
  }
}
