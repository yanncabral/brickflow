import { type Brick, type BrickRun, brick, Layer, P } from '../src/index'

type Read = Brick<{
  params: { id: string }
  result: { id: string }
  errors: { type: 'missing'; id: string } | { type: 'denied' }
}>
const read = brick<Read>(({ id }) => ({ id }))
const initial = read({ id: 'asset' })
// @ts-expect-error failures must be handled before awaiting
await initial.onSuccess((asset) => asset.id)

const partial = initial.onError({ type: 'missing' }, (error) => {
  const id: string = error.id
  return { ok: false as const, id }
})
// @ts-expect-error denied is still unhandled
await partial
// @ts-expect-error already handled failures cannot be registered twice
partial.onError({ type: 'missing' }, () => 'duplicate')

const complete = partial.onError({ type: 'denied' }, () => {
  throw new Error('denied')
})
const result = await complete.onSuccess(async (asset) => ({ ok: true as const, asset }))
if (result.ok) {
  const asset: { id: string } = result.asset
  void asset
} else {
  const id: string = result.id
  void id
}

const before: string | number = await initial.onSuccess((asset) => asset.id).onError(P._, () => 404)
void before
const after: string | number = await initial.with(P._, () => 404).onSuccess((asset) => asset.id)
void after

// Recovery and success may originally have identical types: neither can be lost.
const overlapping = initial.onError(P._, () => ({ id: 'fallback' }))
const retained: number | { id: string } = await overlapping.onSuccess(() => 1)
// @ts-expect-error recovered objects remain possible after transforming success
const onlySuccess: number = retained
void onlySuccess
void retained

const conditional = initial.onError(P._, () => (Math.random() ? 'fallback' : undefined))
// @ts-expect-error undefined leaves failures unhandled
await conditional
// @ts-expect-error success callbacks receive the original Brick result
initial.onSuccess((asset: number) => asset)
// @ts-expect-error patterns must belong to the remaining failure union
initial.onError({ type: 'other' }, () => 404)

const layer = new Layer('assets', { read })
const bound = await layer.read({ id: 'asset' }).onError(P._, () => null)
const value: { id: string } | null = bound
void value
// @ts-expect-error callable bound Bricks validate params
layer.read({ id: 1 })
// @ts-expect-error callable direct Bricks validate params
read({ id: 1 })

// The published alias keeps the same narrowing and exhaustiveness as onError.
const legacy = initial.onFailure({ type: 'missing' }, (error) => error.id)
// @ts-expect-error denied remains unhandled through the compatibility alias
await legacy
const mixed: { id: string } | string | number = await legacy.onError({ type: 'denied' }, () => 403)
void mixed

// Required operations may propagate failures declared by the enclosing Brick.
type ReadOperation = (input: { id: string }) => ReturnType<typeof read>
type ForwardRead = Brick<{
  params: { id: string }
  result: { id: string }
  errors: Read['errors']
  requires: { reader: ReadOperation }
}>
const acceptReadOperation = (operation: ReadOperation) => operation
brick<ForwardRead>(async (input, { reader }) => {
  const original: ReadOperation = reader
  const object: { reader: ReadOperation } = { reader }
  acceptReadOperation(reader)
  void original
  void object
  const user: { id: string } = await reader(input)
  return user
})

brick<
  Brick<{
    params: { id: string }
    result: { id: string }
    errors: { type: 'missing'; id: string }
    requires: { reader: ReadOperation }
  }>
>(async (input, { reader }) => {
  // @ts-expect-error denied is not declared by the enclosing Brick
  await reader(input)
  return { id: input.id }
})

// Injection retains the original operation contract and external exhaustiveness.
const forwardRead = brick<ForwardRead>(async (input, { reader }) => await reader(input))
const forwarded = forwardRead({ id: 'asset' }, { requirements: { reader: read } })
// @ts-expect-error the external caller still has to handle the failures
await forwarded

// Unrelated generic providers retain their signatures.
brick<
  Brick<{
    params: undefined
    result: number
    requires: { identity: <Value>(value: Value) => Value }
  }>
>((_input, { identity }) => {
  const value: number = identity(1)
  return value
})

// Generic operations keep the relationship between their input and result.
type GenericReadOperation = <Value>(value: Value) => BrickRun<Read['errors'], Value>
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { operation: GenericReadOperation }
  }>
>(async (_input, { operation }) => {
  const original: GenericReadOperation = operation
  void original
  const text: string = await operation('hello')
  const count: number = await operation(1)
  void count
  return text
})

// All overloads remain callable, with their respective result types.
type OverloadedReadOperation = {
  (value: string): BrickRun<Read['errors'], string>
  (value: number): BrickRun<Read['errors'], number>
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { operation: OverloadedReadOperation }
  }>
