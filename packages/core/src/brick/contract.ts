import { runDirectBrick } from '../worker/execution'
import { markBrickImplementation } from './implementation'
import type { BrickHandler, BrickImplementation, ValidBrick } from './types'

export interface Brick {
  params: unknown
  result: unknown
  errors?: unknown
  requires?: object
  depends?: Readonly<Record<string, Brick>>
  signals?: object
}

export function brick<F extends Brick>(
  handler: F extends ValidBrick<F> ? BrickHandler<F> : never
): BrickImplementation<F> {
  const implementation = { handler } as unknown as BrickImplementation<F>
  Object.defineProperty(implementation, 'run', {
    configurable: false,
    enumerable: false,
    value: (
      params: Parameters<BrickImplementation<F>['run']>[0],
      ...options: Parameters<BrickImplementation<F>['run']> extends readonly [
        unknown,
        ...infer Rest
      ]
        ? Rest
        : never
    ) => runDirectBrick(implementation, params, options[0] as never),
    writable: false
  })
  markBrickImplementation(implementation)
  return Object.freeze(implementation)
}
