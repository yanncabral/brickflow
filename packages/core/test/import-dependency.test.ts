import { expect, test } from 'bun:test'
import { type Brick, brick, Layer, P } from '../src/index'

type AnkiImportInput = { fileName: string; fileBytes: Uint8Array }
type AnkiImportResult = { imported: number }
type ImportFailure = { type: 'import_failed' }
type ValidationFailure = { type: 'invalid_file_type' } | { type: 'file_too_large' }
interface ImportRepository {
  import(input: AnkiImportInput): Promise<AnkiImportResult | undefined>
}
type ImportBrick = Brick<{
  params: AnkiImportInput
  result: AnkiImportResult
  errors: ImportFailure
  requires: { repository: ImportRepository }
}>
type ImportRequestBrick = Brick<{
  params: AnkiImportInput
  result: AnkiImportResult
  errors: ValidationFailure
  depends: { importer: ImportBrick }
}>
const MAX_ANKI_IMPORT_BYTES = 10
const getAnkiExtension = (name: string) => name.endsWith('.apkg')
const importer = brick<ImportBrick>(async (input, { repository }, _depends, { fail }) => {
  const result = await repository.import(input)
  return result ?? fail({ type: 'import_failed' })
})
const importRequest = brick<ImportRequestBrick>(
  async (input, _requirements, { importer }, { fail }) => {
    if (!getAnkiExtension(input.fileName)) return fail({ type: 'invalid_file_type' })
    if (input.fileBytes.byteLength > MAX_ANKI_IMPORT_BYTES) return fail({ type: 'file_too_large' })
    return await importer(input)
  }
)
const input: AnkiImportInput = { fileName: 'cards.apkg', fileBytes: new Uint8Array(1) }
const dependencies = { importer: { brick: importer } }

test('native Brick dependencies return the import result directly', async () => {
  const repository: ImportRepository = { import: async () => ({ imported: 3 }) }
  const result = await importRequest(input, {
    requirements: { repository },
    dependencies
  }).onError(P._, () => null)
  expect(result).toEqual({ imported: 3 })
})

test('dependency failures propagate without being repeated in the parent contract', async () => {
  const repository: ImportRepository = { import: async () => undefined }
  const result = await importRequest(input, {
    requirements: { repository },
    dependencies
  }).onError(P._, (error) => error)
  expect(result).toEqual({ type: 'import_failed' })
})

test('request validation fails before calling the dependency', async () => {
  let imports = 0
  const repository: ImportRepository = {
    import: async () => {
      imports++
      return { imported: 3 }
    }
  }
  const invalidFile = await importRequest(
    { ...input, fileName: 'cards.txt' },
    {
      requirements: { repository },
      dependencies
    }
  ).onError(P._, (error) => error)
  const largeFile = await importRequest(
    { ...input, fileBytes: new Uint8Array(11) },
    {
      requirements: { repository },
      dependencies
    }
  ).onError(P._, (error) => error)
  expect(invalidFile).toEqual({ type: 'invalid_file_type' })
  expect(largeFile).toEqual({ type: 'file_too_large' })
  expect(imports).toBe(0)
})

test('unexpected import errors remain defects across dependency calls', async () => {
  const defect = new Error('unexpected import error')
  const repository: ImportRepository = {
    import: async () => {
      throw defect
    }
  }
  const result = importRequest(input, { requirements: { repository }, dependencies }).onError(
    P._,
    () => null
  )
  await expect(Promise.resolve(result)).rejects.toBe(defect)
})

test('Layers resolve the native dependency and its transitive requirements', async () => {
  const repository: ImportRepository = { import: async () => undefined }
  const imports = new Layer('imports', { importer, importRequest }).provide({ repository })
  expect(await imports.importRequest(input).onError(P._, (error) => error)).toEqual({
    type: 'import_failed'
  })
})

test('callable providers preserve identity through native dependency composition', async () => {
  const callback = () => 'progress'
  const lookup = new WeakMap([[callback, 'registered']])
  const callbacks = new Set([callback])
  const repository: ImportRepository = { import: async () => ({ imported: 3 }) }
  const parent = brick<
    Brick<{
      params: AnkiImportInput
      result: boolean
      requires: { callback: () => string }
      depends: { request: ImportRequestBrick }
    }>
  >(async (value, requirements, { request }) => {
    expect(requirements.callback).toBe(callback)
    expect(lookup.get(requirements.callback)).toBe('registered')
    await request(value)
    expect(requirements.callback).toBe(callback)
    return callbacks.delete(requirements.callback)
  })
  expect(
    await parent(input, {
      requirements: { callback, repository },
      dependencies: { request: { brick: importRequest, dependencies } }
    }).onError(P._, () => false)
  ).toBe(true)
})
