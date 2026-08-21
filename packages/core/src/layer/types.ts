import type { Flow } from '../flow/contract'
import type {
  DependenciesOf,
  EffectiveDependenciesOf,
  EffectiveErrorsOf,
  EffectiveRequirementsOf,
  EffectiveSignalsOf,
  FlowImplementation,
  FlowRunOptions,
  ParamsOf,
  RequirementsOf,
  ResultOf
} from '../flow/types'
import type { FlowRun, LayerSignalHandlers } from '../worker/types'

export type Providers = Readonly<Record<string, unknown>>
export interface AnyLayer {
  readonly id: string
  readonly entries: Readonly<Record<string, unknown>>
  readonly providers: Readonly<Record<string, unknown>>
  readonly provide?: (values: Readonly<Record<string, unknown>>) => AnyLayer
  readonly override?: (values: Readonly<Record<string, unknown>>) => AnyLayer
}

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous Flow implementations are intentionally erased at Layer boundaries
export type LayerEntry = FlowImplementation<any> | AnyLayer
export type LayerEntries = Readonly<Record<string, LayerEntry>>

export declare const requirementConflictBrand: unique symbol

export type RequirementConflict<Key extends PropertyKey, Left = unknown, Right = unknown> = {
  readonly [requirementConflictBrand]: Key
  readonly left: Left
  readonly right: Right
}

type EntryRequirements<Entry> =
  Entry extends FlowImplementation<infer Spec extends Flow>
    ? RequirementsOf<Spec>
    : Entry extends { readonly entries: infer Entries extends LayerEntries }
      ? RequirementsFromEntries<Entries>
      : Record<never, never>

type RequirementUnion<Entries extends LayerEntries> = EntryRequirements<Entries[keyof Entries]>
type KeysOfUnion<Value> = Value extends Value ? keyof Value : never
type ValuesForKey<Value, Key extends PropertyKey> = Value extends Value
  ? Key extends keyof Value
    ? Value[Key]
    : never
  : never

type RequirementsWithKey<Value, Key extends PropertyKey> = Value extends Value
  ? Key extends keyof Value
    ? Value
    : never
  : never

type AreMutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? false
    : true
  : true

type HasIncompatibleRequirement<
  Requirements,
  Key extends PropertyKey,
  Left = RequirementsWithKey<Requirements, Key>,
  Right = RequirementsWithKey<Requirements, Key>
> =
  Left extends Record<Key, unknown>
    ? Right extends Record<Key, unknown>
      ? AreMutuallyAssignable<Left[Key], Right[Key]>
      : never
    : never

type ResolveRequirement<Key extends PropertyKey, Requirements> =
  true extends HasIncompatibleRequirement<Requirements, Key>
    ? RequirementConflict<Key, ValuesForKey<Requirements, Key>, ValuesForKey<Requirements, Key>>
    : ValuesForKey<Requirements, Key>

type RequirementsFromEntries<Entries extends LayerEntries> = {
  readonly [Key in KeysOfUnion<RequirementUnion<Entries>>]: ResolveRequirement<
    Key,
    RequirementUnion<Entries>
  >
}

type FlowOfEntry<Entry> = Entry extends FlowImplementation<infer F extends Flow> ? F : never

type DirectFlowEntryForAlias<
  Entries extends LayerEntries,
  Alias extends PropertyKey
> = Alias extends keyof Entries
  ? Entries[Alias] extends FlowImplementation<infer _F extends Flow>
    ? Entries[Alias]
    : never
  : never

type FlattenedFlowEntryForAlias<
  Entries extends LayerEntries,
  Alias extends PropertyKey,
  Path extends readonly PropertyKey[] = readonly []
> = {
  [Key in keyof Entries]: Entries[Key] extends FlowImplementation<infer _F extends Flow>
    ? Key extends Alias
      ? {
          readonly path: readonly [...Path, Key]
          readonly implementation: Entries[Key]
        }
      : never
    : Entries[Key] extends { readonly entries: infer Nested extends LayerEntries }
      ? FlattenedFlowEntryForAlias<Nested, Alias, readonly [...Path, Key]>
      : never
}[keyof Entries]

type IsUnion<Value, Whole = Value> = Value extends Value
  ? [Whole] extends [Value]
    ? false
    : true
  : never

type UniqueGlobalFlowEntryForAlias<
  RootEntries extends LayerEntries,
  Alias extends PropertyKey,
  Match = FlattenedFlowEntryForAlias<RootEntries, Alias>
> = [Match] extends [never]
  ? never
  : true extends IsUnion<Match>
    ? never
    : Match extends { readonly implementation: infer Entry }
      ? Entry
      : never

type ResolvedFlowEntry<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  Alias extends PropertyKey,
  Direct = DirectFlowEntryForAlias<ScopeEntries, Alias>
> = [Direct] extends [never] ? UniqueGlobalFlowEntryForAlias<RootEntries, Alias> : Direct

