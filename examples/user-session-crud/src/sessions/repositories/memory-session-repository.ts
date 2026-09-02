import type { Session, SessionRepository } from '../session'

export class MemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>()
  async findById(id: string) {
    return this.sessions.get(id)
  }
  async findByToken(token: string) {
    return [...this.sessions.values()].find((session) => session.token === token)
  }
  async listByUserId(userId: string) {
    return [...this.sessions.values()].filter((session) => session.userId === userId)
  }
  async insert(session: Session) {
    this.sessions.set(session.id, session)
  }
  async update(session: Session) {
    this.sessions.set(session.id, session)
  }
}
