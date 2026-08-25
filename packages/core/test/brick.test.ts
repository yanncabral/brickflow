import { describe, expect, test } from 'bun:test'
import { executeBrickImplementation, isBrickImplementation } from '../src/brick/implementation'
import { type Brick, brick } from '../src/index'

interface User {
  id: string
}

interface UserRepository {
  find(id: string): Promise<User | undefined>
}

interface GetUserBrick extends Brick {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { users: UserRepository }
}

interface SignaledBrick extends Brick {
  params: { value: string }
  result: string
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}

describe('Brick implementations', () => {
  test('creates immutable, distinct implementations for the same Brick interface', () => {
    const first = brick<GetUserBrick>(async ({ id }) => ({ id }))
    const second = brick<GetUserBrick>(async ({ id }) => ({ id: `second-${id}` }))

    expect(first).not.toBe(second)
    expect(isBrickImplementation(first)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
  })

  test('stores only the handler as enumerable runtime metadata', () => {
    const handler = async ({ id }: GetUserBrick['params']) => ({ id })
    const implementation = brick<GetUserBrick>(handler)

    expect(Object.keys(implementation)).toEqual(['handler'])
    expect(implementation.handler).toBe(handler)
  })

  test('rejects structural lookalikes as Brick implementations', () => {
    const implementation = brick<GetUserBrick>(async ({ id }) => ({ id }))
    const lookalike = { handler: implementation.handler }

    expect(isBrickImplementation(lookalike)).toBe(false)
  })

  test('rejects objects that inherit a Brick implementation brand', () => {
    const implementation = brick<GetUserBrick>(async ({ id }) => ({ id }))
    const inheritor = Object.create(implementation)

    expect(isBrickImplementation(inheritor)).toBe(false)
  })

  test('executes a handler with params, requirements, dependencies, and tools', async () => {
    const users: UserRepository = {
      async find(id) {
        return { id }
      }
    }
    const implementation = brick<GetUserBrick>(
      async ({ id }, requirements, dependencies, tools) => {
        expect(dependencies).toEqual({})
        expect(tools.signals).toEqual({})
        const user = await requirements.users.find(id)
        return user ?? tools.fail('user-not-found')
      }
    )

    const outcome = await executeBrickImplementation(
      implementation,
      { id: 'u1' },
      { users },
      {},
      {}
    )

    expect(outcome).toEqual({ ok: true, value: { id: 'u1' } })
  })

  test('invokes declared signals and receives their runtime responses', async () => {
    const requests: { force: boolean }[] = []
    const signals = {
      refresh: async (request: { force: boolean }) => {
        requests.push(request)
        return 'refreshed' as const
      }
    }
    const implementation = brick<SignaledBrick>(
      async ({ value }, _requirements, _dependencies, tools) => {
        const response = await tools.signals.refresh({ force: value === 'u1' })
        expect(response).toBe('refreshed')
        return response
      }
    )

    const outcome = await executeBrickImplementation(
      implementation,
      { value: 'u1' },
      {},
      {},
      signals
    )

    expect(requests).toEqual([{ force: true }])
    expect(outcome).toEqual({ ok: true, value: 'refreshed' })
  })

  test('distinguishes typed failures from successful results', async () => {
    const implementation = brick<GetUserBrick>((_params, _requirements, _dependencies, { fail }) =>
      fail('user-not-found')
    )

    const outcome = await executeBrickImplementation(
      implementation,
      { id: 'missing' },
      {
        users: {
          async find() {
            return undefined
          }
        }
      },
      {},
      {}
    )

    expect(outcome).toEqual({ ok: false, error: 'user-not-found' })
  })

  test('does not convert unexpected defects into typed failures', async () => {
    const defect = new Error('database exploded')
    const implementation = brick<GetUserBrick>(() => {
      throw defect
    })

    await expect(
      executeBrickImplementation(
        implementation,
        { id: 'u1' },
        {
          users: {
            async find() {
              return undefined
            }
          }
        },
        {},
        {}
      )
    ).rejects.toBe(defect)
  })
})
