import { runDirectFlow } from '../worker/execution'
import { markFlowImplementation } from './implementation'
import type { FlowHandler, FlowImplementation, ValidFlow } from './types'

export interface Flow {
  params: unknown
  result: unknown
  errors?: unknown
  requires?: object
  depends?: Readonly<Record<string, Flow>>
  signals?: object
}

export function flow<F extends Flow>(
  handler: F extends ValidFlow<F> ? FlowHandler<F> : never
): FlowImplementation<F> {
  const implementation = { handler } as unknown as FlowImplementation<F>
  Object.defineProperty(implementation, 'run', {
    configurable: false,
    enumerable: false,
    value: (
      params: Parameters<FlowImplementation<F>['run']>[0],
      ...options: Parameters<FlowImplementation<F>['run']> extends readonly [unknown, ...infer Rest]
        ? Rest
        : never
    ) => runDirectFlow(implementation, params, options[0] as never),
    writable: false
  })
  markFlowImplementation(implementation)
  return Object.freeze(implementation)
}
