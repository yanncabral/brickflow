import { type Brick, brick, Layer, P } from '../src/index'

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
