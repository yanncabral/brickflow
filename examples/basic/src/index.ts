import { type Flow, flow, Layer, Worker } from '@flow/core'
import { LocalEngine } from '@flow/engine-local'

interface User {
  readonly id: string
  readonly name: string
}

interface UserRepository {
  find(id: string): Promise<User | undefined>
}

export interface GetUserFlow extends Flow {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}

export const getUser = flow<GetUserFlow>(
  async ({ id }, { userRepository }, _dependencies, { fail }) => {
    const user = await userRepository.find(id)
    return user ?? fail('user-not-found')
  }
)

export interface GetGreetingFlow extends Flow {
  params: { id: string }
  result: { message: string }
  depends: { getUser: GetUserFlow }
}

export const getGreeting = flow<GetGreetingFlow>(async ({ id }, _requirements, { getUser }) => {
  const user = await getUser({ id })
  return { message: `Hello, ${user.name}!` }
})

export interface ApproveGreetingFlow extends Flow {
  params: { id: string }
  result: { message: string; approved: boolean }
  depends: { getGreeting: GetGreetingFlow }
  signals: {
    approve: {
      request: { message: string }
      response: { approved: boolean }
    }
  }
}

export const approveGreeting = flow<ApproveGreetingFlow>(
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
  const worker = new Worker({ engine: new LocalEngine(), layer: users })
  const approvalRequests: { message: string }[] = []

  const success = await worker
    .run(getGreeting, { id: 'ada' })
    .with('user-not-found', () => ({ message: 'Hello, mysterious stranger!' }))
  const recovered = await worker
    .run(getGreeting, { id: 'missing' })
    .with('user-not-found', () => ({ message: 'Hello, mysterious stranger!' }))
  const approval = await worker
    .run(
      approveGreeting,
      { id: 'ada' },
      {
        signals: {
          users: {
            approveGreeting: {
              approve: (request) => {
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
