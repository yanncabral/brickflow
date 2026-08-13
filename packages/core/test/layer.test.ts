import { describe, expect, test } from 'bun:test'
import { type Flow, flow, Layer } from '../src/index'
import { flattenLayer, lookupLayer } from '../src/layer/composition'

interface GetUserFlow extends Flow {
  params: { id: string }
  result: { id: string }
  requires: { database: { find(id: string): string }; logger: { log(message: string): void } }
}

const getUser = flow<GetUserFlow>(({ id }) => ({ id }))

describe('Layer', () => {
  test('exposes immutable entries directly and stable nested durable IDs', () => {
    const users = new Layer('users', { getUser })
    const application = new Layer('application', { users })

    expect(users.id).toBe('users')
    expect(users.getUser).toBe(getUser)
    expect(application.users).toBe(users)
    expect(Object.isFrozen(users)).toBe(true)
    expect(flattenLayer(application).map(({ id }) => id)).toEqual(['application.users.getUser'])
    expect(lookupLayer(application, 'application.users.getUser')).toBe(getUser)
    expect(lookupLayer(application, 'application.missing')).toBeUndefined()
  })

  test('provides incrementally without mutating earlier layers', () => {
    const database = { find: (id: string) => id }
    const logger = { log: (_message: string) => undefined }
    const base = new Layer('users', { getUser })
    const withDatabase = base.provide({ database })
    const complete = withDatabase.provide({ logger })

    expect(base.providers).toEqual({})
    expect(withDatabase.providers).toEqual({ database })
    expect(complete.providers).toEqual({ database, logger })
    expect(base).not.toBe(withDatabase)
    expect(withDatabase).not.toBe(complete)
    expect(Object.isFrozen(complete.providers)).toBe(true)
  })

  test('overrides existing providers immutably', () => {
    const first = { find: (id: string) => id }
    const second = { find: (id: string) => `second-${id}` }
    const base = new Layer('users', { getUser }).provide({ database: first })
    const overridden = base.override({ database: second })

    expect(base.providers.database).toBe(first)
    expect(overridden.providers.database).toBe(second)
    expect(overridden).not.toBe(base)
  })

  test('rejects duplicate provides and absent overrides at runtime', () => {
    const layer = new Layer('users', { getUser }).provide({
      database: { find: (id: string) => id }
    })

    expect(() => layer.provide({ database: { find: (id: string) => id } } as never)).toThrow(
      /already provided.*database/i
    )
    expect(() => layer.override({ logger: { log: () => undefined } } as never)).toThrow(
      /cannot override.*logger/i
    )
  })

  test('rejects invalid entries and reserved entry names', () => {
    expect(() => new Layer('invalid', { value: {} } as never)).toThrow(
      /invalid layer entry.*value/i
    )
    expect(() => new Layer('invalid', { provide: getUser } as never)).toThrow(
      /reserved layer entry.*provide/i
    )
  })

  test('detects duplicate durable IDs from repeated nested layer IDs', () => {
    const first = new Layer('users', { getUser })
    const second = new Layer('users', { getUser })

    expect(() => new Layer('application', { first, second })).toThrow(
      /duplicate durable flow id.*application\.users\.getUser/i
    )
  })

  test('detects cyclic layer nesting with a readable path', () => {
    const cyclic = Object.create(Layer.prototype) as {
      id: string
      entries: Record<string, unknown>
      providers: Record<string, unknown>
    }
    cyclic.id = 'cyclic'
    cyclic.entries = { self: cyclic }
    cyclic.providers = {}

    expect(() => flattenLayer(cyclic as never)).toThrow(/cyclic layer nesting.*cyclic.*cyclic/i)
  })
})
