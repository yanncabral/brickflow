import { Layer, localWorker } from 'brickflow'
import { MemorySessionRepository } from './sessions/repositories/memory-session-repository'
import { sessionsLayer } from './sessions/sessions-module'
import { MemoryUserRepository } from './users/repositories/memory-user-repository'
import { usersLayer } from './users/users-module'

export async function runCrudExample() {
  let sequence = 0
  const clock = () => new Date('2026-01-01T00:00:00.000Z')
  const userRepository = new MemoryUserRepository()
  const sessionRepository = new MemorySessionRepository()
  const app = new Layer('app', { users: usersLayer, sessions: sessionsLayer }).provide({
    userRepository,
    sessionRepository,
    idGenerator: () => `id-${++sequence}`,
    tokenGenerator: () => `token-${sequence}`,
    clock
  })
  const user = await app.users.createUser
    .run({ email: 'ada@example.com', name: 'Ada' })
    .with({ type: 'email-already-in-use' }, () => {
      throw new Error('unexpected duplicate email in example')
    })
  const session = await app.sessions.createSession.run(
    { userId: user.id, ttlMs: 3_600_000 },
    { worker: localWorker }
  )
  await app.sessions.revokeSession
    .run({ id: session.id })
    .with({ type: 'session-not-found' }, () => {
      throw new Error('session was created immediately before revocation')
    })
  return {
    user,
    session: (await sessionRepository.findById(session.id)) ?? session,
    users: await app.users.listUsers.run(undefined)
  }
}

if (import.meta.main) console.log(JSON.stringify(await runCrudExample(), null, 2))
