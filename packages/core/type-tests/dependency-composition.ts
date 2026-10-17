import { type Brick, type BrickRun, brick, P } from '../src/index'

type ChildFailure = { type: 'import_failed' }
type ImportBrick = Brick<{ params: string; result: number; errors: ChildFailure }>
const importer = brick<ImportBrick>((_input, _requires, _depends, { fail }) =>
  fail({ type: 'import_failed' })
)
type RequestBrick = Brick<{
  params: string
  result: number
  errors: { type: 'invalid_file_type' }
  depends: { importer: ImportBrick }
}>
const request = brick<RequestBrick>(async (input, _requires, { importer }) => {
  const result: number = await importer(input)
  return result
})
const initial = request('cards.apkg', { dependencies: { importer: { brick: importer } } })
const ownHandled = initial.onError({ type: 'invalid_file_type' }, () => 0)
// @ts-expect-error dependency failures remain in the effective error union
await ownHandled
const complete: number = await ownHandled.onError({ type: 'import_failed' }, (error) => {
  const failure: ChildFailure = error
  void failure
  return -1
})
void complete

type Operation = (input: string) => BrickRun<ChildFailure, number>
brick<
  Brick<{
    params: string
    result: number
    errors: ChildFailure
    requires: { operation: Operation }
  }>
>(async (input, { operation }, _depends, { fail }) => {
  // @ts-expect-error requires supplies the original provider, not a contextual dependency
  await operation(input)
  return await operation(input).onError(P._, fail)
})
