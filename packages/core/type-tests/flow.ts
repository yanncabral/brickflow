import { executeFlowImplementation } from '../src/flow/implementation'
// @ts-expect-error obsolete Spec aliases are not part of the public API
import type { SpecOf } from '../src/index'
import * as publicApi from '../src/index'
import { type Flow, type FlowHandler, type FlowImplementation, flow } from '../src/index'

// @ts-expect-error raw execution helpers are internal, not part of the public barrel
void publicApi.executeFlowImplementation
// @ts-expect-error implementation guards are internal, not part of the public barrel
void publicApi.isFlowImplementation
// @ts-expect-error Layer flattening is internal, not part of the public barrel
void publicApi.flattenLayer
// @ts-expect-error Layer lookup is internal, not part of the public barrel
void publicApi.lookupLayer

type _ObsoleteSpecOf = SpecOf<unknown>
void (undefined as _ObsoleteSpecOf)

interface GetUserFlow extends Flow {
  params: { id: string }
  result: { id: string }
  errors: 'user-not-found' | { type: 'unavailable'; retryAfter: number }
  requires: { users: { find(id: string): Promise<{ id: string } | undefined> } }
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}

interface GetProfileFlow extends Flow {
  params: { userId: string }
  result: { userId: string }
  errors: 'profile-not-found'
  requires: { profiles: { has(userId: string): boolean } }
  depends: { getUser: GetUserFlow }
}

interface QuietFlow extends Flow {
  params: undefined
  result: number
}

const getUser = flow<GetUserFlow>(async ({ id }, { users }, dependencies, { fail, signals }) => {
  const user = await users.find(id)
  dependencies satisfies Record<never, never>
  signals satisfies { refresh: (request: { force: boolean }) => Promise<'refreshed'> }
  // @ts-expect-error signal requests are checked structurally
  signals.refresh({ force: 'yes' })
  return user ?? fail('user-not-found')
})

flow<GetProfileFlow>(async ({ userId }, { profiles }, { getUser }, { fail }) => {
  const user = await getUser({ id: userId })
  return profiles.has(user.id) ? { userId: user.id } : fail('profile-not-found')
})

const quiet = flow<QuietFlow>(() => 1)
quiet satisfies FlowImplementation<QuietFlow>

const alternateGetUser = flow<GetUserFlow>(async ({ id }) => ({ id }))
alternateGetUser satisfies FlowImplementation<GetUserFlow>

flow<GetUserFlow>(async (_params, _requirements, _dependencies, { fail }) => {
  // @ts-expect-error fail accepts only errors declared by this Flow
  return fail('profile-not-found')
})

flow<GetUserFlow>(
  // @ts-expect-error params must match the Flow interface
  async ({ missing }) => ({ id: missing })
)

flow<GetUserFlow>(
  // @ts-expect-error handler result must match the Flow interface
  async ({ id }) => ({ userId: id })
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
  { refresh: async () => 'refreshed' }
)

const handler: FlowHandler<GetUserFlow> = async ({ id }) => ({ id })
void handler
void quiet
