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

test('binding a shared run preserves consumption memoization across handler boundaries', async () => {
  let successes = 0
  const successful = brick<
    Brick<{
      params: AnkiImportInput
      result: AnkiImportResult
      errors: ImportFailure
    }>
  >(() => ({ imported: 3 }))
  const shared = successful(input).onSuccess((value) => {
    successes++
    return value
  })
  expect(await (shared as unknown as PromiseLike<AnkiImportResult>)).toEqual({ imported: 3 })
  const result = await importRequestBrick(input, {
    requirements: { importer: () => shared }
  }).onError(P._, () => null)
  expect(result).toEqual({ imported: 3 })
  expect(successes).toBe(1)
})

test('required operations remain bound after an asynchronous pause in the handler', async () => {
  const wrapper = brick<ImportRequestBrick>(async (value, { importer }) => {
    await Promise.resolve()
    return await importer(value)
  })
  expect(
    await wrapper(input, { requirements: { importer } }).onError(P._, (error) => error)
  ).toEqual({ type: 'import_failed' })
})

// Forwarding a run's public contract does not preserve private class identity.
function structuralImportRun(run: ReturnType<ImportOperation>): ReturnType<ImportOperation> {
  return {
    ...run,
    status: run.status.bind(run),
    cancel: run.cancel.bind(run),
    onSuccess: run.onSuccess.bind(run),
    onError: run.onError.bind(run),
    onFailure: run.onFailure.bind(run),
    with: run.with.bind(run),
    // biome-ignore lint/suspicious/noThenProperty: forward the BrickRun thenable contract
    then: run.then.bind(run)
  }
}

test('a structurally compatible run propagates declared failures', async () => {
  const run = importRequestBrick(input, {
    requirements: { importer: () => structuralImportRun(importer(input)) }
  })
  expect(await run.onError(P._, (error) => error)).toEqual({ type: 'import_failed' })
})

test('structural runs preserve failures left unhandled by existing handlers', async () => {
  const run = importRequestBrick(input, {
    requirements: {
      importer: () => structuralImportRun(importer(input).onError(P._, () => undefined))
    }
  })
  expect(await run.onError(P._, (error) => error)).toEqual({ type: 'import_failed' })
})

test('structural binding preserves the original chain memoization and controls', async () => {
  let successes = 0
  const successful = brick<
    Brick<{ params: AnkiImportInput; result: AnkiImportResult; errors: ImportFailure }>
  >(() => ({ imported: 3 }))
  const original = successful(input).onSuccess((result) => {
    successes++
    return result
  })
  const shared = structuralImportRun(original)
  expect(await (shared as unknown as PromiseLike<AnkiImportResult>)).toEqual({ imported: 3 })
  const parent = brick<ImportRequestBrick>(async (value, { importer }) => {
    const run = importer(value)
    expect(run.id).toBe(original.id)
    expect(await run.status()).toBe('completed')
    return await run
  })
  expect(
    await parent(input, { requirements: { importer: () => shared } }).onError(P._, () => null)
  ).toEqual({ imported: 3 })
  expect(successes).toBe(1)
})

test('manually thrown boundary errors remain defects through structural runs', async () => {
  const defect = new UnhandledBrickFailureError({ type: 'import_failed' })
  const broken = brick<
    Brick<{ params: AnkiImportInput; result: AnkiImportResult; errors: ImportFailure }>
  >(() => {
    throw defect
  })
  const run = importRequestBrick(input, {
    requirements: { importer: () => structuralImportRun(broken(input)) }
  })
  await expect(Promise.resolve(run.onError(P._, () => null))).rejects.toBe(defect)
})

