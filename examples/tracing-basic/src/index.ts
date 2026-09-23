import { randomUUID } from 'node:crypto'
import { type Brick, brick, Layer } from 'brickflow'
import {
  type ActiveSpan,
  createTracingPlugin,
  failureShapeOf,
  InMemoryTracer,
  type TracingPlugin
} from './tracing'

/**
 * Traced parent→child Brick graph.
 *
 * Manual instrumentation mirrors the proposed `BrickPlugin` hooks
 * (`docs/superpowers/plans/2026-09-23-brick-otel-tracing-plan.md`): each Brick
 * opens one span, the child nests under the parent via async context, typed
 * failures record `brick.failure` (span stays non-error), defects record
 * `brick.defect` (span errors), and signals record request/response events.
 * Core hook call sites (subagent A) will automate this with the same mapping.
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

function childFailed(tracer: InMemoryTracer, brickId: string): boolean {
  return tracer.spans.some(
    (span) => span.attributes['brick.id'] === brickId && span.status === 'failure'
  )
}

function buildApp(plugin: TracingPlugin, callId: string, userRepository: UserRepository) {
  const getUser = brick<GetUserBrick>(async ({ id }, { userRepository: repo }, _deps, { fail }) => {
    return plugin.traceBrick(
      {
        brickId: 'app.getUser',
        callId,
        layerPath: ['app'],
        brickPath: ['getUser'],
        params: { id }
      },
      async (span) => {
        const user = await repo.find(id)
        if (!user) {
          span.recordFailure(failureShapeOf('user-not-found'))
          span.end('failure')
          return fail('user-not-found')
        }
        return user
      }
    )
  })

  const getGreeting = brick<GetGreetingBrick>(async ({ id }, _reqs, { getUser }, { signals }) => {
    return plugin.traceBrick(
      {
        brickId: 'app.getGreeting',
        callId,
        layerPath: ['app'],
        brickPath: ['getGreeting'],
        params: { id }
      },
      async (span: ActiveSpan) => {
        try {
          const user = await getUser({ id })
          const approval = await plugin.traceSignal(
            { name: 'approve', path: 'app.getGreeting.approve' },
            async () => signals.approve({ message: `Hello, ${user.name}!` })
          )
          return { message: `Hello, ${user.name}!`, approved: approval.approved }
        } catch (error) {
          // Manual cascade until core hooks classify outcomes: a child that
          // already ended `failure` means a propagated typed failure, so the
          // parent records `brick.failure` too instead of `brick.defect`.
          if (childFailed(plugin.tracer, 'app.getUser')) {
            span.recordFailure(failureShapeOf('user-not-found'))
            span.end('failure')
          }
          throw error
        }
      }
    )
  })

  const app = new Layer('app', { getUser, getGreeting }).provide({ userRepository })
  return { app }
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
  const plugin = createTracingPlugin(tracer)
  const callId = randomUUID()
  const stored = new Map<string, User>([['ada-secret-id', { id: 'ada-secret-id', name: 'Ada' }]])
  const { app } = buildApp(plugin, callId, { find: async (id) => stored.get(id) })
  const greeting = await app.getGreeting
    .run({ id: 'ada-secret-id' }, approveSignals())
    .with('user-not-found', () => {
      throw new Error('unexpected missing user for ada-secret-id')
    })
  return { greeting, tracer, callId }
}

export async function runMissingUserTrace() {
  const tracer = new InMemoryTracer()
  const plugin = createTracingPlugin(tracer)
  const callId = randomUUID()
  const { app } = buildApp(plugin, callId, { find: async (_id) => undefined })
  const recovered = await app.getGreeting
    .run({ id: 'ghost' }, approveSignals())
    .with('user-not-found', () => ({ message: 'Hello, stranger!', approved: false }))
  return { recovered, tracer, callId }
}

export async function runDefectTrace() {
  const tracer = new InMemoryTracer()
  const plugin = createTracingPlugin(tracer)
  const callId = randomUUID()
  const { app } = buildApp(plugin, callId, {
    find: async (_id) => {
      throw new TypeError('boom')
    }
  })
  try {
    await app.getGreeting
      .run({ id: 'ada-secret-id' }, approveSignals())
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
  console.log(JSON.stringify({ greeting, finishedSpans: tracer.spans.length }, null, 2))
}
