import type { Engine } from '../engine/engine'
import type { EngineStatus } from '../engine/types'
import type {
  EffectiveErrorsOf,
  EffectiveSignalsOf,
  FlowContract,
  FlowImplementation,
  FlowSpec,
  ParamsOf,
  ResultOf,
  SignalsOf
} from '../flow/types'
import type { AnyLayer, LayerEntries, LayerEntriesOf } from '../layer/types'
import type {
  MatchedError,
  RecoveryValue,
  RemainingErrors,
  SupportedPattern
} from '../matching/types'
import type { BoundarySignalHandlers, SignalDefinitions } from '../signal/types'

export interface WorkerOptions<Layer extends AnyLayer = AnyLayer> {
  readonly engine: Engine
  /** v1 workers require a Layer so roots, providers, and durable IDs are sound. */
  readonly layer: Layer
}

export type RunMetadata = Readonly<Record<string, unknown>>

type ContractOf<Implementation> =
  Implementation extends FlowImplementation<infer S extends FlowSpec> ? FlowContract<S> : never

type ContractsInGraph<S extends FlowSpec, Depth extends readonly unknown[] = []> =
  | FlowContract<S>
  | (Depth['length'] extends 16
      ? never
      : {
          [Key in keyof S['depends']]: S['depends'][Key] extends FlowContract<
            infer Dependency extends FlowSpec
          >
            ? ContractsInGraph<Dependency, [...Depth, unknown]>
            : never
        }[keyof S['depends']])

type GraphImplementations<Entry, S extends FlowSpec> = Entry extends AnyLayer
  ? GraphImplementations<LayerEntriesOf<Entry>[keyof LayerEntriesOf<Entry>], S>
  : Entry extends FlowImplementation<infer _EntrySpec extends FlowSpec>
    ? ContractOf<Entry> extends ContractsInGraph<S>
      ? Entry
      : never
    : never

type SignalsForImplementation<Implementation> =
  Implementation extends FlowImplementation<infer S extends FlowSpec>
    ? SignalsOf<S> extends SignalDefinitions
      ? keyof SignalsOf<S> extends never
        ? never
        : BoundarySignalHandlers<SignalsOf<S>>
      : never
    : never

type EntrySignalHandlers<Entry, Included> = Entry extends AnyLayer
  ? SignalsForEntries<LayerEntriesOf<Entry>, Included>
  : Entry extends Included
    ? SignalsForImplementation<Entry>
    : never

type SignalsForEntries<Entries extends LayerEntries, Included> = {
  readonly [Key in keyof Entries as [EntrySignalHandlers<Entries[Key], Included>] extends [never]
    ? never
    : Key]: EntrySignalHandlers<Entries[Key], Included>
}

type LayerSignalHandlers<Layer extends AnyLayer, S extends FlowSpec> = {
  readonly [Id in Layer['id']]: SignalsForEntries<
    LayerEntriesOf<Layer>,
    GraphImplementations<LayerEntriesOf<Layer>[keyof LayerEntriesOf<Layer>], S>
  >
}

type SignalOptions<
  Layer extends AnyLayer,
  S extends FlowSpec
> = keyof EffectiveSignalsOf<S> extends never
  ? { readonly signals?: never }
  : { readonly signals: LayerSignalHandlers<Layer, S> }

export type WorkerRunOptions<Layer extends AnyLayer, S extends FlowSpec> = {
  readonly id?: string
  readonly metadata?: RunMetadata
} & SignalOptions<Layer, S>

export interface FlowRunControls {
  readonly id: string
  status(): Promise<EngineStatus>
  cancel(reason?: string): Promise<void>
}

export interface IncompleteFlowRun<
  Error,
  InitialSuccess,
  LocalResult = InitialSuccess,
  RemainingError = Error
> extends FlowRunControls {
  readonly unhandledErrors: RemainingError
  // Deliberately invalid Promise shape: bare await produces TS1320 until errors are exhausted.
  readonly then: (invalidOnFulfilled: never) => never
  with<const Pattern extends SupportedPattern<RemainingError>, HandlerResult>(
    pattern: Pattern extends readonly unknown[] ? never : Pattern,
    handler: (
      error: MatchedError<RemainingError, Pattern>
    ) => HandlerResult | Promise<HandlerResult>
  ): FlowRun<
    Error,
    InitialSuccess,
    LocalResult | RecoveryValue<HandlerResult>,
    RemainingErrors<RemainingError, Pattern, HandlerResult>
  >
}

export interface CompleteFlowRun<Error, InitialSuccess, LocalResult = InitialSuccess>
  extends FlowRunControls,
    PromiseLike<LocalResult> {
  with<const Pattern extends SupportedPattern<never>, HandlerResult>(
    pattern: Pattern extends readonly unknown[] ? never : Pattern,
    handler: (error: MatchedError<never, Pattern>) => HandlerResult | Promise<HandlerResult>
  ): FlowRun<Error, InitialSuccess, LocalResult | RecoveryValue<HandlerResult>, never>
}

export type FlowRun<Error, InitialSuccess, LocalResult = InitialSuccess, RemainingError = Error> = [
  RemainingError
] extends [never]
  ? CompleteFlowRun<Error, InitialSuccess, LocalResult>
  : IncompleteFlowRun<Error, InitialSuccess, LocalResult, RemainingError>

export interface WorkerState<Layer extends AnyLayer = AnyLayer> {
  readonly engine: Engine
  readonly layer: Layer
  run<S extends FlowSpec>(
    root: FlowImplementation<S>,
    params: ParamsOf<S>,
    ...options: keyof EffectiveSignalsOf<S> extends never
      ? readonly [options?: WorkerRunOptions<Layer, S>]
      : readonly [options: WorkerRunOptions<Layer, S>]
  ): FlowRun<EffectiveErrorsOf<S>, ResultOf<S>>
}

export interface WorkerConstructor {
  new <Layer extends AnyLayer>(options: WorkerOptions<Layer>): WorkerState<Layer>
}
