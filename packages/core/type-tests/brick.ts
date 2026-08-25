import { executeBrickImplementation } from '../src/brick/implementation'
// @ts-expect-error obsolete Spec aliases are not part of the public API
import type { SpecOf } from '../src/index'
import * as publicApi from '../src/index'
import { type Brick, type BrickHandler, type BrickImplementation, brick } from '../src/index'

// @ts-expect-error raw execution helpers are internal, not part of the public barrel
void publicApi.executeBrickImplementation
// @ts-expect-error implementation guards are internal, not part of the public barrel
void publicApi.isBrickImplementation
// @ts-expect-error Layer flattening is internal, not part of the public barrel
void publicApi.flattenLayer
// @ts-expect-error Layer lookup is internal, not part of the public barrel
void publicApi.lookupLayer

type _ObsoleteSpecOf = SpecOf<unknown>
void (undefined as _ObsoleteSpecOf)

interface GetUserBrick extends Brick {
  params: { id: string }
  result: { id: string }
  errors: 'user-not-found' | { type: 'unavailable'; retryAfter: number }
  requires: { users: { find(id: string): Promise<{ id: string } | undefined> } }
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}

interface GetProfileBrick extends Brick {
  params: { userId: string }
  result: { userId: string }
  errors: 'profile-not-found'
  requires: { profiles: { has(userId: string): boolean } }
  depends: { getUser: GetUserBrick }
}

interface EmptyDependencyAliasBrick extends Brick {
  params: undefined
  result: undefined
  depends: { '': QuietBrick }
}

interface DottedDependencyAliasBrick extends Brick {
  params: undefined
  result: undefined
  depends: { 'quiet.child': QuietBrick }
}

interface EmptySignalNameBrick extends Brick {
  params: undefined
  result: undefined
  signals: { '': { request: undefined; response: string } }
}

interface DottedSignalNameBrick extends Brick {
  params: undefined
  result: undefined
  signals: { 'quiet.signal': { request: undefined; response: string } }
}

declare const symbolDependencyAlias: unique symbol
declare const symbolSignalName: unique symbol

interface SymbolDependencyAliasBrick extends Brick {
  params: undefined
  result: undefined
  depends: { [symbolDependencyAlias]: QuietBrick }
}

interface NumericDependencyAliasBrick extends Brick {
  params: undefined
  result: undefined
  depends: { 0: QuietBrick }
}

interface SymbolSignalNameBrick extends Brick {
  params: undefined
  result: undefined
  signals: { [symbolSignalName]: { request: undefined; response: string } }
}

interface NumericSignalNameBrick extends Brick {
  params: undefined
  result: undefined
  signals: { 0: { request: undefined; response: string } }
}

interface QuietBrick extends Brick {
  params: undefined
  result: number
}

const getUser = brick<GetUserBrick>(async ({ id }, { users }, dependencies, { fail, signals }) => {
  const user = await users.find(id)
  dependencies satisfies Record<never, never>
  signals satisfies { refresh: (request: { force: boolean }) => Promise<'refreshed'> }
  // @ts-expect-error signal requests are checked structurally
  signals.refresh({ force: 'yes' })
  return user ?? fail('user-not-found')
})

brick<GetProfileBrick>(async ({ userId }, { profiles }, { getUser }, { fail }) => {
  const user = await getUser({ id: userId })
  return profiles.has(user.id) ? { userId: user.id } : fail('profile-not-found')
})

// @ts-expect-error dependency aliases must not be empty
brick<EmptyDependencyAliasBrick>(() => undefined)
// @ts-expect-error dependency aliases must not contain dots
brick<DottedDependencyAliasBrick>(() => undefined)
// @ts-expect-error signal names must not be empty
brick<EmptySignalNameBrick>(() => undefined)
// @ts-expect-error signal names must not contain dots
brick<DottedSignalNameBrick>(() => undefined)

// @ts-expect-error dependency aliases must be string keys
brick<SymbolDependencyAliasBrick>(() => undefined)
// @ts-expect-error numeric dependency aliases must be rejected instead of stringified
brick<NumericDependencyAliasBrick>(() => undefined)
// @ts-expect-error signal names must be string keys
brick<SymbolSignalNameBrick>(() => undefined)
// @ts-expect-error numeric signal names must be rejected instead of stringified
brick<NumericSignalNameBrick>(() => undefined)

const quiet = brick<QuietBrick>(() => 1)
quiet satisfies BrickImplementation<QuietBrick>

const alternateGetUser = brick<GetUserBrick>(async ({ id }) => ({ id }))
alternateGetUser satisfies BrickImplementation<GetUserBrick>

brick<GetUserBrick>(async (_params, _requirements, _dependencies, { fail }) => {
  // @ts-expect-error fail accepts only errors declared by this Brick
  return fail('profile-not-found')
})

brick<GetUserBrick>(
  // @ts-expect-error params must match the Brick interface
  async ({ missing }) => ({ id: missing })
)

brick<GetUserBrick>(
  // @ts-expect-error handler result must match the Brick interface
  async ({ id }) => ({ userId: id })
)

// @ts-expect-error signals are required for a Brick that declares them
void executeBrickImplementation(
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

void executeBrickImplementation(
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

const handler: BrickHandler<GetUserBrick> = async ({ id }) => ({ id })
void handler
void quiet
