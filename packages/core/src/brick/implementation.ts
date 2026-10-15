import type { SignalDefinitions, SignalFunctions } from '../signal/types'
import type { Brick } from './contract'
import { brickExecutionScope } from './execution-scope'
import { failWith, isBrickFailure, readBrickFailure } from './failure'
import type {
  BrickExecutionResult,
  BrickHandler,
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
    (typeof value === 'object' || typeof value === 'function') &&
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
  const scope = { active: true }
  try {
    const value = await brickExecutionScope.run(scope, () =>
      implementation.handler(params, requirements as Parameters<BrickHandler<F>>[1], dependencies, {
        fail: failWith,
        signals
      })
    )
    return { ok: true, value }
  } catch (error) {
    if (!isBrickFailure(error)) throw error
    return { ok: false, error: readBrickFailure(error) as ErrorsOf<F> }
  } finally {
    scope.active = false
  }
}