>(async (_input, { operation }) => {
  const original: OverloadedReadOperation = operation
  const object: { operation: OverloadedReadOperation } = { operation }
  const acceptOperation = (value: OverloadedReadOperation) => value
  acceptOperation(operation)
  void original
  void object
  const text: string = await operation('hello')
  const count: number = await operation(1)
  // @ts-expect-error invalid arguments remain invalid
  operation(true)
  void count
  return text
})

// More complex generic operations retain their original call and handler signatures.
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: {
      wrap: <Value>(value: Value) => BrickRun<Read['errors'], { value: Value }>
    }
  }>
>(async (_input, { wrap }) => {
  const text: string = await wrap('hello')
    .onError(P._, () => 'fallback')
    .onSuccess((result) => result.value)
  return text
})

// Constrained generic operations preserve refinements and reject invalid inputs.
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: {
      operation: <Value extends { id: string }>(value: Value) => BrickRun<Read['errors'], Value>
    }
  }>
>(async (_input, { operation }) => {
  const result = await operation({ id: 'asset', label: 'hello' })
  const label: string = result.label
  // @ts-expect-error the generic constraint is preserved
  operation(1)
  return label
})

// Contextual awaitability never narrows a monomorphic operation to its input literal.
brick<
  Brick<{
    params: undefined
    result: number
    errors: Read['errors']
    requires: { operation: (value: number) => BrickRun<Read['errors'], number> }
  }>
>(async (_input, { operation }) => {
  const value = await operation(1)
  // @ts-expect-error the operation can return any number
  const literal: 1 = value
  void literal
  return value
})

type ManyOverloads = {
  (value: 'a'): BrickRun<Read['errors'], 'A'>
  (value: 'b'): BrickRun<Read['errors'], 'B'>
  (value: 'c'): BrickRun<Read['errors'], 'C'>
  (value: 'd'): BrickRun<Read['errors'], 'D'>
  (value: 'e'): BrickRun<Read['errors'], 'E'>
  (value: 'f'): BrickRun<Read['errors'], 'F'>
  readonly label: string
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { operation: ManyOverloads }
  }>
>(async (_input, { operation }) => {
  const original: ManyOverloads = operation
  void original
  const first: 'A' = await operation('a')
  const last: 'F' = await operation('f')
  const label: string = operation.label
  void last
  void label
  return first
})

// A generic signature remains usable alongside a concrete overload, in either order.
type GenericFirstOperation = {
  <Value>(value: Value): BrickRun<Read['errors'], Value>
  (value: 'special'): BrickRun<Read['errors'], 42>
}
type GenericLastOperation = {
  (value: 'special'): BrickRun<Read['errors'], 42>
  <Value>(value: Value): BrickRun<Read['errors'], Value>
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { first: GenericFirstOperation; last: GenericLastOperation }
  }>
>(async (_input, { first, last }) => {
  const firstText: string = await first('text')
  const lastText: string = await last('text')
  const firstNumber: number = await first(1)
  const lastNumber: number = await last(1)
  const firstSpecial: 42 = await first('special')
  const lastSpecial: 42 = await last('special')
  const firstRecovered: string = await first('text').onError(P._, () => 'fallback')
  const lastRecovered: string = await last('text').onError(P._, () => 'fallback')
  const originalFirst: GenericFirstOperation = first
  const originalLast: GenericLastOperation = last
  void lastText
  void firstNumber
  void lastNumber
  void firstSpecial
  void lastSpecial
  void firstRecovered
  void lastRecovered
  void originalFirst
  void originalLast
  return firstText
})

// An unknown-valued overload is not a generic identity operation.
type UnknownOperation = {
  (value: unknown): BrickRun<Read['errors'], unknown>
  (value: 'special'): BrickRun<Read['errors'], 42>
}
brick<
  Brick<{
    params: undefined
    result: unknown
    errors: Read['errors']
    requires: { operation: UnknownOperation }
  }>
>(async (_input, { operation }) => {
  const result = await operation('text')
  // @ts-expect-error an unknown result must not acquire the input type
  const text: string = result
  void text
  return result
})

// A mixed operation still requires handling failures absent from the enclosing contract.
brick<
  Brick<{
    params: undefined
    result: undefined
    errors: { type: 'missing'; id: string }
    requires: { operation: GenericFirstOperation }
  }>
>(async (_input, { operation }) => {
  // @ts-expect-error denied cannot propagate through this Brick's declared errors
  await operation('text')
  return undefined
})

