import { Layer } from 'brickflow'
import { createUser, deleteUser, getUser, listUsers, updateUser } from './usecases'

export const usersLayer = new Layer('users', {
  createUser,
  getUser,
  listUsers,
  updateUser,
  deleteUser
})
export type UsersModule = typeof usersLayer
