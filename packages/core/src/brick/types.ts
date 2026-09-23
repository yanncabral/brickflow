import type { HasValidPathSegmentKeys } from '../path-segment'
import type { BrickPlugin } from '../plugin/types'
import type {
  BoundarySignalHandlers,
  InternalSignalHandlers,
  SignalDefinitions,
  SignalFunctions
} from '../signal/types'
import type { Worker } from '../worker/contract'
import type { BrickRun, RunMetadata } from '../worker/types'
import type { Brick } from './contract'

type Empty = Record<never, never>

type DeclaredProperty<F, Key extends PropertyKey, Default> =
  F extends Record<Key, infer Value> ? Value : Default

export type ParamsOf<F extends Brick> = F['params']
export type ResultOf<F extends Brick> = F['result']
export type ErrorsOf<F extends Brick> = DeclaredProperty<F, 'errors', never>
export type RequirementsOf<F extends Brick> =
  DeclaredProperty<F, 'requires', Empty> extends object
    ? DeclaredProperty<F, 'requires', Empty>
    : Empty
export type DependenciesOf<F extends Brick> =
  DeclaredProperty<F, 'depends', Empty> extends object
    ? DeclaredProperty<F, 'depends', Empty>
    : Empty
export type SignalsOf<F extends Brick> =
  DeclaredProperty<F, 'signals', Empty> extends object
    ? DeclaredProperty<F, 'signals', Empty>
    : Empty

export type ValidBrick<F extends Brick> =
  HasValidPathSegmentKeys<DependenciesOf<F>> extends true
    ? HasValidPathSegmentKeys<SignalsOf<F>> extends true
      ? F
      : never
    : never

export type BrickOf<Implementation> =
  Implementation extends BrickImplementation<infer F> ? F : never

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous Brick implementations are intentionally erased at graph boundaries
export type AnyBrickImplementation = BrickImplementation<any>

type DependencyBrick<Value> = Value extends Brick ? Value : never

type UnionToIntersection<Value> = (Value extends Value ? (value: Value) => void : never) extends (
  value: infer Intersection
) => void
  ? Intersection
  : never

type EffectiveErrorsFromDependencies<F extends Brick, Depth extends readonly unknown[]> = {
  [Key in keyof DependenciesOf<F>]: EffectiveErrorsOf<
    DependencyBrick<DependenciesOf<F>[Key]>,
    Depth
  >
}[keyof DependenciesOf<F>]

type EffectiveRequirementsFromDependencies<
  F extends Brick,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof DependenciesOf<F>]: EffectiveRequirementsOf<
      DependencyBrick<DependenciesOf<F>[Key]>,
      Depth
    >
  }[keyof DependenciesOf<F>]
>

type EffectiveDependenciesFromDependencies<
  F extends Brick,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof DependenciesOf<F>]: EffectiveDependenciesOf<
      DependencyBrick<DependenciesOf<F>[Key]>,
      Depth
    >
  }[keyof DependenciesOf<F>]
>

type EffectiveSignalsFromDependencies<
  F extends Brick,
  Depth extends readonly unknown[]
> = UnionToIntersection<
  {
    [Key in keyof DependenciesOf<F>]: EffectiveSignalsOf<
      DependencyBrick<DependenciesOf<F>[Key]>,
      Depth
    >
  }[keyof DependenciesOf<F>]
>

export type EffectiveErrorsOf<
  F extends Brick,
  Depth extends readonly unknown[] = []
> = Depth['length'] extends 16
  ? ErrorsOf<F>
  : ErrorsOf<F> | EffectiveErrorsFromDependencies<F, [...Depth, unknown]>

export type EffectiveRequirementsOf<
  F extends Brick,
  Depth extends readonly unknown[] = []
> = RequirementsOf<F> &
  (Depth['length'] extends 16
    ? Empty
    : EffectiveRequirementsFromDependencies<F, [...Depth, unknown]>)

export type EffectiveDependenciesOf<F extends Brick, Depth extends readonly unknown[] = []> = {
  readonly [Key in keyof DependenciesOf<F>]: BrickImplementation<
    DependencyBrick<DependenciesOf<F>[Key]>
  >
} & (Depth['length'] extends 16
  ? Empty
  : EffectiveDependenciesFromDependencies<F, [...Depth, unknown]>)

export type EffectiveSignalsOf<
  F extends Brick,
  Depth extends readonly unknown[] = []
> = SignalsOf<F> &
  (Depth['length'] extends 16 ? Empty : EffectiveSignalsFromDependencies<F, [...Depth, unknown]>)

type DependencyNodes<F extends Brick, Depth extends readonly unknown[] = []> = {
  readonly [Alias in keyof DependenciesOf<F>]: DependencyNode<
    DependencyBrick<DependenciesOf<F>[Alias]>,
    Depth
  >
}

export type DependencyNode<
  F extends Brick,
  Depth extends readonly unknown[] = []
