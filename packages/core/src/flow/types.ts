import type {
  BoundarySignalHandlers,
  InternalSignalHandlers,
  SignalDefinitions,
  SignalFunctions
} from '../signal/types'
import type { Worker } from '../worker/contract'
import type { FlowRun, RunMetadata } from '../worker/types'
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

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous Flow implementations are intentionally erased at graph boundaries
export type AnyFlowImplementation = FlowImplementation<any>

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

type EffectiveDependenciesFromDependencies<
  F extends Flow,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof DependenciesOf<F>]: EffectiveDependenciesOf<
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

export type EffectiveDependenciesOf<F extends Flow, Depth extends readonly unknown[] = []> = {
  readonly [Key in keyof DependenciesOf<F>]: FlowImplementation<
    DependencyFlow<DependenciesOf<F>[Key]>
  >
} & (Depth['length'] extends 16
  ? Empty
  : EffectiveDependenciesFromDependencies<F, [...Depth, unknown]>)

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

type RequiredSection<Key extends PropertyKey, Value> = [Key] extends [never]
  ? { readonly [Property in never]?: never }
  : Value

type RequirementsOption<F extends Flow> = RequiredSection<
  keyof EffectiveRequirementsOf<F>,
  { readonly requirements: EffectiveRequirementsOf<F> }
>
type DependenciesOption<F extends Flow> = RequiredSection<
  keyof EffectiveDependenciesOf<F>,
  { readonly dependencies: EffectiveDependenciesOf<F> }
>
type SignalsOption<F extends Flow> = keyof EffectiveSignalsOf<F> extends never
  ? { readonly signals?: never }
  : EffectiveSignalsOf<F> extends SignalDefinitions
    ? { readonly signals: BoundarySignalHandlers<EffectiveSignalsOf<F>> }
    : { readonly signals?: never }

export type FlowRunOptions<F extends Flow> = {
  readonly worker?: Worker
  readonly id?: string
  readonly metadata?: RunMetadata
} & RequirementsOption<F> &
  DependenciesOption<F> &
  SignalsOption<F>

export type FlowRunOptionArgs<F extends Flow> = keyof EffectiveRequirementsOf<F> extends never
  ? keyof EffectiveDependenciesOf<F> extends never
    ? keyof EffectiveSignalsOf<F> extends never
      ? readonly [options?: FlowRunOptions<F>]
      : readonly [options: FlowRunOptions<F>]
    : readonly [options: FlowRunOptions<F>]
  : readonly [options: FlowRunOptions<F>]

export interface FlowImplementation<F extends Flow = Flow> {
  readonly handler: FlowHandler<F>
  run(
    params: ParamsOf<F>,
    ...options: FlowRunOptionArgs<F>
  ): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>>
}

export type FlowExecutionResult<F extends Flow> =
  | { readonly ok: true; readonly value: ResultOf<F> }
  | { readonly ok: false; readonly error: ErrorsOf<F> }
