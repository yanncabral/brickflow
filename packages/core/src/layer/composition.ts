import { isFlowImplementation } from '../flow/implementation'
import type { AnyLayer, FlattenedLayerEntry } from './types'

export function isLayer(value: unknown): value is AnyLayer {
  return value instanceof LayerRuntime
}

export function flattenLayer(layer: AnyLayer): readonly FlattenedLayerEntry[] {
  const flattened: FlattenedLayerEntry[] = []
  const durableIds = new Set<string>()
  const active = new Set<AnyLayer>()

  const visit = (current: AnyLayer, parentPath: readonly string[]): void => {
    const path = [...parentPath, current.id]
    if (active.has(current)) {
      throw new Error(`Cyclic Layer nesting detected: ${[...path, current.id].join(' -> ')}`)
    }
    active.add(current)

    for (const [key, entry] of Object.entries(current.entries)) {
      if (isFlowImplementation(entry)) {
        const id = [...path, key].join('.')
        if (durableIds.has(id)) {
          throw new Error(`Duplicate durable Flow ID: ${id}`)
        }
        durableIds.add(id)
        flattened.push(Object.freeze({ id, implementation: entry }))
      } else if (isLayer(entry)) {
        visit(entry, path)
      } else {
        throw new Error(`Invalid Layer entry at ${[...path, key].join('.')}`)
      }
    }

    active.delete(current)
  }

  visit(layer, [])
  return Object.freeze(flattened)
}

export function lookupLayer(
  layer: AnyLayer,
  durableId: string
): FlattenedLayerEntry['implementation'] | undefined {
  return flattenLayer(layer).find(({ id }) => id === durableId)?.implementation
}

export function effectiveLayerProviders(layer: AnyLayer): Readonly<Record<string, unknown>> {
  const providers: Record<string, unknown> = {}
  const sources = new Map<string, string>()
  const topLevelKeys = new Set(Object.keys(layer.providers))

  const visit = (current: AnyLayer, path: readonly string[]): void => {
    const currentPath = [...path, current.id]
    for (const entry of Object.values(current.entries)) {
      if (isLayer(entry)) visit(entry, currentPath)
    }
    for (const [key, value] of Object.entries(current.providers)) {
      if (path.length === 0) {
        providers[key] = value
        sources.set(key, currentPath.join('.'))
        continue
      }
      if (topLevelKeys.has(key)) continue
      if (Object.hasOwn(providers, key) && providers[key] !== value) {
        throw new Error(
          `Conflicting nested Layer provider "${key}" from ${sources.get(key)} and ${currentPath.join('.')}`
        )
      }
      providers[key] = value
      sources.set(key, currentPath.join('.'))
    }
  }

  visit(layer, [])
  return Object.freeze(providers)
}

export abstract class LayerRuntime {
  abstract readonly id: string
  abstract readonly entries: Readonly<Record<string, unknown>>
}
