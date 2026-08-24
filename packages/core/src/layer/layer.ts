import { isFlowImplementation, markFlowImplementation } from '../flow/implementation'
import type { FlowImplementation } from '../flow/types'
import { executeFlow } from '../worker/execution'
import {
  effectiveLayerProviders,
  findLayerDependency,
  flattenLayer,
  isLayer,
  LayerRuntime
} from './composition'
import { addProviders, overrideProviders } from './provide'
import type {
  AnyLayer,
  FlattenedLayerEntry,
  LayerConstructor,
  LayerEntries,
  Providers,
  ReservedLayerEntryName
} from './types'

function flowIdentity(value: FlowImplementation): FlowImplementation {
  return value
}

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
        value: this.bindEntry(entry, key),
        writable: false
      })
    }

    flattenLayer(this)
    Object.freeze(this)
  }

  private bindEntry(entry: unknown, key: string): unknown {
    if (isFlowImplementation(entry)) return this.bindFlow(entry, key, `${this.id}.${key}`)
    if (isLayer(entry)) return this.bindNestedLayer(entry, `${this.id}.${entry.id}`)
    return entry
  }

  private bindFlow(entry: ReturnType<typeof flowIdentity>, key: string, targetId: string): unknown {
    const layer = this
    const bound = {
      handler: entry.handler,
      run(
        params: unknown,
        options?: {
          readonly requirements?: Readonly<Record<string, unknown>>
          readonly dependencies?: Readonly<Record<string, FlowImplementation>>
          readonly signals?: Readonly<Record<string, unknown>>
          readonly worker?: unknown
          readonly id?: string
          readonly metadata?: Readonly<Record<string, unknown>>
        }
      ) {
        const entries = flattenLayer(layer)
        const root = entries.find((candidate) => candidate.id === targetId) as
          | FlattenedLayerEntry
          | undefined
        if (!root) throw new Error(`Bound Flow entry not found: ${key}`)
        const suppliedDependencies = Object.entries(options?.dependencies ?? {}).map(
          ([dependencyKey, implementation]) =>
            Object.freeze({
              id: dependencyKey,
              key: dependencyKey,
              implementation,
              layerPath: Object.freeze([]) as readonly string[]
            })
        ) as readonly FlattenedLayerEntry[]
        return executeFlow({
          root,
          entries: [...entries, ...suppliedDependencies],
          params,
          providers: Object.freeze({
            ...effectiveLayerProviders(layer),
            ...((options?.requirements as Readonly<Record<string, unknown>> | undefined) ?? {})
          }),
          resolveDependency: (caller, alias) => {
            const callerLayerPath = (caller as FlattenedLayerEntry).layerPath
            const supplied = suppliedDependencies.find((candidate) => candidate.key === alias)
            const scopedSupplied =
              supplied && Array.isArray(callerLayerPath)
                ? Object.freeze({
                    ...supplied,
                    layerPath: Object.freeze([...callerLayerPath])
                  })
                : supplied
            if (Array.isArray(callerLayerPath) && callerLayerPath.length > 0) {
              const layerEntry = findLayerDependency(
                layer,
                caller as FlattenedLayerEntry,
                alias,
                scopedSupplied
              )
              if (layerEntry) return layerEntry
            }
            if (scopedSupplied) return scopedSupplied
            throw new Error(`Missing dependency Flow entry "${alias}" in the configured Layer`)
          },
          ...(options?.signals
            ? { signals: options.signals as Readonly<Record<string, unknown>> }
            : {}),
          ...(options?.worker ? { worker: options.worker as never } : {}),
          ...(typeof options?.id === 'string' ? { id: options.id } : {}),
          ...(options?.metadata
            ? { metadata: options.metadata as Readonly<Record<string, unknown>> }
            : {})
        })
      }
    }
    markFlowImplementation(bound)
    return Object.freeze(bound)
  }

  private bindNestedLayer(nested: AnyLayer, pathPrefix: string): AnyLayer {
    const view = Object.create(Object.getPrototypeOf(nested)) as Record<string, unknown>
    Object.defineProperties(view, {
      id: { enumerable: true, value: nested.id },
      entries: { enumerable: false, value: nested.entries },
      providers: { enumerable: false, value: nested.providers },
      provide: { value: nested.provide?.bind(nested) },
      override: { value: nested.override?.bind(nested) }
    })
    for (const [key, entry] of Object.entries(nested.entries)) {
      Object.defineProperty(view, key, {
        enumerable: true,
        value: isFlowImplementation(entry)
          ? this.bindFlow(entry, key, `${pathPrefix}.${key}`)
          : isLayer(entry)
            ? this.bindNestedLayer(entry, `${pathPrefix}.${entry.id}`)
            : entry
      })
    }
    return Object.freeze(view) as unknown as AnyLayer
  }

  provide(values: Readonly<Record<string, unknown>>): AnyLayer {
    return new LayerImplementation(this.id, this.entries, addProviders(this.providers, values))
  }

  override(values: Readonly<Record<string, unknown>>): AnyLayer {
    return new LayerImplementation(this.id, this.entries, overrideProviders(this.providers, values))
  }
}

export const Layer = LayerImplementation as unknown as LayerConstructor
