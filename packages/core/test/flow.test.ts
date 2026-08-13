import { describe, expect, test } from 'bun:test'
import { executeFlowImplementation, isFlowImplementation } from '../src/flow/implementation'
import { type Flow, flow } from '../src/index'

interface User {
  id: string
}

interface UserRepository {
  find(id: string): Promise<User | undefined>
}

interface GetUserFlow extends Flow {
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { users: UserRepository }
}

interface SignaledFlow extends Flow {
  params: { value: string }
  result: string
  signals: { refresh: { request: { force: boolean }; response: 'refreshed' } }
}

describe('Flow implementations', () => {
  test('creates immutable, distinct implementations for the same Flow interface', () => {
    const first = flow<GetUserFlow>(async ({ id }) => ({ id }))
    const second = flow<GetUserFlow>(async ({ id }) => ({ id: `second-${id}` }))

    expect(first).not.toBe(second)
    expect(isFlowImplementation(first)).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
  })

  test('stores only the handler as enumerable runtime metadata', () => {
    const handler = async ({ id }: GetUserFlow['params']) => ({ id })
    const implementation = flow<GetUserFlow>(handler)

    expect(Object.keys(implementation)).toEqual(['handler'])
    expect(implementation.handler).toBe(handler)
  })

  test('rejects structural lookalikes as Flow implementations', () => {
    const implementation = flow<GetUserFlow>(async ({ id }) => ({ id }))
    const lookalike = { handler: implementation.handler }

    expect(isFlowImplementation(lookalike)).toBe(false)
  })

  test('rejects objects that inherit a Flow implementation brand', () => {
    const implementation = flow<GetUserFlow>(async ({ id }) => ({ id }))
    const inheritor = Object.create(implementation)

    expect(isFlowImplementation(inheritor)).toBe(false)
  })

  test('executes a handler with params, requirements, dependencies, and tools', async () => {
    const users: UserRepository = {
      async find(id) {
        return { id }
      }
    }
    const implementation = flow<GetUserFlow>(async ({ id }, requirements, dependencies, tools) => {
      expect(dependencies).toEqual({})
      expect(tools.signals).toEqual({})
      const user = await requirements.users.find(id)
      return user ?? tools.fail('user-not-found')
    })

    const outcome = await executeFlowImplementation(implementation, { id: 'u1' }, { users }, {}, {})

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
    const implementation = flow<SignaledFlow>(
      async ({ value }, _requirements, _dependencies, tools) => {
        const response = await tools.signals.refresh({ force: value === 'u1' })
        expect(response).toBe('refreshed')
        return response
      }
    )

    const outcome = await executeFlowImplementation(
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
    const implementation = flow<GetUserFlow>((_params, _requirements, _dependencies, { fail }) =>
      fail('user-not-found')
    )

    const outcome = await executeFlowImplementation(
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
    const implementation = flow<GetUserFlow>(() => {
      throw defect
    })

    await expect(
      executeFlowImplementation(
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
