import { markFlowImplementation } from './implementation'
import type {
  FlowConstructorArgs,
  FlowContract,
  FlowHandler,
  FlowImplementation,
  FlowOptions,
  FlowSpec
} from './types'

export class Flow<S extends FlowSpec> implements FlowImplementation<S> {
  readonly contract: FlowContract<S>
  readonly depends: S['depends']
  readonly requires: readonly (keyof S['requires'] & string)[]
  readonly handler: FlowHandler<S>

  constructor(...args: FlowConstructorArgs<S>) {
    const hasOptions = args.length === 2
    const options = (hasOptions ? args[0] : { depends: {} }) as FlowOptions<S>
    const handler = (hasOptions ? args[1] : args[0]) as FlowHandler<S>

    this.contract = this.constructor as FlowContract<S>
    this.depends = Object.freeze({ ...options.depends }) as S['depends']
    this.requires = Object.freeze([...(options.requires ?? [])]) as readonly (keyof S['requires'] &
      string)[]
    this.handler = handler
    markFlowImplementation(this)
    Object.freeze(this)
  }
}
