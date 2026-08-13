import type { SignalDefinitions, SignalFunctions } from '../signal/types'
import type { Flow } from './contract'
import { failWith, isFlowFailure, readFlowFailure } from './failure'
import type {
  DependencyFunctions,
  ErrorsOf,
  FlowExecutionResult,
  FlowImplementation,
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

export async function executeFlowImplementation<F extends Flow>(
  implementation: FlowImplementation<F>,
  params: ParamsOf<F>,
  requirements: RequirementsOf<F>,
  dependencies: DependencyFunctions<F>,
  signals: SignalsOf<F> extends SignalDefinitions ? SignalFunctions<SignalsOf<F>> : never
): Promise<FlowExecutionResult<F>> {
  try {
    const value = await implementation.handler(params, requirements, dependencies, {
      fail: failWith,
      signals
    })
    return { ok: true, value }
  } catch (error) {
    if (!isFlowFailure(error)) throw error
    return { ok: false, error: readFlowFailure(error) as ErrorsOf<F> }
  }
}
