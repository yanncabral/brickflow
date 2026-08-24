import type { Flow } from '../flow/contract'
import type {
  AnyFlowImplementation,
  DependenciesOf,
  EffectiveErrorsOf,
  EffectiveRequirementsOf,
  FlowImplementation,
  FlowRunOptions,
  ParamsOf,
  RequirementsOf,
  ResultOf,
  SignalsOf
} from '../flow/types'
import type { BoundarySignalHandlers, SignalDefinitions } from '../signal/types'
import type { FlowRun } from '../worker/types'

export type Providers = Readonly<Record<string, unknown>>

type ValidPathSegment<Value extends string> = Value extends `${string}.${string}` ? never : Value

type ValidatePathSegmentKeys<Entries extends LayerEntries> = {
  readonly [Key in keyof Entries]: Key extends string
    ? Key extends `${string}.${string}`
      ? never
      : Entries[Key]
    : Entries[Key]
}

export interface AnyLayer {
  readonly id: string
  readonly entries: Readonly<Record<string, unknown>>
  readonly providers: Readonly<Record<string, unknown>>
  provide?(values: Readonly<Record<string, unknown>>): AnyLayer
  override?(values: Readonly<Record<string, unknown>>): AnyLayer
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

type EffectiveRequirementUnion<
  Entries extends LayerEntries,
  Depth extends readonly unknown[] = []
> = {
  [Key in keyof Entries]: Entries[Key] extends FlowImplementation<infer F extends Flow>
    ? EffectiveRequirementsOf<F>
    : Entries[Key] extends { readonly entries: infer Nested extends LayerEntries }
      ? Depth['length'] extends 16
        ? Readonly<Record<string, never>>
        : EffectiveRequirementUnion<Nested, [...Depth, unknown]>
      : never
}[keyof Entries]

type EffectiveRequirementsFromEntries<Entries extends LayerEntries> = {
  readonly [Key in KeysOfUnion<EffectiveRequirementUnion<Entries>>]: ResolveRequirement<
    Key,
    EffectiveRequirementUnion<Entries>
  >
}

type FlowOfEntry<Entry> = Entry extends FlowImplementation<infer F extends Flow> ? F : never

type DirectFlowEntryForAlias<
  Entries extends LayerEntries,
  Alias extends PropertyKey,
  Path extends readonly PropertyKey[] = readonly []
> = Alias extends keyof Entries
  ? Entries[Alias] extends FlowImplementation<infer _F extends Flow>
    ? {
        readonly path: readonly [...Path, Alias]
        readonly implementation: Entries[Alias]
        readonly scope: Entries
      }
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
          readonly scope: Entries
        }
      : never
    : Entries[Key] extends {
          readonly id: infer Id extends PropertyKey
          readonly entries: infer Nested extends LayerEntries
        }
      ? FlattenedFlowEntryForAlias<Nested, Alias, readonly [...Path, Id]>
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
> = [Match] extends [never] ? never : true extends IsUnion<Match> ? never : Match

type ResolvedFlowEntry<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  Alias extends PropertyKey,
  Direct = DirectFlowEntryForAlias<ScopeEntries, Alias>
> = [Direct] extends [never] ? UniqueGlobalFlowEntryForAlias<RootEntries, Alias> : Direct

type ResolvedFlowEntryFromRoot<RootEntries extends LayerEntries, Alias extends PropertyKey> =
  DirectFlowEntryForAlias<RootEntries, Alias> extends infer Direct
    ? [Direct] extends [never]
      ? UniqueGlobalFlowEntryForAlias<RootEntries, Alias>
      : Direct
    : never

type ResolvedFlowEntryForSignals<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  Alias extends PropertyKey
> = ScopeEntries extends RootEntries
  ? ResolvedFlowEntry<RootEntries, ScopeEntries, Alias>
  : ResolvedFlowEntryFromRoot<RootEntries, Alias>

type OwnSignalHandlers<F extends Flow> =
  SignalsOf<F> extends SignalDefinitions
    ? keyof SignalsOf<F> extends never
      ? Record<never, never>
      : BoundarySignalHandlers<SignalsOf<F>>
    : Record<never, never>

type NamespacedSignalHandlers<
  Path extends readonly PropertyKey[],
  Handlers
> = keyof Handlers extends never
  ? Record<never, never>
  : Path extends readonly [
        infer Head extends PropertyKey,
        ...infer Tail extends readonly PropertyKey[]
      ]
    ? { readonly [Key in Head]: NamespacedSignalHandlers<Tail, Handlers> }
    : Handlers

type ResolvedSignalHandlers<
  RootEntries extends LayerEntries,
  Alias extends PropertyKey,
  Resolved,
  Depth extends readonly unknown[] = []
