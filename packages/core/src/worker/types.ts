import type { EngineStatus } from '../engine/types'
import type { Flow } from '../flow/contract'
import type { EffectiveSignalsOf, FlowImplementation, SignalsOf } from '../flow/types'
import type { AnyLayer, LayerEntries, LayerEntriesOf } from '../layer/types'
import type {
  MatchedError,
  RecoveryValue,
  RemainingErrors,
  SupportedPattern
} from '../matching/types'
import type { BoundarySignalHandlers, SignalDefinitions } from '../signal/types'

export type RunMetadata = Readonly<Record<string, unknown>>

type DependencyFlows<F extends Flow, Depth extends readonly unknown[] = []> =
  | F
  | (Depth['length'] extends 16
      ? never
      : F extends { readonly depends: infer Dependencies extends object }
        ? {
            [Key in keyof Dependencies]: Dependencies[Key] extends Flow
              ? DependencyFlows<Dependencies[Key], [...Depth, unknown]>
              : never
          }[keyof Dependencies]
        : never)

type GraphImplementations<Entry, F extends Flow> = Entry extends AnyLayer
  ? GraphImplementations<LayerEntriesOf<Entry>[keyof LayerEntriesOf<Entry>], F>
  : Entry extends FlowImplementation<infer EntryFlow extends Flow>
    ? EntryFlow extends DependencyFlows<F>
      ? Entry
      : never
    : never

type SignalsForImplementation<Implementation> =
  Implementation extends FlowImplementation<infer F extends Flow>
    ? SignalsOf<F> extends SignalDefinitions
      ? keyof SignalsOf<F> extends never
        ? never
        : BoundarySignalHandlers<SignalsOf<F>>
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

export type LayerSignalHandlers<Layer extends AnyLayer, F extends Flow> = {
  readonly [Id in Layer['id']]: SignalsForEntries<
    LayerEntriesOf<Layer>,
    GraphImplementations<LayerEntriesOf<Layer>[keyof LayerEntriesOf<Layer>], F>
  >
}

type SignalOptions<
  Layer extends AnyLayer,
  F extends Flow
> = keyof EffectiveSignalsOf<F> extends never
  ? { readonly signals?: never }
  : { readonly signals: LayerSignalHandlers<Layer, F> }

export type WorkerRunOptions<Layer extends AnyLayer, F extends Flow> = {
  readonly id?: string
  readonly metadata?: RunMetadata
} & SignalOptions<Layer, F>

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
