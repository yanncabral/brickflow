import { describe, expect, test } from 'bun:test'
import { P } from '../src/index'
import { createMatchingBuilder } from '../src/matching/builder'

type Failure = 'missing' | { type: 'unavailable'; retryAfter: number }

const failed = (error: Failure) => async () => ({ ok: false as const, error })

describe('matching builders', () => {
  test('recovers literal failures', async () => {
    const result = await createMatchingBuilder(failed('missing')).with('missing', () => 'fallback')
    expect(result).toEqual({ ok: true, value: 'fallback' })
  })

  test('matches partial objects using ts-pattern semantics', async () => {
    const result = await createMatchingBuilder(
      failed({ type: 'unavailable', retryAfter: 30 })
    ).with({ type: 'unavailable' }, (error) => `retry-${error.retryAfter}`)
    expect(result).toEqual({ ok: true, value: 'retry-30' })
  })

  test('uses the first matching handler and propagates when it returns undefined', async () => {
    const calls: string[] = []
    const result = await createMatchingBuilder(failed('missing'))
      .with(P._, () => {
        calls.push('first')
        return undefined
      })
      .with(P._, () => {
        calls.push('second')
        return 'fallback'
      })

    expect(result as unknown).toEqual({ ok: false, error: 'missing' })
    expect(calls).toEqual(['first'])
  })

  test('supports asynchronous recovery handlers', async () => {
    const result = await createMatchingBuilder(failed('missing')).with(P._, async () => 'async')
    expect(result).toEqual({ ok: true, value: 'async' })
  })

  test('is immutable and memoizes each builder execution', async () => {
    let executions = 0
    const base = createMatchingBuilder<Failure, string>(async () => {
      executions += 1
      return { ok: false, error: 'missing' }
    })
    const recovered = base.with('missing', () => 'fallback')

    expect(await recovered).toEqual({ ok: true, value: 'fallback' })
    expect(await recovered).toEqual({ ok: true, value: 'fallback' })
    expect(executions).toBe(1)
    expect(await base).toEqual({ ok: false, error: 'missing' })
    expect(executions).toBe(2)
  })

  test('rejects unexpected defects', async () => {
    const defect = new Error('boom')
    const builder = createMatchingBuilder<Failure, string>(async () => {
      throw defect
    })
    await expect(Promise.resolve(builder)).rejects.toBe(defect)
  })
})
