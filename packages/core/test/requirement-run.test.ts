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

for (const rejects of [false, true]) {
  test(`detached work loses propagation scope after handler settles (rejects: ${rejects})`, async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let detached!: Promise<unknown>
    const defect = new Error('parent defect')
    const parent = brick<Brick<{ params: undefined; result: string }>>(() => {
      detached = gate.then(async () => {
        try {
          await (importer(input) as unknown as PromiseLike<AnkiImportResult>)
        } catch (error) {
          return error
        }
        return undefined
      })
      if (rejects) throw defect
      return 'done'
    })
    if (rejects) await expect(Promise.resolve(parent(undefined))).rejects.toBe(defect)
    else expect(await parent(undefined)).toBe('done')
    release()
    expect(await detached).toBeInstanceOf(UnhandledBrickFailureError)
  })
}

test('pending detached consumption checks scope activity when the failure arrives', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const delayed = brick<
    Brick<{
      params: undefined
      result: number
      errors: ImportFailure
    }>
  >(async (_input, _requirements, _depends, { fail }) => {
    await gate
    return fail({ type: 'import_failed' })
  })
  let detached!: Promise<unknown>
  const parent = brick<Brick<{ params: undefined; result: string }>>(() => {
    detached = Promise.resolve(delayed(undefined) as unknown as PromiseLike<number>).catch(
      (error: unknown) => error
    )
    return 'done'
  })
  expect(await parent(undefined)).toBe('done')
  release()
  expect(await detached).toBeInstanceOf(UnhandledBrickFailureError)
})

test('detached consumption exposes a boundary error while its parent is still active', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let report!: (error: unknown) => void
  const observed = new Promise<unknown>((resolve) => {
    report = resolve
  })
  const parent = brick<Brick<{ params: undefined; result: string }>>(async () => {
    void Promise.resolve(importer(input) as unknown as PromiseLike<AnkiImportResult>).catch(report)
    await gate
    return 'done'
  })
  const run = parent(undefined)
  const result = Promise.resolve(run)
  try {
    const error = await observed
    expect(await run.status()).toBe('running')
    expect(error).toBeInstanceOf(UnhandledBrickFailureError)
    expect((error as UnhandledBrickFailureError).failure).toEqual({ type: 'import_failed' })
    const unrelated = importRequestBrick(input, {
      requirements: {
        importer: () => {
          throw error
        }
      }
    }).onError(P._, () => null)
    await expect(Promise.resolve(unrelated)).rejects.toBe(error)
  } finally {
    release()
    expect(await result).toBe('done')
  }
})

test('manually thrown boundary errors remain defects inside handlers', async () => {
  const defect = new UnhandledBrickFailureError({ type: 'import_failed' })
  const run = importRequestBrick(input, {
    requirements: {
      importer: () => {
        throw defect
      }
    }
  }).onError(P._, () => null)
  await expect(Promise.resolve(run)).rejects.toBe(defect)
})
