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
    this.layerPath = Object.freeze([...(options.layerPath ?? [])])
    this.flowPath = Object.freeze([...(options.flowPath ?? [])])
    this.callId = options.callId
    this.providers = options.providers ?? Object.freeze({})
    this.signalHandlers = options.signalHandlers
    Object.freeze(this)
  }

  childLayer(segment: string): ExecutionContext {
    return new ExecutionContext({
      layerPath: [...this.layerPath, segment],
      flowPath: this.flowPath,
      callId: this.callId,
      providers: this.providers,
      ...(this.signalHandlers ? { signalHandlers: this.signalHandlers } : {})
    })
  }

  childFlow(segment: string, callId: string): ExecutionContext {
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
