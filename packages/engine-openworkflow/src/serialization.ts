import type { EngineExecutionResult } from 'brickflow'

/** JSON value as persisted by the OpenWorkflow backend. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * The engine result envelope as persisted in the durable step output.
 * Typed failures travel as `{ ok: false, error }` data and are never
 * collapsed into a generic `Error`.
 */
export type DurableEnvelope =
  | { readonly ok: true; readonly value?: JsonValue }
  | { readonly ok: false; readonly error?: JsonValue }

/**
 * Round-trip an engine result through JSON so only durable-safe data is
 * persisted. Requires JSON-serializable results, the same constraint
 * OpenWorkflow places on step outputs.
 */
export function toDurableEnvelope(
  result: EngineExecutionResult<unknown, unknown>
): DurableEnvelope {
  return JSON.parse(JSON.stringify(result)) as DurableEnvelope
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Restore an engine result from a persisted step output. */
export function fromDurableEnvelope(output: unknown): EngineExecutionResult<unknown, unknown> {
  if (!isRecord(output)) {
    throw new Error('Invalid durable brick envelope: expected { ok: boolean, ... }')
  }
  const envelope = output as {
    readonly ok?: unknown
    readonly value?: unknown
    readonly error?: unknown
  }
  if (typeof envelope.ok !== 'boolean') {
    throw new Error('Invalid durable brick envelope: expected { ok: boolean, ... }')
  }
  if (envelope.ok === true) {
    return { ok: true, value: envelope.value }
  }
  return { ok: false, error: envelope.error }
}

export interface SerializedDefect {
  readonly name?: string
  readonly message?: string
  readonly stack?: string
  readonly [key: string]: JsonValue | undefined
}

/**
 * Rehydrate an unexpected defect from its persisted serialized form,
 * preserving name, message, stack, and extra data fields. Identity with the
 * original thrown error only holds within the originating process.
 */
export function rehydrateDefect(serialized: unknown, fallbackMessage: string): Error {
  const data = (isRecord(serialized) ? serialized : {}) as {
    readonly name?: unknown
    readonly message?: unknown
    readonly stack?: unknown
  }
  const message = typeof data.message === 'string' ? data.message : fallbackMessage
  const error = new Error(message)
  if (typeof data.name === 'string' && data.name.length > 0) error.name = data.name
  if (typeof data.stack === 'string') error.stack = data.stack
  for (const [key, value] of Object.entries(data)) {
    if (key === 'name' || key === 'message' || key === 'stack') continue
    try {
      ;(error as unknown as Record<string, unknown>)[key] = value
    } catch {
      // Extra defect fields are best-effort across the durable boundary.
    }
  }
  return error
}
