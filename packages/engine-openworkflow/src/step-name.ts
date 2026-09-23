/**
 * Deterministic durable step naming.
 *
 * Each engine request maps to exactly one OpenWorkflow step. The step name
 * derives from the Layer-bound `brickId` (durable brick path) when present
 * and falls back to the run id for direct runs, so replays address the same
 * checkpoint.
 */
export const BRICKFLOW_STEP_PREFIX = 'brickflow' as const

export function toStepName(brickId: string | undefined, runId: string): string {
  const raw = brickId !== undefined && brickId.length > 0 ? brickId : runId
  const sanitized = raw.replace(/[^A-Za-z0-9_./-]/g, '_')
  const name = sanitized.length > 0 ? sanitized : runId
  return `${BRICKFLOW_STEP_PREFIX}/${name}`
}
