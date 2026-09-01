export interface Session {
  readonly id: string
  readonly userId: string
  readonly token: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly revokedAt?: Date
}

export interface SessionRepository {
  findById(id: string): Promise<Session | undefined>
  findByToken(token: string): Promise<Session | undefined>
  listByUserId(userId: string): Promise<readonly Session[]>
  insert(session: Session): Promise<void>
  update(session: Session): Promise<void>
}