> = Resolved extends {
  readonly path: infer Path extends readonly PropertyKey[]
  readonly implementation: FlowImplementation<infer ResolvedFlow extends Flow>
  readonly scope: infer ResolvedScope extends LayerEntries
}
  ? NamespacedSignalHandlers<Path, OwnSignalHandlers<ResolvedFlow>> &
      OwnSelectedSignalHandlers<RootEntries, ResolvedScope, ResolvedFlow, Depth>
  : Resolved extends {
        readonly implementation: FlowImplementation<infer ResolvedFlow extends Flow>
        readonly scope: infer ResolvedScope extends LayerEntries
      }
    ? NamespacedSignalHandlers<readonly [Alias], OwnSignalHandlers<ResolvedFlow>> &
        OwnSelectedSignalHandlers<RootEntries, ResolvedScope, ResolvedFlow, Depth>
    : Record<never, never>

type OwnSelectedSignalHandlers<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow,
  Depth extends readonly unknown[] = []
> = Depth['length'] extends 16
  ? keyof DependenciesOf<F> extends never
    ? Record<never, never>
    : never
  : UnionToIntersection<
      {
        readonly [Alias in keyof DependenciesOf<F>]: ResolvedFlowEntryForSignals<
          RootEntries,
          ScopeEntries,
          Alias
        > extends infer Resolved
          ? ResolvedSignalHandlers<RootEntries, Alias, Resolved, [...Depth, unknown]>
          : Record<never, never>
      }[keyof DependenciesOf<F>]
    >

