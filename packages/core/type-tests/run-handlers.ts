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

const partial = initial.onFailure({ type: 'missing' }, (error) => {
  const id: string = error.id
  return { ok: false as const, id }
})
// @ts-expect-error denied is still unhandled
await partial
// @ts-expect-error already handled failures cannot be registered twice
partial.onFailure({ type: 'missing' }, () => 'duplicate')

const complete = partial.onFailure({ type: 'denied' }, () => {
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

const before: string | number = await initial
  .onSuccess((asset) => asset.id)
  .onFailure(P._, () => 404)
void before
const after: string | number = await initial.with(P._, () => 404).onSuccess((asset) => asset.id)
void after

// Recovery and success may originally have identical types: neither can be lost.
const overlapping = initial.onFailure(P._, () => ({ id: 'fallback' }))
const retained: number | { id: string } = await overlapping.onSuccess(() => 1)
// @ts-expect-error recovered objects remain possible after transforming success
const onlySuccess: number = retained
void onlySuccess
void retained

const conditional = initial.onFailure(P._, () => (Math.random() ? 'fallback' : undefined))
// @ts-expect-error undefined leaves failures unhandled
await conditional
// @ts-expect-error success callbacks receive the original Brick result
initial.onSuccess((asset: number) => asset)
// @ts-expect-error patterns must belong to the remaining failure union
initial.onFailure({ type: 'other' }, () => 404)

const layer = new Layer('assets', { read })
const bound = await layer.read({ id: 'asset' }).onFailure(P._, () => null)
const value: { id: string } | null = bound
void value
// @ts-expect-error callable bound Bricks validate params
layer.read({ id: 1 })
// @ts-expect-error callable direct Bricks validate params
read({ id: 1 })
