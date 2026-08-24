import { assertValidPathSegment } from '../path-segment'
import type { SignalCallMetadata, UnknownSignalHandlers } from './types'

export type NamespacedHandlers<Path extends readonly string[], Handlers> = Path extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[]
]
  ? Readonly<Record<Head, NamespacedHandlers<Tail, Handlers>>>
  : Handlers

function isHandler(value: unknown): value is NonNullable<UnknownSignalHandlers[string]> {
  return typeof value === 'function'
}

export function flattenNamespacedSignalHandlers(
  handlers: Readonly<Record<string, unknown>>,
  path: readonly string[] = []
): UnknownSignalHandlers {
  const flattened: Record<string, NonNullable<UnknownSignalHandlers[string]>> = {}

  for (const [name, value] of Object.entries(handlers)) {
    assertValidPathSegment(name)
    const durableName = durableSignalName(path, name)
    if (isHandler(value)) {
      flattened[durableName] = value
      continue
    }
    if (typeof value === 'object' && value !== null) {
      Object.assign(
        flattened,
        flattenNamespacedSignalHandlers(value as Readonly<Record<string, unknown>>, [...path, name])
      )
      continue
    }
    throw new Error(`Invalid signal handler at "${durableName}"`)
  }

  return Object.freeze(flattened)
}

export function namespaceSignalHandlers<const Path extends readonly string[], Handlers>(
  path: Path,
  handlers: Handlers
): NamespacedHandlers<Path, Handlers> {
  return path.reduceRight<unknown>(
    (nested, segment) => ({ [segment]: nested }),
    handlers
  ) as NamespacedHandlers<Path, Handlers>
}

export function durableSignalName(path: readonly string[], signalName: string): string {
  return [...path, signalName].filter((segment) => segment.length > 0).join('.')
}

export function signalCallMetadata(
  layerPath: readonly string[],
  flowPath: readonly string[],
  signalName: string,
  callId: string,
  occurrence: number
): SignalCallMetadata {
  const stableLayerPath = Object.freeze([...layerPath])
  const stableFlowPath = Object.freeze([...flowPath])
  return Object.freeze({
    durableName: durableSignalName([...stableLayerPath, ...stableFlowPath], signalName),
    signalName,
    layerPath: stableLayerPath,
    flowPath: stableFlowPath,
    callId,
    occurrence
  })
}

export function flattenSignalHandlers(
  namespace: readonly string[],
  handlers: UnknownSignalHandlers
): Readonly<Record<string, UnknownSignalHandlers[string]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [
        durableSignalName(namespace, name),
        handler
      ])
    )
  )
}
