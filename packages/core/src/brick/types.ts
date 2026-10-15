import type { HasValidPathSegmentKeys } from '../path-segment'
import type {
  BoundarySignalHandlers,
  InternalSignalHandlers,
  SignalDefinitions,
  SignalFunctions
} from '../signal/types'
import type { Worker } from '../worker/contract'
import type { BrickRun, IncompleteBrickRun, RunMetadata } from '../worker/types'
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
      ? { readonly signals?: never }
      : { readonly signals?: InternalSignalHandlers<SignalsOf<F>> }
    : { readonly signals?: never }

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

type HandlerOperationResult<Result, Errors> =
  Result extends IncompleteBrickRun<
    infer _Error,
    infer _InitialSuccess,
    infer LocalResult,
    infer RemainingError,
    infer _RecoveredResult
  >
    ? [RemainingError] extends [Errors]
      ? Result & PromiseLike<LocalResult>
      : Result
    : Result

type HandlerSignature<Signature, Errors> = Signature extends (
  this: infer Receiver,
  ...args: infer Args
) => infer Result
  ? (this: Receiver, ...args: Args) => HandlerOperationResult<Result, Errors>
  : never

// Transform only exactly recognized declarations. Inferring arbitrary overload
// sets can erase generics or truncate signatures, so all other sets stay original.
type OperationSignatures<Operation> = Operation extends {
  (this: infer FirstReceiver, ...args: infer FirstArgs): infer FirstResult
  (this: infer LastReceiver, ...args: infer LastArgs): infer LastResult
}
  ?
      | ((this: FirstReceiver, ...args: FirstArgs) => FirstResult)
      | ((this: LastReceiver, ...args: LastArgs) => LastResult)
  : never

type SameSignature<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false

type HasGenericIdentityOverload<Requirement, Error, Remaining, Constraint> = Requirement extends {
  (...args: infer FirstArgs): infer FirstResult
  (...args: infer LastArgs): infer LastResult
}
  ? SameSignature<
      Requirement,
      {
        <Value extends Constraint>(
          value: Value
        ): IncompleteBrickRun<Error, Value, Value, Remaining, never>
        (...args: LastArgs): LastResult
      }
    > extends true
    ? true
    : SameSignature<
        Requirement,
        {
          (...args: FirstArgs): FirstResult
          <Value extends Constraint>(
            value: Value
          ): IncompleteBrickRun<Error, Value, Value, Remaining, never>
        }
      >
  : false

// Compare signatures exactly: an unknown-valued overload can otherwise look
// assignable to a generic identity without preserving its input/output relation.
type GenericIdentitySignature<
  Requirement,
  Errors,
  Signature = OperationSignatures<Requirement>
> = Signature extends (
  value: infer Constraint
) => IncompleteBrickRun<
  infer Error,
  infer _Initial,
  infer _Local,
  infer Remaining,
  infer _Recovered
>
  ? HasGenericIdentityOverload<Requirement, Error, Remaining, Constraint> extends true
    ? <Value extends Constraint>(
        value: Value
      ) => HandlerOperationResult<IncompleteBrickRun<Error, Value, Value, Remaining, never>, Errors>
    : never
  : never

type ContextualSignature<Signature, Errors, Requirement> = Signature extends unknown
  ? [GenericIdentitySignature<Requirement, Errors, Signature>] extends [never]
    ? HandlerSignature<Signature, Errors>
    : never
  : never

type HandlerOverloads<Requirement, Errors> = UnionToIntersection<
  ContextualSignature<OperationSignatures<Requirement>, Errors, Requirement>
> &
  ([GenericIdentitySignature<Requirement, Errors>] extends [never]
    ? unknown
    : UnionToIntersection<GenericIdentitySignature<Requirement, Errors>>) &
  Pick<Requirement, keyof Requirement>

// Exact comparison distinguishes a concrete pair from erased generics and
// larger sets. Preserve every original declaration when recognition fails.
type CompatibleHandlerOverloads<Requirement, Errors> = Requirement extends {
  (this: infer FirstReceiver, ...args: infer FirstArgs): infer FirstResult
  (this: infer LastReceiver, ...args: infer LastArgs): infer LastResult
}
  ? [GenericIdentitySignature<Requirement, Errors>] extends [never]
    ? SameSignature<
        Requirement,
        {
          (this: FirstReceiver, ...args: FirstArgs): FirstResult
          (this: LastReceiver, ...args: LastArgs): LastResult
        }
      > extends true
      ? HandlerOverloads<Requirement, Errors>
      : Requirement
    : HandlerOverloads<Requirement, Errors>
  : Requirement

type HandlerRequirement<Requirement, Errors> = Requirement extends (
  this: infer Receiver,
  ...args: infer Args
) => infer Result
  ? SameSignature<Requirement, (this: Receiver, ...args: Args) => Result> extends true
    ? HandlerSignature<Requirement, Errors>
    : Result extends IncompleteBrickRun<
          infer Error,
          infer _Initial,
          infer _Local,
          infer RemainingError,
          infer _Recovered
        >
      ? SameSignature<
          Requirement,
          <Value extends Args[0]>(
            this: Receiver,
            value: Value
          ) => IncompleteBrickRun<Error, Value, Value, RemainingError, never>
        > extends true
        ? (<Value extends Args[0]>(
            this: Receiver,
            value: Value
          ) => HandlerOperationResult<
            IncompleteBrickRun<Error, Value, Value, RemainingError, never>,
            Errors
          >) &
            Requirement
        : CompatibleHandlerOverloads<Requirement, Errors>
      : CompatibleHandlerOverloads<Requirement, Errors>
  : Requirement

type HandlerRequirements<F extends Brick> = {
  [Key in keyof RequirementsOf<F>]: HandlerRequirement<RequirementsOf<F>[Key], ErrorsOf<F>>
}

export type BrickHandler<F extends Brick> = (
  params: ParamsOf<F>,
  requirements: HandlerRequirements<F>,
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
  (
    params: ParamsOf<F>,
    ...options: BrickRunOptionArgs<F>
  ): BrickRun<EffectiveErrorsOf<F>, ResultOf<F>>
  readonly handler: BrickHandler<F>
  run(
    params: ParamsOf<F>,
    ...options: BrickRunOptionArgs<F>
  ): BrickRun<EffectiveErrorsOf<F>, ResultOf<F>>
}

export type BrickExecutionResult<F extends Brick> =
  | { readonly ok: true; readonly value: ResultOf<F> }
  | { readonly ok: false; readonly error: ErrorsOf<F> }
