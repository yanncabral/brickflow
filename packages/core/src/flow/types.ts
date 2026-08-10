import type { InternalSignalHandlers, SignalDefinitions, SignalFunctions } from '../signal/types'

export interface FlowSpec {
  params: unknown
  result: unknown
  errors: unknown
  requires: object
  depends: object
  signals: object
}

export interface FlowContract<S extends FlowSpec> {
  readonly prototype: FlowImplementation<S>
}

type DependencyContractConstraint<D extends object> = {
  readonly [K in keyof D]: D[K] extends FlowContract<infer _DependencySpec> ? D[K] : never
}

type ValidateDependencyContracts<S extends FlowSpec> =
  S['depends'] extends DependencyContractConstraint<S['depends']> ? S : never

export type ParamsOf<S extends FlowSpec> = S['params']
export type ResultOf<S extends FlowSpec> = S['result']
export type ErrorsOf<S extends FlowSpec> = S['errors']
export type RequirementsOf<S extends FlowSpec> = S['requires']
export type SignalsOf<S extends FlowSpec> = S['signals']

export type SpecOf<C> = C extends { readonly prototype: FlowImplementation<infer S> } ? S : never

type UnionToIntersection<Value> = (Value extends Value ? (value: Value) => void : never) extends (
  value: infer Intersection
) => void
  ? Intersection
  : never

type EffectiveErrorsFromDependencies<S extends FlowSpec, Depth extends readonly unknown[]> = {
  [Key in keyof S['depends']]: SpecOf<S['depends'][Key]> extends infer Dependency extends FlowSpec
    ? EffectiveErrorsOf<Dependency, Depth>
    : never
}[keyof S['depends']]

type EffectiveRequirementsFromDependencies<
  S extends FlowSpec,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof S['depends']]: SpecOf<S['depends'][Key]> extends infer Dependency extends FlowSpec
      ? EffectiveRequirementsOf<Dependency, Depth>
      : Record<never, never>
  }[keyof S['depends']]
>

type EffectiveSignalsFromDependencies<
  S extends FlowSpec,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof S['depends']]: SpecOf<S['depends'][Key]> extends infer Dependency extends FlowSpec
      ? EffectiveSignalsOf<Dependency, Depth>
      : Record<never, never>
  }[keyof S['depends']]
>

export type EffectiveErrorsOf<
  S extends FlowSpec,
  Depth extends readonly unknown[] = []
> = Depth['length'] extends 16
  ? ErrorsOf<S>
  : ErrorsOf<S> | EffectiveErrorsFromDependencies<S, [...Depth, unknown]>

export type EffectiveRequirementsOf<
  S extends FlowSpec,
  Depth extends readonly unknown[] = []
> = RequirementsOf<S> &
  (Depth['length'] extends 16
    ? Record<never, never>
    : EffectiveRequirementsFromDependencies<S, [...Depth, unknown]>)

export type EffectiveSignalsOf<
  S extends FlowSpec,
  Depth extends readonly unknown[] = []
> = SignalsOf<S> &
  (Depth['length'] extends 16
    ? Record<never, never>
    : EffectiveSignalsFromDependencies<S, [...Depth, unknown]>)

type DependencyCallOptions<S extends FlowSpec> =
  SignalsOf<S> extends SignalDefinitions
    ? keyof SignalsOf<S> extends never
      ? { readonly signals?: never }
      : { readonly signals?: InternalSignalHandlers<SignalsOf<S>> }
    : { readonly signals?: never }

export type DependencyFunctions<S extends FlowSpec> = {
  readonly [K in keyof S['depends']]: (
    params: ParamsOf<SpecOf<S['depends'][K]>>,
    options?: DependencyCallOptions<SpecOf<S['depends'][K]>>
  ) => Promise<ResultOf<SpecOf<S['depends'][K]>>>
}

export interface FlowTools<S extends FlowSpec> {
  readonly fail: (error: ErrorsOf<S>) => never
  readonly signals: SignalsOf<S> extends SignalDefinitions ? SignalFunctions<SignalsOf<S>> : never
}

export type FlowHandler<S extends FlowSpec> = (
  params: ParamsOf<S>,
  requirements: RequirementsOf<S>,
  dependencies: DependencyFunctions<S>,
  tools: FlowTools<S>
) => ResultOf<S> | Promise<ResultOf<S>>

type KeyTuples<Keys extends string, All extends string = Keys> = [Keys] extends [never]
  ? readonly []
  : Keys extends Keys
    ? readonly [Keys, ...KeyTuples<Exclude<All, Keys>>]
    : never

export type FlowOptions<S extends FlowSpec> = {
  readonly depends: S['depends']
} & (keyof S['requires'] & string extends infer Keys extends string
  ? [Keys] extends [never]
    ? { readonly requires?: readonly [] }
    : { readonly requires: KeyTuples<Keys> }
  : never)

type HasNoRequirementsOrDependencies<S extends FlowSpec> = keyof S['requires'] extends never
  ? keyof S['depends'] extends never
    ? true
    : false
  : false

export type FlowConstructorArgs<S extends FlowSpec> =
  ValidateDependencyContracts<S> extends never
    ? never
    : HasNoRequirementsOrDependencies<S> extends true
      ?
          | readonly [handler: FlowHandler<S>]
          | readonly [options: FlowOptions<S>, handler: FlowHandler<S>]
      : readonly [options: FlowOptions<S>, handler: FlowHandler<S>]

export interface FlowImplementation<S extends FlowSpec = FlowSpec> {
  readonly contract: FlowContract<S>
  readonly depends: S['depends']
  readonly requires: readonly (keyof S['requires'] & string)[]
  readonly handler: FlowHandler<S>
}

export type FlowExecutionResult<S extends FlowSpec> =
  | { readonly ok: true; readonly value: ResultOf<S> }
  | { readonly ok: false; readonly error: ErrorsOf<S> }
