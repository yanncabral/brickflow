import type { Brick } from '../brick/contract'
import type { BrickImplementation, DependenciesOf, SignalsOf } from '../brick/types'
import type { EngineStatus } from '../engine/types'
import type { AnyLayer, LayerEntries, LayerEntriesOf } from '../layer/types'
import type {
  MatchedError,
  RecoveryValue,
  RemainingErrors,
  SupportedPattern
} from '../matching/types'
import type { BoundarySignalHandlers, SignalDefinitions } from '../signal/types'

export type RunMetadata = Readonly<Record<string, unknown>>

type DependencyBricks<F extends Brick, Depth extends readonly unknown[] = []> =
  | F
  | (Depth['length'] extends 16
      ? never
      : F extends { readonly depends: infer Dependencies extends object }
        ? {
            [Key in keyof Dependencies]: Dependencies[Key] extends Brick
              ? DependencyBricks<Dependencies[Key], [...Depth, unknown]>
              : never
          }[keyof Dependencies]
        : never)

type DependencyBrick<Value> = Value extends Brick ? Value : never

type DirectDependencyBricks<F extends Brick> = {
  [Alias in keyof DependenciesOf<F>]: DependencyBrick<DependenciesOf<F>[Alias]>
}[keyof DependenciesOf<F>]

type SelectedGraphBricks<F extends Brick> =
  | F
  | Exclude<DependencyBricks<F>, F | DirectDependencyBricks<F>>

type SignalsForImplementation<Implementation> =
  Implementation extends BrickImplementation<infer F extends Brick>
    ? SignalsOf<F> extends SignalDefinitions
      ? keyof SignalsOf<F> extends never
        ? never
        : BoundarySignalHandlers<SignalsOf<F>>
      : never
    : never

type EntrySignalHandlers<
  Entry,
  IncludedBricks,
  ExcludedAliases extends PropertyKey
> = Entry extends AnyLayer
  ? SignalsForEntries<LayerEntriesOf<Entry>, IncludedBricks, ExcludedAliases>
  : Entry extends BrickImplementation<infer EntryBrick extends Brick>
    ? EntryBrick extends IncludedBricks
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
  F extends Brick,
  ExcludedAliases extends PropertyKey
> = SignalsForEntries<LayerEntriesOf<Layer>, SelectedGraphBricks<F>, ExcludedAliases>

export type LayerSignalHandlers<
  Layer extends Pick<AnyLayer, 'id' | 'entries'>,
  F extends Brick,
  ExcludedAliases extends PropertyKey = never
> = keyof LayerSignalTree<Layer, F, ExcludedAliases> extends never
  ? Record<never, never>
  : { readonly [Id in Layer['id']]: LayerSignalTree<Layer, F, ExcludedAliases> }

export interface BrickRunControls {
  readonly id: string
  status(): Promise<EngineStatus>
  cancel(reason?: string): Promise<void>
}

export interface IncompleteBrickRun<
  Error,
  InitialSuccess,
  LocalResult = InitialSuccess,
  RemainingError = Error
> extends BrickRunControls {
  readonly unhandledErrors: RemainingError
  readonly then: (invalidOnFulfilled: never) => never
  with<const Pattern extends SupportedPattern<RemainingError>, HandlerResult>(
    pattern: Pattern extends readonly unknown[] ? never : Pattern,
    handler: (
      error: MatchedError<RemainingError, Pattern>
    ) => HandlerResult | Promise<HandlerResult>
  ): BrickRun<
    Error,
    InitialSuccess,
    LocalResult | RecoveryValue<HandlerResult>,
    RemainingErrors<RemainingError, Pattern, HandlerResult>
  >
}

export interface CompleteBrickRun<Error, InitialSuccess, LocalResult = InitialSuccess>
  extends BrickRunControls,
    PromiseLike<LocalResult> {
  with<const Pattern extends SupportedPattern<never>, HandlerResult>(
    pattern: Pattern extends readonly unknown[] ? never : Pattern,
    handler: (error: MatchedError<never, Pattern>) => HandlerResult | Promise<HandlerResult>
  ): BrickRun<Error, InitialSuccess, LocalResult | RecoveryValue<HandlerResult>, never>
}

export type BrickRun<
  Error,
  InitialSuccess,
  LocalResult = InitialSuccess,
  RemainingError = Error
> = [RemainingError] extends [never]
  ? CompleteBrickRun<Error, InitialSuccess, LocalResult>
  : IncompleteBrickRun<Error, InitialSuccess, LocalResult, RemainingError>