test('a separate runtime copy propagates failures and retains explicit chaining', async () => {
  const source = await Bun.file(new URL('../src/worker/run.ts', import.meta.url)).text()
  const compiled = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(source)
    .replace(/(['"])ts-pattern\1/g, JSON.stringify(import.meta.resolve('ts-pattern')))
  const path = `/tmp/brickflow-run-copy-${crypto.randomUUID()}.mjs`
  await Bun.write(path, compiled)
  try {
    const namespace: unknown = await import(path)
    const foreign = namespace as typeof import('../src/worker/run')
    expect(foreign.UnhandledBrickFailureError).not.toBe(UnhandledBrickFailureError)
    const foreignImporter: ImportOperation = () =>
      foreign.createBrickRun<ImportFailure, AnkiImportResult>({
        id: crypto.randomUUID(),
        result: Promise.resolve({ ok: false, error: { type: 'import_failed' } }),
        status: async () => 'failed',
        cancel: async () => {},
        signal: async () => undefined
      })
    const run = importRequestBrick(input, { requirements: { importer: foreignImporter } })
    expect(await run.onError(P._, (error) => error)).toEqual({ type: 'import_failed' })
    const recovered = brick<ImportRequestBrick>(async (value, { importer }) => {
      return await importer(value)
        .onError(P._, () => ({ imported: 2 }))
        .onSuccess((result) => result)
    })
    expect(
      await recovered(input, { requirements: { importer: foreignImporter } }).onError(
        P._,
        () => null
      )
    ).toEqual({ imported: 2 })
  } finally {
    await Bun.file(path).delete()
  }
})

test('a boundary error rethrown by another structural execution remains a defect', async () => {
  const originalFailure: unknown = await Promise.resolve(
    importer(input) as unknown as PromiseLike<AnkiImportResult>
  ).catch((error: unknown) => error)
  const broken = brick<
    Brick<{
      params: AnkiImportInput
      result: AnkiImportResult
      errors: ImportFailure
    }>
  >(() => {
    throw originalFailure
  })
  const run = importRequestBrick(input, {
    requirements: {
      importer: () => structuralImportRun(broken(input))
    }
  }).onError(P._, () => null)
  await expect(Promise.resolve(run)).rejects.toBe(originalFailure)
})

test('structural runs without shared protocol metadata use their public failure handlers', async () => {
  const plainRun = structuralImportRun(importer(input))
  for (const key of Object.getOwnPropertySymbols(plainRun)) Reflect.deleteProperty(plainRun, key)
  const run = importRequestBrick(input, { requirements: { importer: () => plainRun } })
  expect(await run.onError(P._, (error) => error)).toEqual({ type: 'import_failed' })
})

test('a detached structural failure remains a public boundary error after settlement', async () => {
  let report!: (error: unknown) => void
  const observed = new Promise<unknown>((resolve) => {
    report = resolve
  })
  const parent = brick<ImportRequestBrick>((value, { importer }) => {
    void Promise.resolve(importer(value) as unknown as PromiseLike<AnkiImportResult>).catch(report)
    return { imported: 0 }
  })
  const run = parent(input, {
    requirements: { importer: () => structuralImportRun(importer(input)) }
  })
  expect(await run.onError(P._, () => null)).toEqual({ imported: 0 })
  expect(await observed).toBeInstanceOf(UnhandledBrickFailureError)
})

// This public-contract wrapper hides metadata on the root and every derived run.
function hideRunProtocol<Run extends object>(run: Run): Run {
  return new Proxy(Object.create(null) as Run, {
    get(_target, key) {
      if (typeof key === 'symbol') return undefined
      const value: unknown = Reflect.get(run, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, run, args)
        if (
          ['onError', 'onSuccess', 'onFailure', 'with'].includes(key) &&
          typeof result === 'object' &&
          result !== null
        )
          return hideRunProtocol(result)
        return result
      }
    }
  })
}

test('protocol-less derived chains propagate failures left unhandled by an earlier match', async () => {
  const hidden = hideRunProtocol(importer(input).onError(P._, () => undefined))
  const run = importRequestBrick(input, { requirements: { importer: () => hidden } })
  expect(await run.onError(P._, (error) => error)).toEqual({ type: 'import_failed' })
})

test('protocol-less derived chains preserve explicit recovery and callback defects', async () => {
  const recovered = hideRunProtocol(importer(input).onError(P._, () => ({ imported: 7 })))
  const recoverParent = brick<
    Brick<{
      params: AnkiImportInput
      result: AnkiImportResult
      errors: ImportFailure
      requires: { operation: () => typeof recovered }
    }>
  >(async (_input, { operation }) => await operation())
  expect(
    await recoverParent(input, { requirements: { operation: () => recovered } }).onError(
      P._,
      () => null
    )
  ).toEqual({ imported: 7 })
  const emitted: unknown = await Promise.resolve(
    importer(input) as unknown as PromiseLike<AnkiImportResult>
  ).catch((error: unknown) => error)
  for (const defect of [new UnhandledBrickFailureError({ type: 'import_failed' }), emitted]) {
    const broken = hideRunProtocol(
      importer(input).onError(P._, (): undefined => {
        throw defect
      })
    )
    const run = importRequestBrick(input, { requirements: { importer: () => broken } }).onError(
      P._,
      () => null
    )
    await expect(Promise.resolve(run)).rejects.toBe(defect)
  }
})
