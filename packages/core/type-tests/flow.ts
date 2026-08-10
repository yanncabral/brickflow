import { executeFlowImplementation } from '../src/flow/implementation'
import * as publicApi from '../src/index'
import { Flow, type FlowHandler, type FlowSpec } from '../src/index'

// @ts-expect-error raw execution helpers are internal, not part of the public barrel
void publicApi.executeFlowImplementation
// @ts-expect-error implementation guards are internal, not part of the public barrel
void publicApi.isFlowImplementation
// @ts-expect-error Layer flattening is internal, not part of the public barrel
void publicApi.flattenLayer
// @ts-expect-error Layer lookup is internal, not part of the public barrel
void publicApi.lookupLayer
// @ts-expect-error matching builders are internal, not part of the public barrel
void publicApi.createMatchingBuilder
// @ts-expect-error signal chain construction is internal, not part of the public barrel
void publicApi.createSignalHandlerChain
// @ts-expect-error signal resolution is internal, not part of the public barrel
void publicApi.resolveSignal
// @ts-expect-error signal namespace flattening is internal, not part of the public barrel
void publicApi.flattenNamespacedSignalHandlers

type Empty = Record<never, never>

type GetUserSpec = {
  params: { id: string }
  result: { id: string }
  errors: 'user-not-found' | { type: 'unavailable'; retryAfter: number }
  requires: { users: { find(id: string): Promise<{ id: string } | undefined> } }
  depends: Empty
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}

class GetUserFlow extends Flow<GetUserSpec> {}

class GetProfileFlow extends Flow<{
  params: { userId: string }
  result: { userId: string }
  errors: 'profile-not-found'
  requires: { profiles: { has(userId: string): boolean } }
  depends: { getUser: typeof GetUserFlow }
  signals: Empty
}> {}

const getUser = new GetUserFlow(
  { depends: {}, requires: ['users'] },
  async ({ id }, { users }, dependencies, { fail, signals }) => {
    const user = await users.find(id)
    dependencies satisfies Empty
    signals satisfies { refresh: (request: { force: boolean }) => Promise<'refreshed'> }
    const refreshed: Promise<'refreshed'> = signals.refresh({ force: true })
    void refreshed
    // @ts-expect-error signal requests are checked structurally
    signals.refresh({ force: 'yes' })
    return user ?? fail('user-not-found')
  }
)

// @ts-expect-error requires metadata is mandatory when providers are declared
new GetUserFlow(async ({ id }) => ({ id }))

new GetUserFlow({ depends: {}, requires: ['users'] }, async ({ id }) => ({ id }))

new GetUserFlow(
  // @ts-expect-error requires metadata cannot omit declared provider keys
  { depends: {}, requires: [] },
  async ({ id }) => ({ id })
)
new GetUserFlow(
  // @ts-expect-error requires metadata cannot contain extra provider keys
  { depends: {}, requires: ['users', 'extra'] },
  async ({ id }) => ({ id })
)
new GetUserFlow(
  // @ts-expect-error requires metadata cannot contain duplicate provider keys
  { depends: {}, requires: ['users', 'users'] },
  async ({ id }) => ({ id })
)

new GetProfileFlow(
  { depends: { getUser: GetUserFlow }, requires: ['profiles'] },
  async ({ userId }, { profiles }, { getUser }, { fail }) => {
    const user = await getUser({ id: userId })
    return profiles.has(user.id) ? { userId: user.id } : fail('profile-not-found')
  }
)

new GetUserFlow(
  { depends: {}, requires: ['users'] },
  async (_params, _requirements, _dependencies, { fail }) => {
    // @ts-expect-error fail accepts only errors declared by this Flow
    return fail('profile-not-found')
  }
)

// @ts-expect-error params must match the Flow contract
new GetUserFlow(async ({ missing }) => ({ id: missing }))

// @ts-expect-error handler result must match the Flow contract
new GetUserFlow(async ({ id }) => ({ userId: id }))

// @ts-expect-error dependency metadata is required for declared dependencies
new GetProfileFlow(async ({ userId }) => ({ userId }))

new GetProfileFlow(
  // @ts-expect-error dependency metadata must use the declared contract
  { depends: { getUser: GetProfileFlow } },
  async ({ userId }) => ({ userId })
)

new GetProfileFlow(
  // @ts-expect-error dependency metadata must not contain extra keys
  { depends: { getUser: GetUserFlow, extra: GetUserFlow } },
  async ({ userId }) => ({ userId })
)

// @ts-expect-error signals are required for a Flow that declares them
void executeFlowImplementation(
  getUser,
  { id: 'u1' },
  {
    users: {
      async find(id: string) {
        return { id }
      }
    }
  },
  {}
)

void executeFlowImplementation(
  getUser,
  { id: 'u1' },
  {
    users: {
      async find(id: string) {
        return { id }
      }
    }
  },
  {},
  { refresh: async ({ force }) => (force ? 'refreshed' : 'refreshed') }
)

void executeFlowImplementation(
  getUser,
  { id: 'u1' },
  {
    users: {
      async find(id: string) {
        return { id }
      }
    }
  },
  {},
  {
    // @ts-expect-error executeFlowImplementation receives callable signal functions, not declarations
    refresh: { request: { force: true }, response: undefined }
  }
)

class AlternateGetUserFlow extends Flow<GetUserSpec> {}

new GetProfileFlow(
  { depends: { getUser: AlternateGetUserFlow }, requires: ['profiles'] },
  async ({ userId }) => ({
    userId
  })
)

const extraDependencyOptions = {
  depends: { getUser: GetUserFlow, extra: GetUserFlow },
  requires: ['profiles'] as const
}
new GetProfileFlow(extraDependencyOptions, async ({ userId }) => ({ userId }))

const emptyOptionsWithExtraDependency = {
  depends: { extra: GetUserFlow },
  requires: ['users'] as const
}
new GetUserFlow(emptyOptionsWithExtraDependency, async ({ id }) => ({ id }))

type InvalidDependencySpec = {
  params: undefined
  result: undefined
  errors: never
  requires: Empty
  depends: { invalid: object }
  signals: Empty
}

;new (class InvalidDependencyFlow extends Flow<InvalidDependencySpec> {})(
  // @ts-expect-error depends values must be Flow contract constructors
  { depends: { invalid: {} } },
  () => undefined
)

type _FlowSpecConstraint = FlowSpec

const handler: FlowHandler<GetUserSpec> = async ({ id }) => ({ id })
void getUser
void handler