type HasIncompatibleDependencyAlias<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow
> = true extends {
  readonly [Alias in keyof DependenciesOf<F>]: [
    ResolvedFlowEntry<RootEntries, ScopeEntries, Alias>
  ] extends [never]
    ? false
    : ResolvedFlowEntry<RootEntries, ScopeEntries, Alias> extends {
          readonly implementation: infer Implementation
        }
      ? FlowOfEntry<Implementation> extends DependenciesOf<F>[Alias]
        ? false
        : true
      : false
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

type ProviderUnion<Entries extends LayerEntries> = {
  readonly [Key in keyof Entries]: Entries[Key] extends Layer<
    string,
    infer NestedEntries,
    infer NestedProvided
  >
    ? EffectiveLayerProviders<NestedEntries, NestedProvided>
    : Record<never, never>
}[keyof Entries]

type UnionToIntersection<Value> = (Value extends Value ? (value: Value) => void : never) extends (
  value: infer Intersection
) => void
  ? Intersection
  : never

export type EffectiveLayerProviders<
  Entries extends LayerEntries,
  Provided extends Providers
> = Provided & Omit<UnionToIntersection<ProviderUnion<Entries>>, keyof Provided>

type ExactKeys<Values, Allowed> = Values & Record<Exclude<keyof Values, keyof Allowed>, never>

type ProvideValues<Entries extends LayerEntries, Provided extends Providers> = Partial<
  Omit<EffectiveRequirementsFromEntries<Entries>, keyof EffectiveLayerProviders<Entries, Provided>>
>

type OverrideValues<Entries extends LayerEntries, Provided extends Providers> = Partial<
  Pick<
    EffectiveRequirementsFromEntries<Entries>,
    keyof EffectiveLayerProviders<Entries, Provided> &
      keyof EffectiveRequirementsFromEntries<Entries>
  >
>

type DependencyFlow<Value> = Value extends Flow ? Value : never

type SuppliedDependencyNode<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow,
  Depth extends readonly unknown[]
> = {
  readonly flow: FlowImplementation<F>
} & (keyof ScopedUnresolvedDependencies<RootEntries, ScopeEntries, F, Depth> extends never
  ? { readonly dependencies?: never }
  : {
      readonly dependencies: ScopedUnresolvedDependencies<RootEntries, ScopeEntries, F, Depth>
    })

type UnresolvedDirectDependency<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow,
  Alias extends keyof DependenciesOf<F>,
  Depth extends readonly unknown[]
> = {
  readonly [Key in Alias]: SuppliedDependencyNode<
    RootEntries,
    ScopeEntries,
    DependencyFlow<DependenciesOf<F>[Alias]>,
    [...Depth, unknown]
  >
}

type UnresolvedDependencyBranch<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow,
  Alias extends keyof DependenciesOf<F>,
  Depth extends readonly unknown[]
> =
  ResolvedFlowEntry<RootEntries, ScopeEntries, Alias> extends infer Resolved
    ? [Resolved] extends [never]
      ? UnresolvedDirectDependency<RootEntries, ScopeEntries, F, Alias, Depth>
      : Resolved extends {
            readonly implementation: FlowImplementation<infer ResolvedFlow extends Flow>
            readonly scope: infer ResolvedScope extends LayerEntries
          }
        ? ScopedUnresolvedDependencies<
            RootEntries,
            ResolvedScope,
            ResolvedFlow,
            [...Depth, unknown]
          > extends infer Children
          ? keyof Children extends never
            ? Record<never, never>
            : string extends keyof Children
              ? Children
              : { readonly [Key in Alias]: { readonly dependencies: Children } }
          : Record<never, never>
        : UnresolvedDirectDependency<RootEntries, ScopeEntries, F, Alias, Depth>
    : UnresolvedDirectDependency<RootEntries, ScopeEntries, F, Alias, Depth>

type ScopedUnresolvedDependencies<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow,
  Depth extends readonly unknown[] = []
> = Depth['length'] extends 16
  ? {
      readonly [Alias in keyof DependenciesOf<F>]: {
        readonly flow: AnyFlowImplementation
        readonly dependencies: Readonly<Record<string, unknown>>
      }
    }
  : UnionToIntersection<
      {
        readonly [Alias in keyof DependenciesOf<F>]: UnresolvedDependencyBranch<
          RootEntries,
          ScopeEntries,
          F,
          Alias,
          Depth
        >
      }[keyof DependenciesOf<F>]
    >

type UnresolvedDependencies<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow
> = ScopedUnresolvedDependencies<RootEntries, ScopeEntries, F>

type SuppliedNodeSignalHandlers<Node> = Node extends {
  readonly flow: FlowImplementation<infer F extends Flow>
  readonly dependencies?: infer Dependencies
}
  ? OwnSignalHandlers<F> & SuppliedDependencySignalHandlers<Dependencies>
  : Node extends { readonly dependencies: infer Dependencies }
    ? SuppliedDependencySignalHandlers<Dependencies>
    : Record<never, never>

type LayerSignalHandlersForDependencies<
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  F extends Flow,
  Deps
> = UnionToIntersection<
  {
    readonly [Alias in keyof DependenciesOf<F>]: Alias extends keyof Deps
      ? Deps[Alias] extends {
          readonly flow: FlowImplementation<infer SuppliedFlow extends Flow>
        }
        ? LayerSignalHandlersForDependencies<
            RootEntries,
            ScopeEntries,
            SuppliedFlow,
            Deps[Alias] extends { readonly dependencies: infer SuppliedDependencies }
              ? SuppliedDependencies
              : Record<never, never>
          >
        : ResolvedSignalHandlers<
            RootEntries,
            Alias,
            ResolvedFlowEntry<RootEntries, ScopeEntries, Alias>
          >
      : ResolvedSignalHandlers<
            RootEntries,
            Alias,
            ResolvedFlowEntry<RootEntries, ScopeEntries, Alias>
          > extends infer Handlers
        ? Handlers
        : Record<never, never>
  }[keyof DependenciesOf<F>]
>

type SuppliedDependencySignalHandlers<Deps> = string extends keyof Deps
  ? Record<never, never>
  : {
      readonly [Alias in keyof Deps as keyof SuppliedNodeSignalHandlers<Deps[Alias]> extends never
        ? never
        : Alias]: SuppliedNodeSignalHandlers<Deps[Alias]>
    }

type BoundFlowRunOptions<
  F extends Flow,
  RootId extends string,
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  Provided extends Providers,
  FlowPath extends readonly PropertyKey[]
> = Omit<FlowRunOptions<F>, 'requirements' | 'dependencies' | 'signals'> &
  (keyof Omit<EffectiveRequirementsOf<F>, keyof Provided> extends never
    ? { readonly requirements?: never }
    : { readonly requirements: Omit<EffectiveRequirementsOf<F>, keyof Provided> }) &
  (keyof UnresolvedDependencies<RootEntries, ScopeEntries, F> extends never
    ? { readonly dependencies?: never }
    : { readonly dependencies: UnresolvedDependencies<RootEntries, ScopeEntries, F> }) &
  (keyof (OwnSignalHandlers<F> &
    LayerSignalHandlersForDependencies<
      RootEntries,
      ScopeEntries,
      F,
      UnresolvedDependencies<RootEntries, ScopeEntries, F>
    > &
    SuppliedDependencySignalHandlers<
      UnresolvedDependencies<RootEntries, ScopeEntries, F>
    >) extends never
    ? { readonly signals?: never }
    : {
        readonly signals: NamespacedSignalHandlers<FlowPath, OwnSignalHandlers<F>> &
          NamespacedSignalHandlers<
            readonly [RootId],
            LayerSignalHandlersForDependencies<
              RootEntries,
              ScopeEntries,
              F,
              UnresolvedDependencies<RootEntries, ScopeEntries, F>
            >
          > &
          SuppliedDependencySignalHandlers<UnresolvedDependencies<RootEntries, ScopeEntries, F>>
      })

type BoundFlowRunOptionArgs<
  F extends Flow,
  RootId extends string,
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  Provided extends Providers,
  FlowPath extends readonly PropertyKey[]
> = keyof Omit<EffectiveRequirementsOf<F>, keyof Provided> extends never
  ? keyof UnresolvedDependencies<RootEntries, ScopeEntries, F> extends never
    ? keyof (OwnSignalHandlers<F> &
        LayerSignalHandlersForDependencies<
          RootEntries,
          ScopeEntries,
          F,
          UnresolvedDependencies<RootEntries, ScopeEntries, F>
        > &
        SuppliedDependencySignalHandlers<
          UnresolvedDependencies<RootEntries, ScopeEntries, F>
        >) extends never
      ? readonly [
          options?: BoundFlowRunOptions<F, RootId, RootEntries, ScopeEntries, Provided, FlowPath>
        ]
      : readonly [
          options: BoundFlowRunOptions<F, RootId, RootEntries, ScopeEntries, Provided, FlowPath>
        ]
    : readonly [
        options: BoundFlowRunOptions<F, RootId, RootEntries, ScopeEntries, Provided, FlowPath>
      ]
  : readonly [
      options: BoundFlowRunOptions<F, RootId, RootEntries, ScopeEntries, Provided, FlowPath>
    ]

export type BoundFlow<
  F extends Flow,
  RootId extends string,
  RootEntries extends LayerEntries,
  ScopeEntries extends LayerEntries,
  Provided extends Providers,
  FlowPath extends readonly PropertyKey[]
> = {
  readonly handler: FlowImplementation<F>['handler']
  run(
    params: ParamsOf<F>,
    ...options: BoundFlowRunOptionArgs<F, RootId, RootEntries, ScopeEntries, Provided, FlowPath>
  ): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>>
}

type BoundEntries<
  RootId extends string,
  RootEntries extends LayerEntries,
  Entries extends LayerEntries,
  EffectiveProvided extends Providers,
  LayerPath extends readonly PropertyKey[]
> = {
  readonly [Key in keyof Entries]: Entries[Key] extends FlowImplementation<infer F extends Flow>
    ? BoundFlow<F, RootId, RootEntries, Entries, EffectiveProvided, readonly [...LayerPath, Key]>
    : Entries[Key] extends Layer<infer Id, infer Nested, infer NestedProvided>
      ? BoundLayer<
          Id,
          Nested,
          NestedProvided,
          RootEntries,
          RootId,
          EffectiveProvided,
          readonly [...LayerPath, Id]
        >
      : never
}

export type BoundLayer<
  Id extends string,
  Entries extends LayerEntries,
  Provided extends Providers,
  RootEntries extends LayerEntries = Entries,
  RootId extends string = Id,
  EffectiveProvided extends Providers = EffectiveLayerProviders<Entries, Provided>,
  LayerPath extends readonly PropertyKey[] = readonly [Id]
> = LayerState<Id, Entries, Provided> &
  BoundEntries<RootId, RootEntries, Entries, EffectiveProvided, LayerPath>

export interface LayerState<
  Id extends string = string,
  Entries extends LayerEntries = LayerEntries,
  Provided extends Providers = Providers
> {
  readonly id: Id
  readonly entries: Readonly<Entries>
  readonly providers: Readonly<Provided>
  provide<const Values extends ProvideValues<Entries, Provided>>(
    values: ExactKeys<Values, ProvideValues<Entries, Provided>>
  ): BoundLayer<Id, Entries, Provided & Values>
  override<const Values extends OverrideValues<Entries, Provided>>(
    values: ExactKeys<Values, OverrideValues<Entries, Provided>>
  ): BoundLayer<Id, Entries, Omit<Provided, keyof Values> & Values>
}

export type Layer<
  Id extends string = string,
  Entries extends LayerEntries = LayerEntries,
  Provided extends Providers = Record<never, never>
> = BoundLayer<Id, Entries, Provided>

export interface LayerConstructor {
  new <const Id extends string, const Entries extends LayerEntries>(
    id: Id & ValidPathSegment<Id>,
    entries: Entries &
      ValidateDependencyAliases<Entries> &
      ValidatePathSegmentKeys<Entries> &
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
export type LayerUnprovidedRequirementsOf<Value> = Value extends {
  readonly entries: infer Entries extends LayerEntries
  readonly providers: infer Provided extends Providers
}
  ? Omit<
      EffectiveRequirementsFromEntries<Entries>,
      keyof EffectiveLayerProviders<Entries, Provided>
    >
  : never

export interface FlattenedLayerEntry {
  readonly id: string
  readonly key: string
  readonly layerPath: readonly string[]
  // biome-ignore lint/suspicious/noExplicitAny: flattened entries retain heterogeneous Flow implementations
  readonly implementation: FlowImplementation<any>
}
