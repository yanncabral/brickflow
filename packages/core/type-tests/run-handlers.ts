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
brick<ForwardRead>(async (input, { reader }) => {
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
  const first: 'A' = await operation('a')
  const last: 'F' = await operation('f')
  const label: string = operation.label
  void last
  void label
  return first
})