type HasIncompatibleDependencyAlias<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow
> = true extends {
  readonly [Alias in keyof DependenciesOf<F>]: [
    ResolvedFlowEntry<RootEntries, ScopeEntries, Alias>
  ] extends [never]
    ? false
    : FlowOfEntry<
          ResolvedFlowEntry<RootEntries, ScopeEntries, Alias>
        > extends DependenciesOf<F>[Alias]
      ? false
      : true
}[keyof DependenciesOf<F>]
  ? true
  : false

type ValidateDependencyAliases<
  RootEntries extends LayerEntries,
  Entries extends LayerEntries = RootEntries
> = {
  readonly [Key in keyof Entries]: Entries[Key] extends FlowImplementation<infer F extends Flow>
    ? HasIncompatibleDependencyAlias<RootEntries, Entries, F> extends true
      ? never
      : Entries[Key]
    : Entries[Key] extends { readonly entries: infer Nested extends LayerEntries }
      ? Entries[Key] & { readonly entries: ValidateDependencyAliases<RootEntries, Nested> }
      : Entries[Key]
}

type BoundFlowRunOptions<F extends Flow, Provided extends Providers> = Omit<
  FlowRunOptions<F>,
  'requirements' | 'dependencies' | 'signals'
> &
  (keyof Omit<EffectiveRequirementsOf<F>, keyof Provided> extends never
    ? { readonly requirements?: never }
    : { readonly requirements: Omit<EffectiveRequirementsOf<F>, keyof Provided> }) &
  (keyof EffectiveDependenciesOf<F> extends never
    ? { readonly dependencies?: never }
    : Record<never, never>) &
  (keyof EffectiveSignalsOf<F> extends never
    ? { readonly signals?: never }
    : { readonly signals: LayerSignalHandlers<LayerState<string, LayerEntries, Provided>, F> })

type BoundFlowRunOptionArgs<F extends Flow, Provided extends Providers> = keyof Omit<
  EffectiveRequirementsOf<F>,
  keyof Provided
> extends never
  ? keyof EffectiveSignalsOf<F> extends never
    ? readonly [options?: BoundFlowRunOptions<F, Provided>]
    : readonly [options: BoundFlowRunOptions<F, Provided>]
  : readonly [options: BoundFlowRunOptions<F, Provided>]

export type BoundFlow<F extends Flow, Provided extends Providers> = FlowImplementation<F> & {
  run(
    params: ParamsOf<F>,
    ...options: BoundFlowRunOptionArgs<F, Provided>
  ): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>>
}

type BoundEntries<Entries extends LayerEntries, Provided extends Providers> = {
  readonly [Key in keyof Entries]: Entries[Key] extends FlowImplementation<infer F extends Flow>
    ? BoundFlow<F, Provided>
    : Entries[Key] extends Layer<infer Id, infer Nested, infer NestedProvided>
      ? BoundLayer<Id, Nested, Provided & NestedProvided>
      : never
}

export type BoundLayer<
  Id extends string,
  Entries extends LayerEntries,
  Provided extends Providers
> = LayerState<Id, Entries, Provided> & BoundEntries<Entries, Provided>

export interface LayerState<
  Id extends string = string,
  Entries extends LayerEntries = LayerEntries,
  Provided extends Providers = Providers
> {
  readonly id: Id
  readonly entries: Readonly<Entries>
  readonly providers: Readonly<Provided>
  provide<const Values extends Partial<Omit<RequirementsFromEntries<Entries>, keyof Provided>>>(
    values: Values
  ): BoundLayer<Id, Entries, Provided & Values>
  override<
    const Values extends Partial<
      Pick<
        RequirementsFromEntries<Entries>,
        keyof Provided & keyof RequirementsFromEntries<Entries>
      >
    >
  >(values: Values): BoundLayer<Id, Entries, Omit<Provided, keyof Values> & Values>
}

export type Layer<
  Id extends string = string,
  Entries extends LayerEntries = LayerEntries,
  Provided extends Providers = Record<never, never>
> = BoundLayer<Id, Entries, Provided>

export interface LayerConstructor {
  new <const Id extends string, const Entries extends LayerEntries>(
    id: Id,
    entries: Entries &
      ValidateDependencyAliases<Entries> &
      Record<Extract<keyof Entries, ReservedLayerEntryName>, never>
  ): Layer<Id, Entries>
}

export type ReservedLayerEntryName = 'id' | 'entries' | 'providers' | 'provide' | 'override'

export type LayerEntriesOf<Value> = Value extends {
  readonly entries: infer Entries extends LayerEntries
}
  ? Entries
  : never
export type LayerProvidersOf<Value> = Value extends {
  readonly providers: infer Provided extends Providers
}
  ? Provided
  : never
export type LayerRequirementsOf<Value> = Value extends {
  readonly entries: infer Entries extends LayerEntries
}
  ? RequirementsFromEntries<Entries>
  : never
export type LayerUnprovidedRequirementsOf<Value> = Omit<
  LayerRequirementsOf<Value>,
  keyof LayerProvidersOf<Value>
>

export interface FlattenedLayerEntry {
  readonly id: string
  readonly key: string
  readonly layerPath: readonly string[]
  // biome-ignore lint/suspicious/noExplicitAny: flattened entries retain heterogeneous Flow implementations
  readonly implementation: FlowImplementation<any>
}
