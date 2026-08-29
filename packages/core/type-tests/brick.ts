import { executeBrickImplementation } from '../src/brick/implementation'
// @ts-expect-error obsolete Spec aliases are not part of the public API
import type { SpecOf } from '../src/index'
import * as publicApi from '../src/index'
import {
  type Brick,
  type BrickHandler,
  type BrickImplementation,
  brick,
  type DependenciesOf,
  type ErrorsOf,
  type ParamsOf,
  type RequirementsOf,
  type ResultOf,
  type SignalsOf
} from '../src/index'

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

type GetUserBrick = Brick<{
  params: { id: string }
  result: { id: string }
  errors: 'user-not-found' | { type: 'unavailable'; retryAfter: number }
  requires: { users: { find(id: string): Promise<{ id: string } | undefined> } }
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}>

type GetProfileBrick = Brick<{
  params: { userId: string }
  result: { userId: string }
  errors: 'profile-not-found'
  requires: { profiles: { has(userId: string): boolean } }
  depends: { getUser: GetUserBrick }
}>

type EmptyDependencyAliasBrick = Brick<{
  params: undefined
  result: undefined
  depends: { '': QuietBrick }
}>

type DottedDependencyAliasBrick = Brick<{
  params: undefined
  result: undefined
  depends: { 'quiet.child': QuietBrick }
}>

type EmptySignalNameBrick = Brick<{
  params: undefined
  result: undefined
  signals: { '': { request: undefined; response: string } }
}>

type DottedSignalNameBrick = Brick<{
  params: undefined
  result: undefined
  signals: { 'quiet.signal': { request: undefined; response: string } }
}>

declare const symbolDependencyAlias: unique symbol
declare const symbolSignalName: unique symbol

type SymbolDependencyAliasBrick = Brick<{
  params: undefined
  result: undefined
  depends: { [symbolDependencyAlias]: QuietBrick }
}>

type NumericDependencyAliasBrick = Brick<{
  params: undefined
  result: undefined
  depends: { 0: QuietBrick }
}>

type SymbolSignalNameBrick = Brick<{
  params: undefined
  result: undefined
  signals: { [symbolSignalName]: { request: undefined; response: string } }
}>

type NumericSignalNameBrick = Brick<{
  params: undefined
  result: undefined
  signals: { 0: { request: undefined; response: string } }
}>

// @ts-expect-error dependency values must be Brick contracts
type InvalidDependencyBrick = Brick<{
  params: undefined
  result: undefined
  depends: { invalid: string }
}>

// @ts-expect-error signal definitions require request and response
type InvalidSignalBrick = Brick<{
  params: undefined
  result: undefined
  signals: { invalid: { request: string } }
}>

void (undefined as unknown as InvalidDependencyBrick)
void (undefined as unknown as InvalidSignalBrick)

type QuietBrick = Brick<{
  params: undefined
  result: number
}>

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false

type Expect<Value extends true> = Value

type _GetUserParams = Expect<Equal<ParamsOf<GetUserBrick>, { id: string }>>
type _GetUserResult = Expect<Equal<ResultOf<GetUserBrick>, { id: string }>>
type _GetUserErrors = Expect<
  Equal<ErrorsOf<GetUserBrick>, 'user-not-found' | { type: 'unavailable'; retryAfter: number }>
>
type _GetUserRequirements = Expect<
  Equal<
    RequirementsOf<GetUserBrick>,
    { users: { find(id: string): Promise<{ id: string } | undefined> } }
  >
>
type _GetProfileDependencies = Expect<
  Equal<DependenciesOf<GetProfileBrick>, { getUser: GetUserBrick }>
>
type _GetUserSignals = Expect<
  Equal<
    SignalsOf<GetUserBrick>,
    { refresh: { request: { force: boolean }; response: 'refreshed' } }
  >
>
type _QuietErrors = Expect<Equal<ErrorsOf<QuietBrick>, never>>
type _QuietRequirements = Expect<Equal<keyof RequirementsOf<QuietBrick>, never>>
type _QuietDependencies = Expect<Equal<keyof DependenciesOf<QuietBrick>, never>>
type _QuietSignals = Expect<Equal<keyof SignalsOf<QuietBrick>, never>>

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
  // @ts-expect-error params must match the Brick contract
  async ({ missing }) => ({ id: missing })
)

brick<GetUserBrick>(
  // @ts-expect-error handler result must match the Brick contract
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