type ConstrainedGenericFirst = {
  <Value extends { id: string }>(value: Value): BrickRun<Read['errors'], Value>
  (value: 'special'): BrickRun<Read['errors'], 42>
}
type ConstrainedGenericLast = {
  (value: 'special'): BrickRun<Read['errors'], 42>
  <Value extends { id: string }>(value: Value): BrickRun<Read['errors'], Value>
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { first: ConstrainedGenericFirst; last: ConstrainedGenericLast }
  }>
>(async (_input, { first, last }) => {
  const firstValue = await first({ id: 'x', label: 'y' })
  const lastValue = await last({ id: 'x', label: 'y' })
  const firstLabel: string = firstValue.label
  const lastLabel: string = lastValue.label
  const firstSpecial: 42 = await first('special')
  const lastSpecial: 42 = await last('special')
  const recovered = await first({ id: 'x', label: 'y' }).onError(P._, () => ({
    id: 'fallback',
    label: 'fallback'
  }))
  const recoveredLabel: string = recovered.label
  const originalFirst: ConstrainedGenericFirst = first
  const originalLast: ConstrainedGenericLast = last
  // @ts-expect-error an unrelated argument does not satisfy the generic constraint
  first(1)
  // @ts-expect-error the required id remains mandatory
  last({ label: 'y' })
  void lastLabel
  void firstSpecial
  void lastSpecial
  void recoveredLabel
  void originalFirst
  void originalLast
  return firstLabel
})

// Non-identity generic overloads retain their original explicit-handler inference.
type WrappedFirst = {
  <Value>(value: Value): BrickRun<Read['errors'], { value: Value }>
  (value: 'special'): BrickRun<Read['errors'], 42>
}
type WrappedLast = {
  (value: 'special'): BrickRun<Read['errors'], 42>
  <Value>(value: Value): BrickRun<Read['errors'], { value: Value }>
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { first: WrappedFirst; last: WrappedLast }
  }>
>(async (_input, { first, last }) => {
  const firstText: string = await first('text')
    .onError(P._, () => 'fallback')
    .onSuccess((result) => result.value)
  const lastText: string = await last('text')
    .onError(P._, () => 'fallback')
    .onSuccess((result) => result.value)
  const firstNumber: number = await first(1)
    .onError(P._, () => 0)
    .onSuccess((result) => result.value)
  const special: 42 = await first('special').onError(P._, () => 42 as const)
  const originalFirst: WrappedFirst = first
  const originalLast: WrappedLast = last
  void lastText
  void firstNumber
  void special
  void originalFirst
  void originalLast
  return firstText
})

// Eligibility belongs to each overload, irrespective of the last return type.
type OtherFailure = { type: 'other' }
type SafeFirst = {
  (value: 'safe'): BrickRun<Read['errors'], string>
  (value: 'other'): BrickRun<OtherFailure, number>
}
type SafeLast = {
  (value: 'other'): BrickRun<OtherFailure, number>
  (value: 'safe'): BrickRun<Read['errors'], string>
}
type PlainLast = {
  (value: 'safe'): BrickRun<Read['errors'], string>
  (value: 'plain'): number
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { first: SafeFirst; last: SafeLast; plain: PlainLast }
  }>
>(async (_input, { first, last, plain }) => {
  const firstText: string = await first('safe')
  const lastText: string = await last('safe')
  const plainText: string = await plain('safe')
  const number: number = plain('plain')
  // @ts-expect-error other failures must still be handled explicitly
  await first('other')
  // @ts-expect-error declaration order cannot permit undeclared failures
  await last('other')
  const recovered: number = await first('other').onError(P._, () => 0)
  const originalFirst: SafeFirst = first
  const originalLast: SafeLast = last
  void lastText
  void plainText
  void number
  void recovered
  void originalFirst
  void originalLast
  return firstText
})

// An undeclared generic failure cannot disable a safe concrete overload.
type UnsafeGenericFirst = {
  <Value>(value: Value): BrickRun<OtherFailure, Value>
  (value: 'safe'): BrickRun<Read['errors'], string>
}
type UnsafeGenericLast = {
  (value: 'safe'): BrickRun<Read['errors'], string>
  <Value>(value: Value): BrickRun<OtherFailure, Value>
}
brick<
  Brick<{
    params: undefined
    result: string
    errors: Read['errors']
    requires: { first: UnsafeGenericFirst; last: UnsafeGenericLast }
  }>
>(async (_input, { first, last }) => {
  const text: string = await first('safe')
  const otherText: string = await last('safe')
  // @ts-expect-error the generic overload still has an undeclared failure
  await first(1)
  // @ts-expect-error order cannot permit the generic failure
  await last(1)
  const recovered: number = await first(1).onError(P._, () => 0)
  void otherText
  void recovered
  return text
})
