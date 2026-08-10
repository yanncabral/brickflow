import type { SignalDefinitions, SignalFunctions } from '../signal/types'
import { failWith, isFlowFailure, readFlowFailure } from './failure'
import type {
  DependencyFunctions,
  FlowExecutionResult,
  FlowImplementation,
  FlowSpec,
  ParamsOf,
  RequirementsOf,
  SignalsOf
} from './types'

const implementationBrand = Symbol('FlowImplementation')

type BrandedImplementation = { readonly [implementationBrand]: true }

export function markFlowImplementation(target: object): void {
  Object.defineProperty(target, implementationBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  })
}

export function isFlowImplementation(value: unknown): value is FlowImplementation {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, implementationBrand) &&
    (value as BrandedImplementation)[implementationBrand] === true
  )
}

export async function executeFlowImplementation<S extends FlowSpec>(
  implementation: FlowImplementation<S>,
  params: ParamsOf<S>,
  requirements: RequirementsOf<S>,
  dependencies: DependencyFunctions<S>,
  signals: SignalsOf<S> extends SignalDefinitions ? SignalFunctions<SignalsOf<S>> : never
): Promise<FlowExecutionResult<S>> {
  try {
    const value = await implementation.handler(params, requirements, dependencies, {
      fail: failWith,
      signals
    })
    return { ok: true, value }
  } catch (error) {
    if (!isFlowFailure(error)) {
      throw error
    }

    return {
      ok: false,
      error: readFlowFailure(error) as S['errors']
    }
  }
}
