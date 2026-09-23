import { randomUUID } from 'node:crypto'
import { createTracingPlugin, InMemoryTracer } from '@brickflow/plugin-otel'
import { type Brick, brick, Layer } from 'brickflow'

/**
 * Traced parent→child Brick graph.
 *
 * Instrumentation uses the real `BrickPlugin` hooks: each run passes
 * `plugins: [createTracingPlugin(tracer)]` and core opens one span per Brick,
 * nests the child under the parent, records typed failures as a
 * `brick.failure` event (span errors with `brick.outcome=typed-failure`),
 * defects as `brick.defect`, and signals as `signal.<name>` events.
 * History: `docs/superpowers/plans/2026-09-23-brick-otel-tracing-plan.md`.
 */

interface User {
  readonly id: string
  readonly name: string
}

interface UserRepository {
  find(id: string): Promise<User | undefined>
}

export type GetUserBrick = Brick<{
  params: { id: string }
  result: User
  errors: 'user-not-found'
  requires: { userRepository: UserRepository }
}>

export type GetGreetingBrick = Brick<{
  params: { id: string }
  result: { message: string; approved: boolean }
  depends: { getUser: GetUserBrick }
  signals: {
    approve: {
      request: { message: string }
      response: { approved: boolean }
    }
  }
}>

function buildApp(userRepository: UserRepository) {
  const getUser = brick<GetUserBrick>(async ({ id }, { userRepository: repo }, _deps, { fail }) => {
    const user = await repo.find(id)
    if (!user) return fail('user-not-found')
    return user
  })

  const getGreeting = brick<GetGreetingBrick>(async ({ id }, _reqs, { getUser }, { signals }) => {
    const user = await getUser({ id })
    const approval = await signals.approve({ message: `Hello, ${user.name}!` })
    return { message: `Hello, ${user.name}!`, approved: approval.approved }
  })

  return new Layer('app', { getUser, getGreeting }).provide({ userRepository })
}

function approveSignals() {
  return {
    signals: {
      app: {
        getGreeting: {
          approve: (request: { message: string }) => ({ approved: request.message.length > 0 })
        }
      }
    }
  }
}

export async function runGreetingTrace() {
  const tracer = new InMemoryTracer()
  const callId = randomUUID()
  const stored = new Map<string, User>([['ada-secret-id', { id: 'ada-secret-id', name: 'Ada' }]])
  const app = buildApp({ find: async (id) => stored.get(id) })
  const greeting = await app.getGreeting
    .run(
      { id: 'ada-secret-id' },
      { ...approveSignals(), id: callId, plugins: [createTracingPlugin(tracer)] }
    )
    .with('user-not-found', () => {
      throw new Error('unexpected missing user for ada-secret-id')
    })
  return { greeting, tracer, callId }
}

export async function runMissingUserTrace() {
  const tracer = new InMemoryTracer()
  const callId = randomUUID()
  const app = buildApp({ find: async (_id) => undefined })
  const recovered = await app.getGreeting
    .run(
      { id: 'ghost' },
      { ...approveSignals(), id: callId, plugins: [createTracingPlugin(tracer)] }
    )
    .with('user-not-found', () => ({ message: 'Hello, stranger!', approved: false }))
  return { recovered, tracer, callId }
}

export async function runDefectTrace() {
  const tracer = new InMemoryTracer()
  const callId = randomUUID()
  const app = buildApp({
    find: async (_id) => {
      throw new TypeError('boom')
    }
  })
  try {
    await app.getGreeting
      .run(
        { id: 'ada-secret-id' },
        { ...approveSignals(), id: callId, plugins: [createTracingPlugin(tracer)] }
      )
      .with('user-not-found', () => {
        throw new Error('unexpected typed failure in defect scenario')
      })
  } catch (error) {
    return { defect: error, tracer, callId }
  }
  throw new Error('expected the defect trace to reject')
}

if (import.meta.main) {
  const { greeting, tracer } = await runGreetingTrace()
  console.log(JSON.stringify({ greeting, finishedSpans: tracer.spans().length }, null, 2))
}
