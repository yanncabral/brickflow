import { describe, expect, test } from 'bun:test'
import { type Brick, brick, Layer, LocalWorker, P, UnhandledBrickFailureError } from '../src/index'

type Read = Brick<{
  params: { missing: boolean }
  result: { id: string }
  errors: { type: 'missing'; id: string }
}>

const read = brick<Read>(({ missing }, _requirements, _dependencies, { fail }) =>
  missing ? fail({ type: 'missing', id: 'asset' }) : { id: 'asset' }
)

describe('Brick run handlers', () => {
  test('transforms only original successes regardless of handler order', async () => {
    for (const missing of [false, true]) {
      const initial = read.run({ missing })
      const success = async (asset: { id: string }) => ({ ok: true as const, asset })
      const failure = () => ({ ok: false as const, response: 404 })
      const before = initial.onSuccess(success).onError({ type: 'missing' }, failure)
      const after = initial.onError({ type: 'missing' }, failure).onSuccess(success)
      const expected = missing
        ? { ok: false as const, response: 404 }
        : { ok: true as const, asset: { id: 'asset' } }
      expect(await before).toEqual(expected)
      expect(await after).toEqual(expected)
    }
  })

  test('memoizes async success handlers and keeps derived chains independent', async () => {
    let calls = 0
    const original = read.run({ missing: false }).onError(P._, () => 'fallback')
    const mapped = original.onSuccess(async (asset) => {
      calls++
      return asset.id
    })
    expect(await mapped).toBe('asset')
    expect(await mapped).toBe('asset')
    expect(calls).toBe(1)
    expect(await original).toEqual({ id: 'asset' })
  })

  test('preserves the published onFailure alias alongside onError', async () => {
    const run = read({ missing: true }).onSuccess((asset) => asset.id)
    expect(await run.onFailure({ type: 'missing' }, (error) => error.id)).toBe('asset')
    expect(await run.onError({ type: 'missing' }, (error) => error.id)).toBe('asset')
  })

  test('preserves with as an alias and permits undefined success results', async () => {
    expect(
      await read
        .run({ missing: true })
        .onSuccess(() => undefined)
        .with(P._, () => 404)
    ).toBe(404)
    expect(
      await read
        .run({ missing: false })
        .with(P._, () => 404)
        .onSuccess(() => undefined)
    ).toBeUndefined()
  })

  test('leaves undefined recoveries unhandled and skips success handlers on failures', async () => {
    let successCalls = 0
    let laterCalls = 0
    const run = read
      .run({ missing: true })
      .onSuccess(() => {
        successCalls++
        return 'success'
      })
      .onError(P._, async () => undefined)
      .with(P._, () => {
        laterCalls++
        return 'fallback'
      })
    await expect(Promise.resolve(run)).rejects.toBeInstanceOf(UnhandledBrickFailureError)
    expect(successCalls).toBe(0)
    expect(laterCalls).toBe(0)
    expect(await read.run({ missing: true }).onError(P._, async (error) => error.id)).toBe('asset')
  })

  test('replaces success handlers without composing transformations', async () => {
    let replacedCalls = 0
    const original = read
      .run({ missing: false })
      .onError(P._, () => 404)
      .onSuccess(() => {
        replacedCalls++
        return 'first'
      })
    const replacement = original.onSuccess((asset) => asset.id.length)
    expect(await replacement).toBe(5)
    expect(replacedCalls).toBe(0)
    expect(await original).toBe('first')
    expect(replacedCalls).toBe(1)
  })

  test('propagates defects from execution and both handler kinds', async () => {
    const defective = brick<Brick<{ params: undefined; result: string }>>(() => {
      throw new Error('execution defect')
    })
    await expect(
      Promise.resolve(defective.run(undefined).onSuccess(() => 'unused'))
    ).rejects.toThrow('execution defect')
    const onSuccess = read
      .run({ missing: false })
      .onError(P._, () => 404)
      .onSuccess(() => {
        throw new Error('success defect')
      })
    await expect(Promise.resolve(onSuccess)).rejects.toThrow('success defect')
    const onError = read.run({ missing: true }).onError(P._, () => {
      throw new Error('failure defect')
    })
    await expect(Promise.resolve(onError)).rejects.toThrow('failure defect')
  })
})

describe('callable Bricks', () => {
  test('supports direct calls and run with identical execution controls', async () => {
    const worker = new LocalWorker()
    const direct = read({ missing: false }, { worker, id: 'direct' }).onError(P._, () => null)
    const explicit = read
      .run({ missing: false }, { worker, id: 'explicit' })
      .onError(P._, () => null)
    expect(direct.id).toBe('direct')
    expect(await direct).toEqual(await explicit)
    expect(await direct.status()).toBe('completed')
    expect(Object.isFrozen(read)).toBe(true)
    expect(read.run).toBe(read)
  })

  test('preserves providers, graph resolution, signals and durable paths in nested Layers', async () => {
    type Child = Brick<{ params: undefined; result: string; requires: { prefix: string } }>
    type Parent = Brick<{
      params: undefined
      result: string
      depends: { child: Child }
      signals: { suffix: { request: string; response: string } }
    }>
    const child = brick<Child>((_params, { prefix }) => prefix)
    const parent = brick<Parent>(async (_params, _requirements, { child }, { signals }) =>
      signals.suffix(await child(undefined))
    )
    const app = new Layer('app', { nested: new Layer('nested', { parent, child }) }).provide({
      prefix: 'hello'
    })
    const options = {
      signals: { app: { nested: { parent: { suffix: (value: string) => `${value}!` } } } }
    }
    expect(await app.nested.parent(undefined, options)).toBe('hello!')
    expect(await app.nested.parent.run(undefined, options)).toBe('hello!')
    expect(Object.isFrozen(app.nested.parent)).toBe(true)
    expect(app.nested.parent.run).toBe(app.nested.parent)
  })
})
