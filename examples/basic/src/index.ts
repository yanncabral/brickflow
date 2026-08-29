import { type Brick, brick, Layer } from '@brickflow/core'

interface User {
  readonly id: string
  readonly name: string
}

interface UserRepository {
  find(id: string): Promise<User | undefined>
}

export type GetUserBrick = Brick<{
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}>

export const getUser = brick<GetUserBrick>(
  async ({ id }, { userRepository }, _dependencies, { fail }) => {
    const user = await userRepository.find(id)
    return user ?? fail('user-not-found')
  }
)

export type GetGreetingBrick = Brick<{
  params: { id: string }
  result: { message: string }
  depends: { getUser: GetUserBrick }
}>

export const getGreeting = brick<GetGreetingBrick>(async ({ id }, _requirements, { getUser }) => {
  const user = await getUser({ id })
  return { message: `Hello, ${user.name}!` }
})

export type ApproveGreetingBrick = Brick<{
  params: { id: string }
  result: { message: string; approved: boolean }
  depends: { getGreeting: GetGreetingBrick }
  signals: {
    approve: {
      request: { message: string }
      response: { approved: boolean }
    }
  }
}>

export const approveGreeting = brick<ApproveGreetingBrick>(
  async ({ id }, _requirements, { getGreeting }, { signals }) => {
    const greeting = await getGreeting({ id })
    const approval = await signals.approve(greeting)
    return { ...greeting, ...approval }
  }
)

export interface BasicExampleOutput {
  readonly success: { readonly message: string }
  readonly recovered: { readonly message: string }
  readonly approval: { readonly message: string; readonly approved: boolean }
  readonly approvalRequests: readonly { readonly message: string }[]
}

export async function runBasicExample(): Promise<BasicExampleOutput> {
  const storedUsers = new Map<string, User>([['ada', { id: 'ada', name: 'Ada' }]])
  const userRepository: UserRepository = {
    async find(id) {
      return storedUsers.get(id)
    }
  }
  const users = new Layer('users', { getUser, getGreeting, approveGreeting }).provide({
    userRepository
  })
  const approvalRequests: { message: string }[] = []

  const success = await users.getGreeting
    .run({ id: 'ada' })
    .with('user-not-found', () => ({ message: 'Hello, mysterious stranger!' }))
  const recovered = await users.getGreeting
    .run({ id: 'missing' })
    .with('user-not-found', () => ({ message: 'Hello, mysterious stranger!' }))
  const approval = await users.approveGreeting
    .run(
      { id: 'ada' },
      {
        signals: {
          users: {
            approveGreeting: {
              approve: (request: { message: string }) => {
                approvalRequests.push(request)
                return { approved: true }
              }
            }
          }
        }
      }
    )
    .with('user-not-found', () => ({
      message: 'Hello, mysterious stranger!',
      approved: false
    }))

  return { success, recovered, approval, approvalRequests }
}

if (import.meta.main) console.log(JSON.stringify(await runBasicExample(), null, 2))
