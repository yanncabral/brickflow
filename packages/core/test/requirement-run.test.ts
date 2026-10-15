import { expect, test } from 'bun:test'
import { type Brick, type BrickRun, brick, P, UnhandledBrickFailureError } from '../src/index'

type AnkiImportInput = { fileName: string; fileBytes: Uint8Array }
type AnkiImportResult = { imported: number }
type ImportFailure = { type: 'import_failed' }
type ImportRequestFailure =
  | ImportFailure
  | { type: 'invalid_file_type' }
  | { type: 'file_too_large' }
type ImportOperation = (input: AnkiImportInput) => BrickRun<ImportFailure, AnkiImportResult>
type ImportRequestBrick = Brick<{
  params: AnkiImportInput
  result: AnkiImportResult
  errors: ImportRequestFailure
  requires: { importer: ImportOperation }
}>
const MAX_ANKI_IMPORT_BYTES = 10
const getAnkiExtension = (name: string) => name.endsWith('.apkg')
const importRequestBrick = brick<ImportRequestBrick>(
  async (input, { importer }, _depends, { fail }) => {
    if (!getAnkiExtension(input.fileName)) return fail({ type: 'invalid_file_type' })
    if (input.fileBytes.byteLength > MAX_ANKI_IMPORT_BYTES) {
      return fail({ type: 'file_too_large' })
    }
    return await importer(input)
  }
)
const input: AnkiImportInput = { fileName: 'cards.apkg', fileBytes: new Uint8Array(1) }
const importer = brick<
  Brick<{
    params: AnkiImportInput
    result: AnkiImportResult
    errors: ImportFailure
  }>
>((_input, _requirements, _depends, { fail }) => fail({ type: 'import_failed' }))

test('awaiting a required operation propagates its typed failure to the outer run', async () => {
  const result = await importRequestBrick(input, { requirements: { importer } }).onError(
    P._,
    (error) => error
  )
  expect(result).toEqual({ type: 'import_failed' })
})

test('required operations return successes directly', async () => {
  const result = await importRequestBrick(input, {
    requirements: {
      importer: brick<
        Brick<{ params: AnkiImportInput; result: AnkiImportResult; errors: ImportFailure }>
      >(() => ({ imported: 3 }))
    }
  }).onError(P._, () => null)
  expect(result).toEqual({ imported: 3 })
})

test('request validation still fails before invoking the importer', async () => {
  for (const [invalid, type] of [
    [{ ...input, fileName: 'cards.txt' }, 'invalid_file_type'],
    [{ ...input, fileBytes: new Uint8Array(11) }, 'file_too_large']
  ] as const) {
    const result = await importRequestBrick(invalid, { requirements: { importer } }).onError(
      P._,
      (error) => error
    )
    expect(result).toEqual({ type })
  }
})

test('unexpected importer errors remain defects', async () => {
  const defect = new Error('unexpected importer defect')
  const run = importRequestBrick(input, {
    requirements: {
      importer: () => {
        throw defect
      }
    }
  }).onError(P._, () => null)
  await expect(Promise.resolve(run)).rejects.toBe(defect)
})

test('unhandled failures outside handlers still reject with the boundary error', async () => {
  await expect(
    Promise.resolve(importer(input) as unknown as PromiseLike<AnkiImportResult>)
  ).rejects.toBeInstanceOf(UnhandledBrickFailureError)
})

for (const insideFirst of [false, true]) {
  test(`shared runs preserve consumption boundaries (inside first: ${insideFirst})`, async () => {
    const shared = importer(input)
    const outside = async () => {
      await expect(
        Promise.resolve(shared as unknown as PromiseLike<AnkiImportResult>)
      ).rejects.toBeInstanceOf(UnhandledBrickFailureError)
    }
    const inside = async () => {
      expect(
        await importRequestBrick(input, {
          requirements: { importer: () => shared }
        }).onError(P._, (error) => error)
      ).toEqual({ type: 'import_failed' })
    }
    if (insideFirst) {
      await inside()
      await outside()
    } else {
      await outside()
      await inside()
    }
  })
}

test('explicit recovery and success handlers remain supported inside handlers', async () => {
  const wrapper = brick<ImportRequestBrick>(
    async (value, { importer }) =>
      await importer(value)
        .onError(P._, () => ({ imported: 2 }))
        .onSuccess(() => ({ imported: 1 }))
  )
  expect(await wrapper(input, { requirements: { importer } }).onError(P._, () => null)).toEqual({
    imported: 2
  })
})
