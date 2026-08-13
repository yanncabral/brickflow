import { markFlowImplementation } from './implementation'
import type { FlowHandler, FlowImplementation } from './types'

export interface Flow {
  params: unknown
  result: unknown
  errors?: unknown
  requires?: object
  depends?: Readonly<Record<string, Flow>>
  signals?: object
}

export function flow<F extends Flow>(handler: FlowHandler<F>): FlowImplementation<F> {
  const implementation = { handler } as FlowImplementation<F>
  markFlowImplementation(implementation)
  return Object.freeze(implementation)
}
