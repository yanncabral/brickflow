import { type Brick, brick } from 'brickflow'
import type { Session, SessionRepository } from './session'

type SessionError =
  | { type: 'session-not-found'; id: string }
  | { type: 'session-token-not-found' }
  | { type: 'session-expired' }
  | { type: 'session-revoked' }

export type CreateSession = Brick<{
  params: { userId: string; ttlMs: number }
  result: Session
  requires: {
    sessionRepository: SessionRepository
    idGenerator: () => string
    tokenGenerator: () => string
    clock: () => Date
  }
}>

export const createSession = brick<CreateSession>(async ({ userId, ttlMs }, requirements) => {
  const createdAt = requirements.clock()
  const session = {
    id: requirements.idGenerator(),
    userId,
    token: requirements.tokenGenerator(),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + ttlMs)
  }
  await requirements.sessionRepository.insert(session)
  return session
})

export type RefreshSession = Brick<{
  params: { token: string; ttlMs: number }
  result: Session
  errors: SessionError
  requires: {
    sessionRepository: SessionRepository
    tokenGenerator: () => string
    clock: () => Date
  }
}>

export const refreshSession = brick<RefreshSession>(
  async ({ token, ttlMs }, requirements, _deps, { fail }) => {
    const session = await requirements.sessionRepository.findByToken(token)
    if (!session) return fail({ type: 'session-token-not-found' })
    if (session.revokedAt) return fail({ type: 'session-revoked' })
    if (session.expiresAt <= requirements.clock()) return fail({ type: 'session-expired' })
    const refreshed = {
      ...session,
      token: requirements.tokenGenerator(),
      expiresAt: new Date(requirements.clock().getTime() + ttlMs)
    }
    await requirements.sessionRepository.update(refreshed)
    return refreshed
  }
)

export type RevokeSession = Brick<{
  params: { id: string }
  result: undefined
  errors: { type: 'session-not-found'; id: string }
  requires: { sessionRepository: SessionRepository; clock: () => Date }
}>

export const revokeSession = brick<RevokeSession>(async ({ id }, requirements, _deps, { fail }) => {
  const session = await requirements.sessionRepository.findById(id)
  if (!session) return fail({ type: 'session-not-found', id })
  await requirements.sessionRepository.update({ ...session, revokedAt: requirements.clock() })
})

export type RevokeAllSessions = Brick<{
  params: { userId: string }
  result: undefined
  requires: { sessionRepository: SessionRepository; clock: () => Date }
}>

export const revokeAllSessions = brick<RevokeAllSessions>(async ({ userId }, requirements) => {
  const revokedAt = requirements.clock()
  for (const session of await requirements.sessionRepository.listByUserId(userId)) {
    if (!session.revokedAt) await requirements.sessionRepository.update({ ...session, revokedAt })
  }
})
