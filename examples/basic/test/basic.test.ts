import { describe, expect, test } from 'bun:test'
import { runBasicExample } from '../src/index'

describe('runBasicExample', () => {
  test('returns a greeting for an existing user', async () => {
    const output = await runBasicExample()

    expect(output.success).toEqual({ message: 'Hello, Ada!' })
  })

  test('recovers from a missing user with a typed error match', async () => {
    const output = await runBasicExample()

    expect(output.recovered).toEqual({ message: 'Hello, mysterious stranger!' })
  })

  test('handles a structural approval signal through the worker boundary', async () => {
    const output = await runBasicExample()

    expect(output.approval).toEqual({ message: 'Hello, Ada!', approved: true })
    expect(output.approvalRequests).toEqual([{ message: 'Hello, Ada!' }])
  })
})
