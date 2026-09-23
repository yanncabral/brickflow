/**
 * Deterministic durable step naming for per-brick execution.
 *
 * Each executed Brick node maps to exactly one durable step. The step name
 * derives from the node's durable identity (`entry.id`: the Layer-bound
 * Brick path, or the supplied dependency path for direct runs) and falls
 * back to the call id for direct-run roots, so replays address the same
 * checkpoint. Names are pure functions of `(nodeId, callId)`: repeated
 * executions of the same graph resolve the same names in the same order.
 */
export const DURABLE_STEP_PREFIX = 'brickflow' as const

export function toDurableStepName(nodeId: string | undefined, callId: string): string {
  const raw = nodeId !== undefined && nodeId.length > 0 ? nodeId : callId
  const sanitized = raw.replace(/[^A-Za-z0-9_./-]/g, '_')
  const name = sanitized.length > 0 ? sanitized : callId
  return `${DURABLE_STEP_PREFIX}/${name}`
}