> = Depth['length'] extends 16
  ? {
      readonly brick: BrickImplementation<F>
    } & (keyof DependenciesOf<F> extends never
      ? { readonly dependencies?: never }
      : {
          readonly dependencies: {
            readonly [Alias in keyof DependenciesOf<F>]: {
              readonly brick: AnyBrickImplementation
              readonly dependencies: Readonly<Record<string, unknown>>
            }
          }
        })
  : {
      readonly brick: BrickImplementation<F>
    } & (keyof DependenciesOf<F> extends never
      ? { readonly dependencies?: never }
      : { readonly dependencies: DependencyNodes<F, [...Depth, unknown]> })

export type DependencySignalHandlers<F extends Brick, Depth extends readonly unknown[] = []> = {
  readonly [Alias in keyof DependenciesOf<F> as keyof BrickSignalHandlers<
    DependencyBrick<DependenciesOf<F>[Alias]>,
    [...Depth, unknown]
  > extends never
    ? never
    : Alias]: BrickSignalHandlers<DependencyBrick<DependenciesOf<F>[Alias]>, [...Depth, unknown]>
}

type DepthFallbackSignalHandlers<F extends Brick> = keyof DependenciesOf<F> extends never
  ? Empty
  : {
      readonly [Alias in keyof DependenciesOf<F>]: Readonly<Record<string, unknown>>
    }

export type BrickSignalHandlers<
  F extends Brick,
  Depth extends readonly unknown[] = []
> = (SignalsOf<F> extends SignalDefinitions
  ? keyof SignalsOf<F> extends never
    ? Empty
    : BoundarySignalHandlers<SignalsOf<F>>
  : Empty) &
  (Depth['length'] extends 16 ? DepthFallbackSignalHandlers<F> : DependencySignalHandlers<F, Depth>)

type DependencyCallOptions<F extends Brick> =
  SignalsOf<F> extends SignalDefinitions
    ? keyof SignalsOf<F> extends never
      ? { readonly signals?: never; readonly plugins?: readonly BrickPlugin[] }
      : {
          readonly signals?: InternalSignalHandlers<SignalsOf<F>>
          readonly plugins?: readonly BrickPlugin[]
        }
    : { readonly signals?: never; readonly plugins?: readonly BrickPlugin[] }

export type DependencyFunctions<F extends Brick> = {
  readonly [Key in keyof DependenciesOf<F>]: (
    params: ParamsOf<DependencyBrick<DependenciesOf<F>[Key]>>,
    options?: DependencyCallOptions<DependencyBrick<DependenciesOf<F>[Key]>>
  ) => Promise<ResultOf<DependencyBrick<DependenciesOf<F>[Key]>>>
}

export interface BrickTools<F extends Brick> {
  readonly fail: (error: ErrorsOf<F>) => never
  readonly signals: SignalsOf<F> extends SignalDefinitions ? SignalFunctions<SignalsOf<F>> : never
}

export type BrickHandler<F extends Brick> = (
  params: ParamsOf<F>,
  requirements: RequirementsOf<F>,
  dependencies: DependencyFunctions<F>,
  tools: BrickTools<F>
) => ResultOf<F> | Promise<ResultOf<F>>

type RequiredSection<Key extends PropertyKey, Value> = [Key] extends [never]
  ? { readonly [Property in never]?: never }
  : Value

type RequirementsOption<F extends Brick> = RequiredSection<
  keyof EffectiveRequirementsOf<F>,
  { readonly requirements: EffectiveRequirementsOf<F> }
>
type DependenciesOption<F extends Brick> = RequiredSection<
  keyof DependenciesOf<F>,
  { readonly dependencies: DependencyNodes<F> }
>
type SignalsOption<F extends Brick> = keyof BrickSignalHandlers<F> extends never
  ? { readonly signals?: never }
  : { readonly signals: BrickSignalHandlers<F> }

export type BrickRunOptions<F extends Brick> = {
  readonly worker?: Worker
  readonly id?: string
  readonly metadata?: RunMetadata
  readonly plugins?: readonly BrickPlugin[]
  readonly isReplay?: boolean
} & RequirementsOption<F> &
  DependenciesOption<F> &
  SignalsOption<F>

export type BrickRunOptionArgs<F extends Brick> = keyof EffectiveRequirementsOf<F> extends never
  ? keyof DependenciesOf<F> extends never
    ? keyof BrickSignalHandlers<F> extends never
      ? readonly [options?: BrickRunOptions<F>]
      : readonly [options: BrickRunOptions<F>]
    : readonly [options: BrickRunOptions<F>]
  : readonly [options: BrickRunOptions<F>]

export interface BrickImplementation<F extends Brick = Brick> {
  readonly handler: BrickHandler<F>
  readonly plugins?: readonly BrickPlugin[]
  run(
    params: ParamsOf<F>,
    ...options: BrickRunOptionArgs<F>
  ): BrickRun<EffectiveErrorsOf<F>, ResultOf<F>>
}

export type BrickExecutionResult<F extends Brick> =
  | { readonly ok: true; readonly value: ResultOf<F> }
  | { readonly ok: false; readonly error: ErrorsOf<F> }
