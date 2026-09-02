import { Layer } from 'brickflow'
import { createSession, refreshSession, revokeAllSessions, revokeSession } from './usecases'

export const sessionsLayer = new Layer('sessions', {
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions
})
export type SessionsModule = typeof sessionsLayer
