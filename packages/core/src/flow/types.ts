import type { InternalSignalHandlers, SignalDefinitions, SignalFunctions } from '../signal/types'
import type { Flow } from './contract'

type Empty = Record<never, never>

type DeclaredProperty<F, Key extends PropertyKey, Default> =
  F extends Record<Key, infer Value> ? Value : Default

export type ParamsOf<F extends Flow> = F['params']
export type ResultOf<F extends Flow> = F['result']
export type ErrorsOf<F extends Flow> = DeclaredProperty<F, 'errors', never>
export type RequirementsOf<F extends Flow> =
  DeclaredProperty<F, 'requires', Empty> extends object
    ? DeclaredProperty<F, 'requires', Empty>
    : Empty
export type DependenciesOf<F extends Flow> =
  DeclaredProperty<F, 'depends', Empty> extends object
    ? DeclaredProperty<F, 'depends', Empty>
    : Empty
export type SignalsOf<F extends Flow> =
  DeclaredProperty<F, 'signals', Empty> extends object
    ? DeclaredProperty<F, 'signals', Empty>
    : Empty

export type FlowOf<Implementation> = Implementation extends FlowImplementation<infer F> ? F : never

type DependencyFlow<Value> = Value extends Flow ? Value : never

type UnionToIntersection<Value> = (Value extends Value ? (value: Value) => void : never) extends (
  value: infer Intersection
) => void
  ? Intersection
  : never

type EffectiveErrorsFromDependencies<F extends Flow, Depth extends readonly unknown[]> = {
  [Key in keyof DependenciesOf<F>]: EffectiveErrorsOf<DependencyFlow<DependenciesOf<F>[Key]>, Depth>
}[keyof DependenciesOf<F>]

type EffectiveRequirementsFromDependencies<
  F extends Flow,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof DependenciesOf<F>]: EffectiveRequirementsOf<
      DependencyFlow<DependenciesOf<F>[Key]>,
      Depth
    >
  }[keyof DependenciesOf<F>]
>

type EffectiveSignalsFromDependencies<
  F extends Flow,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof DependenciesOf<F>]: EffectiveSignalsOf<
      DependencyFlow<DependenciesOf<F>[Key]>,
      Depth
    >
  }[keyof DependenciesOf<F>]
>

export type EffectiveErrorsOf<
  F extends Flow,
  Depth extends readonly unknown[] = []
> = Depth['length'] extends 16
  ? ErrorsOf<F>
  : ErrorsOf<F> | EffectiveErrorsFromDependencies<F, [...Depth, unknown]>

export type EffectiveRequirementsOf<
  F extends Flow,
  Depth extends readonly unknown[] = []
> = RequirementsOf<F> &
  (Depth['length'] extends 16
    ? Empty
    : EffectiveRequirementsFromDependencies<F, [...Depth, unknown]>)

export type EffectiveSignalsOf<
  F extends Flow,
  Depth extends readonly unknown[] = []
> = SignalsOf<F> &
  (Depth['length'] extends 16 ? Empty : EffectiveSignalsFromDependencies<F, [...Depth, unknown]>)

type DependencyCallOptions<F extends Flow> =
  SignalsOf<F> extends SignalDefinitions
    ? keyof SignalsOf<F> extends never
      ? { readonly signals?: never }
      : { readonly signals?: InternalSignalHandlers<SignalsOf<F>> }
    : { readonly signals?: never }

export type DependencyFunctions<F extends Flow> = {
  readonly [Key in keyof DependenciesOf<F>]: (
    params: ParamsOf<DependencyFlow<DependenciesOf<F>[Key]>>,
    options?: DependencyCallOptions<DependencyFlow<DependenciesOf<F>[Key]>>
  ) => Promise<ResultOf<DependencyFlow<DependenciesOf<F>[Key]>>>
}

export interface FlowTools<F extends Flow> {
  readonly fail: (error: ErrorsOf<F>) => never
  readonly signals: SignalsOf<F> extends SignalDefinitions ? SignalFunctions<SignalsOf<F>> : never
}

export type FlowHandler<F extends Flow> = (
  params: ParamsOf<F>,
  requirements: RequirementsOf<F>,
  dependencies: DependencyFunctions<F>,
  tools: FlowTools<F>
) => ResultOf<F> | Promise<ResultOf<F>>

export interface FlowImplementation<F extends Flow = Flow> {
  readonly handler: FlowHandler<F>
}

export type FlowExecutionResult<F extends Flow> =
  | { readonly ok: true; readonly value: ResultOf<F> }
  | { readonly ok: false; readonly error: ErrorsOf<F> }
