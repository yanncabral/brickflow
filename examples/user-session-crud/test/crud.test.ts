import { describe, expect, test } from 'bun:test'
import { runCrudExample } from '../src'

describe('vertical-sliced user/session CRUD', () => {
  test('composes user and session Layers', async () => {
    const result = await runCrudExample()
    expect(result.user.email).toBe('ada@example.com')
    expect(result.session.revokedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(result.users).toHaveLength(1)
  })
})
