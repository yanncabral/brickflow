import { isFlowImplementation } from '../flow/implementation'
import { flattenLayer, isLayer, LayerRuntime } from './composition'
import { addProviders, overrideProviders } from './provide'
import type {
  AnyLayer,
  LayerConstructor,
  LayerEntries,
  Providers,
  ReservedLayerEntryName
} from './types'

const reservedNames: ReadonlySet<ReservedLayerEntryName> = new Set([
  'id',
  'entries',
  'providers',
  'provide',
  'override'
])

class LayerImplementation<
  Id extends string,
  Entries extends LayerEntries,
  Provided extends Providers
> extends LayerRuntime {
  readonly id: Id
  readonly entries: Readonly<Entries>
  readonly providers: Readonly<Provided>

  constructor(id: Id, entries: Entries, providers?: Provided) {
    super()
    if (id.length === 0) throw new Error('Layer ID must not be empty')

    for (const [key, entry] of Object.entries(entries)) {
      if (reservedNames.has(key as ReservedLayerEntryName)) {
        throw new Error(`Reserved Layer entry name: ${key}`)
      }
      if (!isFlowImplementation(entry) && !isLayer(entry)) {
        throw new Error(`Invalid Layer entry value for key: ${key}`)
      }
    }

    this.id = id
    this.entries = Object.freeze({ ...entries })
    this.providers = Object.freeze({ ...(providers ?? {}) }) as Readonly<Provided>

    for (const [key, entry] of Object.entries(this.entries)) {
      Object.defineProperty(this, key, {
        configurable: false,
        enumerable: true,
        value: entry,
        writable: false
      })
    }

    flattenLayer(this)
    Object.freeze(this)
  }

  provide(values: Readonly<Record<string, unknown>>): AnyLayer {
    return new LayerImplementation(this.id, this.entries, addProviders(this.providers, values))
  }

  override(values: Readonly<Record<string, unknown>>): AnyLayer {
    return new LayerImplementation(this.id, this.entries, overrideProviders(this.providers, values))
  }
}

export const Layer = LayerImplementation as unknown as LayerConstructor
