import { type Brick, brick } from 'brickflow'
import type { User, UserRepository } from './user'

export type GetUser = Brick<{
  params: { id: string }
  result: User
  errors: { type: 'user-not-found'; id: string }
  requires: { userRepository: UserRepository }
}>

export const getUser = brick<GetUser>(async ({ id }, { userRepository }, _deps, { fail }) => {
  const user = await userRepository.findById(id)
  return user ?? fail({ type: 'user-not-found', id })
})

export type CreateUser = Brick<{
  params: { email: string; name: string }
  result: User
  errors: { type: 'email-already-in-use'; email: string }
  requires: { userRepository: UserRepository; idGenerator: () => string; clock: () => Date }
}>

export const createUser = brick<CreateUser>(
  async ({ email, name }, { userRepository, idGenerator, clock }, _deps, { fail }) => {
    if (await userRepository.findByEmail(email)) {
      return fail({ type: 'email-already-in-use', email })
    }
    const now = clock()
    const user = { id: idGenerator(), email, name, createdAt: now, updatedAt: now }
    await userRepository.insert(user)
    return user
  }
)

export type ListUsers = Brick<{
  params: undefined
  result: readonly User[]
  requires: { userRepository: UserRepository }
}>

export const listUsers = brick<ListUsers>((_params, { userRepository }) => userRepository.list())

export type UpdateUser = Brick<{
  params: { id: string; name: string }
  result: User
  errors: { type: 'user-not-found'; id: string }
  requires: { userRepository: UserRepository; clock: () => Date }
}>

export const updateUser = brick<UpdateUser>(
  async ({ id, name }, { userRepository, clock }, _deps, { fail }) => {
    const user = await userRepository.findById(id)
    if (!user) return fail({ type: 'user-not-found', id })
    const updated = { ...user, name, updatedAt: clock() }
    await userRepository.update(updated)
    return updated
  }
)

export type DeleteUser = Brick<{
  params: { id: string }
  result: undefined
  errors: { type: 'user-not-found'; id: string }
  requires: { userRepository: UserRepository }
}>

export const deleteUser = brick<DeleteUser>(async ({ id }, { userRepository }, _deps, { fail }) => {
  if (!(await userRepository.findById(id))) return fail({ type: 'user-not-found', id })
  await userRepository.delete(id)
})
