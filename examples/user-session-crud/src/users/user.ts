export interface User {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface UserRepository {
  findById(id: string): Promise<User | undefined>
  findByEmail(email: string): Promise<User | undefined>
  list(): Promise<readonly User[]>
  insert(user: User): Promise<void>
  update(user: User): Promise<void>
  delete(id: string): Promise<void>
}
