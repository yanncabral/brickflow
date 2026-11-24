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

type ImplementationConfig = Pick<BrickConfig, 'requires' | 'depends'>

type InvalidImplementationKeys<
  F extends Brick,
  Config extends ImplementationConfig
> = Config extends ImplementationConfig
  ?
      | Exclude<keyof Config, keyof ImplementationConfig>
      | (keyof NonNullable<F['requires']> & keyof NonNullable<Config['requires']>)
      | (keyof NonNullable<F['depends']> & keyof NonNullable<Config['depends']>)
  : never

type ImplementationContract<
  F extends Brick,
  Config extends ImplementationConfig
> = keyof Config extends never ? F : F & Config

export function brick<F extends Brick, Config extends ImplementationConfig = Record<never, never>>(
  handler: InvalidImplementationKeys<F, Config> extends never
    ? ImplementationContract<F, Config> extends ValidBrick<ImplementationContract<F, Config>>
      ? BrickHandler<ImplementationContract<F, Config>>
      : never
    : never
): BrickImplementation<ImplementationContract<F, Config>> {
  type Contract = ImplementationContract<F, Config>
  const implementation = Object.assign(
    (params: ParamsOf<Contract>, ...options: BrickRunOptionArgs<Contract>) =>
      runDirectBrick(implementation, params, options[0] as never),
    { handler }
  ) as unknown as BrickImplementation<Contract>
  Object.defineProperty(implementation, 'run', {
    configurable: false,
    enumerable: false,
    value: implementation,
    writable: false
  })
  markBrickImplementation(implementation)
  return Object.freeze(implementation)
}
