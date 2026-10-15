import type { SignalDefinitions } from '../signal/types'
import { runDirectBrick } from '../worker/execution'
import { markBrickImplementation } from './implementation'
import type {
  BrickHandler,
  BrickImplementation,
  BrickRunOptionArgs,
  ParamsOf,
  ValidBrick
} from './types'

interface BrickConfig {
  params: unknown
  result: unknown
  errors?: unknown
  requires?: object
  depends?: Readonly<Record<string, Brick>>
  signals?: SignalDefinitions
}

export type Brick<Config extends BrickConfig = BrickConfig> = Config

export function brick<F extends Brick>(
  handler: F extends ValidBrick<F> ? BrickHandler<F> : never
): BrickImplementation<F> {
  const implementation = Object.assign(
    (params: ParamsOf<F>, ...options: BrickRunOptionArgs<F>) =>
      runDirectBrick(implementation, params, options[0] as never),
    { handler }
  ) as unknown as BrickImplementation<F>
  Object.defineProperty(implementation, 'run', {
    configurable: false,
    enumerable: false,
    value: implementation,
    writable: false
  })
  markBrickImplementation(implementation)
  return Object.freeze(implementation)
}
