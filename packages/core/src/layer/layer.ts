import { isBrickImplementation, markBrickImplementation } from '../brick/implementation'
import type { BrickImplementation } from '../brick/types'
import { assertValidPathSegment } from '../path-segment'
import type { BrickPlugin } from '../plugin/types'
import { executeBrick, type SuppliedDependencyNode } from '../worker/execution'
import {
  effectiveLayerProviders,
  findLayerDependency,
  flattenLayer,
  isLayer,
  LayerRuntime
} from './composition'
import { addProviders } from './provide'
import type {
  AnyLayer,
  FlattenedLayerEntry,
  LayerConstructor,
  LayerEntries,
  Providers,
  ReservedLayerEntryName
} from './types'

function brickIdentity(value: BrickImplementation): BrickImplementation {
  return value
}

function hasProviderKey(layer: AnyLayer, key: string): boolean {
  if (Object.hasOwn(layer.providers, key)) return true
  return Object.values(layer.entries).some((entry) => isLayer(entry) && hasProviderKey(entry, key))
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
    assertValidPathSegment(id)

    for (const [key, entry] of Object.entries(entries)) {
      assertValidPathSegment(key)
      if (reservedNames.has(key as ReservedLayerEntryName)) {
        throw new Error(`Reserved Layer entry name: ${key}`)
      }
      if (!isBrickImplementation(entry) && !isLayer(entry)) {
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
    if (isBrickImplementation(entry)) return this.bindBrick(entry, key, `${this.id}.${key}`)
    if (isLayer(entry)) return this.bindNestedLayer(entry, `${this.id}.${entry.id}`)
    return entry
  }

  private bindBrick(
    entry: ReturnType<typeof brickIdentity>,
    key: string,
    targetId: string
  ): unknown {
    const layer = this
    const bound = {
      handler: entry.handler,
      ...(entry.plugins ? { plugins: entry.plugins } : {}),
      run(
        params: unknown,
        options?: {
          readonly requirements?: Readonly<Record<string, unknown>>
          readonly dependencies?: Readonly<Record<string, SuppliedDependencyNode>>
          readonly signals?: Readonly<Record<string, unknown>>
          readonly worker?: unknown
          readonly id?: string
          readonly metadata?: Readonly<Record<string, unknown>>
          readonly plugins?: readonly BrickPlugin[]
          readonly isReplay?: boolean
        }
      ) {
        const entries = flattenLayer(layer)
        const root = entries.find((candidate) => candidate.id === targetId) as
          | FlattenedLayerEntry
          | undefined
        if (!root) throw new Error(`Bound Brick entry not found: ${key}`)
        const suppliedDependencies = options?.dependencies ?? {}
        const executionRoot = Object.freeze({
          ...root,
          ...(options?.dependencies ? { suppliedDependencies } : {})
        })
        return executeBrick({
          root: executionRoot,
          entries,
          params,
          providers: Object.freeze({
            ...effectiveLayerProviders(layer),
            ...((options?.requirements as Readonly<Record<string, unknown>> | undefined) ?? {})
          }),
          resolveDependency: (caller, alias) => {
            const callerLayerPath = (caller as FlattenedLayerEntry).layerPath ?? root.layerPath
            const suppliedNode = caller.suppliedDependencies?.[alias]
            const supplied = suppliedNode?.brick ? suppliedNode : undefined
            const suppliedBranchPath = Object.freeze([...(caller.suppliedPath ?? []), alias])
            const scopedSupplied = supplied
              ? Object.freeze({
                  id: [...(caller.id?.split('.') ?? []), alias].join('.'),
                  key: alias,
                  implementation: supplied.brick,
                  layerPath: Object.freeze([...callerLayerPath]),
                  suppliedPath: suppliedBranchPath,
                  ...(supplied.dependencies ? { suppliedDependencies: supplied.dependencies } : {})
                })
              : undefined
            if (callerLayerPath.length > 0) {
              const layerEntry = findLayerDependency(
                layer,
                caller as FlattenedLayerEntry,
                alias,
                scopedSupplied as FlattenedLayerEntry | undefined
              )
              if (layerEntry) {
                const resolvedDependencies =
                  suppliedNode?.dependencies ?? caller.suppliedDependencies?.[alias]?.dependencies
                return resolvedDependencies
                  ? Object.freeze({
                      ...layerEntry,
                      suppliedDependencies: resolvedDependencies,
                      signalPath: Object.freeze(layerEntry.id.split('.')),
                      ...(caller.suppliedPath || suppliedNode
                        ? { suppliedPath: suppliedBranchPath }
                        : {}),
                      ...(scopedSupplied ? { ownSignalPath: scopedSupplied.suppliedPath } : {})
                    })
                  : scopedSupplied
                    ? Object.freeze({
                        ...layerEntry,
                        suppliedPath: scopedSupplied.suppliedPath,
                        signalPath: Object.freeze(layerEntry.id.split('.')),
                        ownSignalPath: scopedSupplied.suppliedPath
                      })
                    : caller.suppliedPath
                      ? Object.freeze({
                          ...layerEntry,
                          suppliedPath: caller.suppliedPath,
                          signalPath: Object.freeze(layerEntry.id.split('.'))
                        })
                      : layerEntry
              }
            }
            if (scopedSupplied) return scopedSupplied as unknown as FlattenedLayerEntry
            throw new Error(`Missing dependency Brick entry "${alias}" in the configured Layer`)
          },
          ...(options?.signals
            ? { signals: options.signals as Readonly<Record<string, unknown>> }
            : {}),
          ...(options?.worker ? { worker: options.worker as never } : {}),
          ...(typeof options?.id === 'string' ? { id: options.id } : {}),
          ...(options?.metadata
            ? { metadata: options.metadata as Readonly<Record<string, unknown>> }
            : {}),
          ...(options?.plugins ? { plugins: options.plugins } : {}),
          ...(typeof options?.isReplay === 'boolean' ? { isReplay: options.isReplay } : {})
        })
      }
    }
    markBrickImplementation(bound)
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
        value: isBrickImplementation(entry)
          ? this.bindBrick(entry, key, `${pathPrefix}.${key}`)
          : isLayer(entry)
            ? this.bindNestedLayer(entry, `${pathPrefix}.${entry.id}`)
            : entry
      })
    }
    return Object.freeze(view) as unknown as AnyLayer
  }

  provide(values: Readonly<Record<string, unknown>>): AnyLayer {
    addProviders(effectiveLayerProviders(this), values)
    return new LayerImplementation(this.id, this.entries, { ...this.providers, ...values })
  }

  override(values: Readonly<Record<string, unknown>>): AnyLayer {
    for (const key of Object.keys(values)) {
      if (!hasProviderKey(this, key)) {
        throw new Error(`Cannot override absent provider key: ${key}`)
      }
    }
    return new LayerImplementation(this.id, this.entries, { ...this.providers, ...values })
  }
}

export const Layer = LayerImplementation as unknown as LayerConstructor
