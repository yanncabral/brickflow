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
    expect(users.getUser).not.toBe(getUser)
    expect(users.getUser.handler).toBe(getUser.handler)
    expect(application.users).not.toBe(users)
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

  test('overrides nested effective providers at the outer layer without mutation', async () => {
    interface ReadUserFlow extends Flow {
      params: { id: string }
      result: string
      requires: { repository: { get(id: string): string } }
    }

    const readUser = flow<ReadUserFlow>(({ id }, { repository }) => repository.get(id))
    const postgres = { get: (id: string) => `postgres-${id}` }
    const memory = { get: (id: string) => `memory-${id}` }
    const users = new Layer('users', { readUser }).provide({ repository: postgres })
    const app = new Layer('app', { users })
    const testApp = app.override({ repository: memory })

    expect(await app.users.readUser.run({ id: '1' })).toBe('postgres-1')
    expect(await testApp.users.readUser.run({ id: '1' })).toBe('memory-1')
    expect(testApp.providers).toEqual({ repository: memory })
    expect(app.providers).toEqual({})
    expect(users.providers).toEqual({ repository: postgres })
  })

  test('outer overrides resolve conflicting nested providers without mutating originals', async () => {
    interface ReadUserFlow extends Flow {
      params: { id: string }
      result: string
      requires: { repository: { get(id: string): string } }
    }

    const readUser = flow<ReadUserFlow>(({ id }, { repository }) => repository.get(id))
    const firstRepository = { get: (id: string) => `first-${id}` }
    const secondRepository = { get: (id: string) => `second-${id}` }
    const replacement = { get: (id: string) => `replacement-${id}` }
    const first = new Layer('first', { readUser }).provide({ repository: firstRepository })
    const second = new Layer('second', { readUser }).provide({ repository: secondRepository })
    const app = new Layer('app', { first, second })
    const overridden = app.override({ repository: replacement })

    expect(overridden.providers.repository).toBe(replacement)
    expect(await overridden.first.readUser.run({ id: '1' })).toBe('replacement-1')
    expect(await overridden.second.readUser.run({ id: '1' })).toBe('replacement-1')
    expect(app.providers).toEqual({})
    expect(first.providers.repository).toBe(firstRepository)
    expect(second.providers.repository).toBe(secondRepository)
  })

  test('rejects truly absent outer overrides at runtime', () => {
    const users = new Layer('users', { getUser }).provide({
      database: { find: (id: string) => id }
    })
    const app = new Layer('app', { users })

    expect(() => app.override({ missing: true } as never)).toThrow(
      /cannot override absent provider key.*missing/i
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

  test('rejects empty Layer IDs and entry keys', () => {
    expect(() => new Layer('' as never, { getUser } as never)).toThrow(
      /invalid path segment.*must not be empty/i
    )
    expect(() => new Layer('users', { '': getUser } as never)).toThrow(
      /invalid path segment.*must not be empty/i
    )
  })

  test('rejects dotted Layer IDs and entry keys because dot is reserved', () => {
    expect(() => new Layer('invalid.id' as never, { getUser } as never)).toThrow(
      /invalid path segment.*invalid\.id.*\.\W.*reserved delimiter/i
    )
    expect(() => new Layer('users', { 'get.user': getUser } as never)).toThrow(
      /invalid path segment.*get\.user.*\.\W.*reserved delimiter/i
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
