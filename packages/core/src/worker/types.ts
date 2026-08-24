import type { EngineStatus } from '../engine/types'
import type { Flow } from '../flow/contract'
import type { DependenciesOf, FlowImplementation, SignalsOf } from '../flow/types'
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

type DependencyFlow<Value> = Value extends Flow ? Value : never

type DirectDependencyFlows<F extends Flow> = {
  [Alias in keyof DependenciesOf<F>]: DependencyFlow<DependenciesOf<F>[Alias]>
}[keyof DependenciesOf<F>]

type SelectedGraphFlows<F extends Flow> =
  | F
  | Exclude<DependencyFlows<F>, F | DirectDependencyFlows<F>>

type SignalsForImplementation<Implementation> =
  Implementation extends FlowImplementation<infer F extends Flow>
    ? SignalsOf<F> extends SignalDefinitions
      ? keyof SignalsOf<F> extends never
        ? never
        : BoundarySignalHandlers<SignalsOf<F>>
      : never
    : never

type EntrySignalHandlers<
  Entry,
  IncludedFlows,
  ExcludedAliases extends PropertyKey
> = Entry extends AnyLayer
  ? SignalsForEntries<LayerEntriesOf<Entry>, IncludedFlows, ExcludedAliases>
  : Entry extends FlowImplementation<infer EntryFlow extends Flow>
    ? EntryFlow extends IncludedFlows
      ? SignalsForImplementation<Entry>
      : never
    : never

type HasSignalHandlers<Value> = [Value] extends [never]
  ? false
  : keyof Value extends never
    ? false
    : true

type SignalsForEntries<
  Entries extends LayerEntries,
  Included,
  ExcludedAliases extends PropertyKey
> = {
  readonly [Key in keyof Entries as Key extends ExcludedAliases
    ? never
    : HasSignalHandlers<EntrySignalHandlers<Entries[Key], Included, ExcludedAliases>> extends true
      ? Key
      : never]: EntrySignalHandlers<Entries[Key], Included, ExcludedAliases>
}

type LayerSignalTree<
  Layer extends Pick<AnyLayer, 'entries'>,
  F extends Flow,
  ExcludedAliases extends PropertyKey
> = SignalsForEntries<LayerEntriesOf<Layer>, SelectedGraphFlows<F>, ExcludedAliases>

export type LayerSignalHandlers<
  Layer extends Pick<AnyLayer, 'id' | 'entries'>,
  F extends Flow,
  ExcludedAliases extends PropertyKey = never
> = keyof LayerSignalTree<Layer, F, ExcludedAliases> extends never
  ? Record<never, never>
  : { readonly [Id in Layer['id']]: LayerSignalTree<Layer, F, ExcludedAliases> }

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
