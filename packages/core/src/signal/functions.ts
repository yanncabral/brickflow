import type { ExecutionContext } from '../engine/execution-context'
import type { EngineSignalRequest } from '../engine/types'
import { resolveSignal } from './handler'
import type { SignalDefinitions, SignalFunctions } from './types'

export type SignalDispatch = (signal: EngineSignalRequest) => Promise<unknown>

export function createSignalFunctions<Definitions extends SignalDefinitions>(
  context: ExecutionContext,
  dispatch?: SignalDispatch
): SignalFunctions<Definitions> {
  const functions = new Map<string, (request: unknown) => Promise<unknown>>()
  const target = Object.freeze({})

  return new Proxy(target, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      let signal = functions.get(property)
      if (!signal) {
        signal = async (request: unknown) => {
          const metadata = context.nextSignalMetadata(property)
          if (context.signalHandlers) {
            return resolveSignal(context.signalHandlers, metadata.durableName, request)
          }
          if (dispatch) {
            return dispatch({ name: metadata.durableName, request })
          }
          throw new Error(`No signal dispatch configured for "${metadata.durableName}"`)
        }
        functions.set(property, signal)
      }
      return signal
    }
  }) as SignalFunctions<Definitions>
}
