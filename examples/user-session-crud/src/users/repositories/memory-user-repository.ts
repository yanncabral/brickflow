import type { User, UserRepository } from '../user'

export class MemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>()
  async findById(id: string) {
    return this.users.get(id)
  }
  async findByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email)
  }
  async list() {
    return [...this.users.values()]
  }
  async insert(user: User) {
    this.users.set(user.id, user)
  }
  async update(user: User) {
    this.users.set(user.id, user)
  }
  async delete(id: string) {
    this.users.delete(id)
  }
}
