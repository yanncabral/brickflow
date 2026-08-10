import type { FlowImplementation, FlowSpec, RequirementsOf } from '../flow/types'

export type Providers = Readonly<Record<string, unknown>>
export interface AnyLayer {
  readonly id: string
  readonly entries: Readonly<Record<string, unknown>>
  readonly providers: Readonly<Record<string, unknown>>
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
  Entry extends FlowImplementation<infer Spec extends FlowSpec>
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
  ): Layer<Id, Entries, Provided & Values>
  override<
    const Values extends Partial<
      Pick<
        RequirementsFromEntries<Entries>,
        keyof Provided & keyof RequirementsFromEntries<Entries>
      >
    >
  >(values: Values): Layer<Id, Entries, Omit<Provided, keyof Values> & Values>
}

export type Layer<
  Id extends string = string,
  Entries extends LayerEntries = LayerEntries,
  Provided extends Providers = Record<never, never>
> = LayerState<Id, Entries, Provided> & Readonly<Entries>

export interface LayerConstructor {
  new <const Id extends string, const Entries extends LayerEntries>(
    id: Id,
    entries: Entries & Record<Extract<keyof Entries, ReservedLayerEntryName>, never>
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
  // biome-ignore lint/suspicious/noExplicitAny: flattened entries retain heterogeneous Flow implementations
  readonly implementation: FlowImplementation<any>
}
