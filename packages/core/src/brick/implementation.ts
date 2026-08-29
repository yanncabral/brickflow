import type { SignalDefinitions, SignalFunctions } from '../signal/types'
import type { Brick } from './contract'
import { failWith, isBrickFailure, readBrickFailure } from './failure'
import type {
  BrickExecutionResult,
  BrickImplementation,
  DependencyFunctions,
  ErrorsOf,
  ParamsOf,
  RequirementsOf,
  SignalsOf
} from './types'

const implementationBrand = Symbol('BrickImplementation')

type BrandedImplementation = { readonly [implementationBrand]: true }

export function markBrickImplementation(target: object): void {
  Object.defineProperty(target, implementationBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  })
}

export function isBrickImplementation(value: unknown): value is BrickImplementation {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, implementationBrand) &&
    (value as BrandedImplementation)[implementationBrand] === true
  )
}

export async function executeBrickImplementation<F extends Brick>(
  implementation: BrickImplementation<F>,
  params: ParamsOf<F>,
  requirements: RequirementsOf<F>,
  dependencies: DependencyFunctions<F>,
  signals: SignalsOf<F> extends SignalDefinitions ? SignalFunctions<SignalsOf<F>> : never
): Promise<BrickExecutionResult<F>> {
  try {
    const value = await implementation.handler(params, requirements, dependencies, {
      fail: failWith,
      signals
    })
    return { ok: true, value }
  } catch (error) {
    if (!isBrickFailure(error)) throw error
    return { ok: false, error: readBrickFailure(error) as ErrorsOf<F> }
  }
}
