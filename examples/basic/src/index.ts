import { Flow, Layer, Worker } from '@flow/core'
import { LocalEngine } from '@flow/engine-local'

interface User {
  readonly id: string
  readonly name: string
}

interface UserRepository {
  find(id: string): Promise<User | undefined>
}

type Empty = Record<never, never>

type GetUserSpec = {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
  depends: Empty
  signals: Empty
}

export class GetUserFlow extends Flow<GetUserSpec> {}

export const getUser = new GetUserFlow(
  { depends: {}, requires: ['userRepository'] },
  async ({ id }, { userRepository }, _dependencies, { fail }) => {
    const user = await userRepository.find(id)
    return user ?? fail('user-not-found')
  }
)

type GetGreetingSpec = {
  params: { id: string }
  result: { message: string }
  errors: never
  requires: Empty
  depends: { getUser: typeof GetUserFlow }
  signals: Empty
}

export class GetGreetingFlow extends Flow<GetGreetingSpec> {}

export const getGreeting = new GetGreetingFlow(
  { depends: { getUser: GetUserFlow } },
  async ({ id }, _requirements, { getUser }) => {
    const user = await getUser({ id })
    return { message: `Hello, ${user.name}!` }
  }
)

type ApproveGreetingSpec = {
  params: { id: string }
  result: { message: string; approved: boolean }
  errors: never
  requires: Empty
  depends: { getGreeting: typeof GetGreetingFlow }
  signals: {
    approve: {
      request: { message: string }
      response: { approved: boolean }
    }
  }
}

export class ApproveGreetingFlow extends Flow<ApproveGreetingSpec> {}

export const approveGreeting = new ApproveGreetingFlow(
  { depends: { getGreeting: GetGreetingFlow } },
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

if (import.meta.main) {
  console.log(JSON.stringify(await runBasicExample(), null, 2))
}
