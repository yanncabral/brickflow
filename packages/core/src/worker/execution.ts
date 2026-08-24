import { randomUUID } from 'node:crypto'
import { ExecutionContext } from '../engine/execution-context'
import type { EngineExecutionRequest } from '../engine/types'
import type { Flow } from '../flow/contract'
import { failWith } from '../flow/failure'
import { executeFlowImplementation } from '../flow/implementation'
import type {
  AnyFlowImplementation,
  DependencyFunctions,
  EffectiveErrorsOf,
  FlowImplementation,
  ParamsOf,
  RequirementsOf,
  ResultOf
} from '../flow/types'
import { createSignalFunctions } from '../signal/functions'
import { createSignalHandlerChain, resolveSignal } from '../signal/handler'
import { flattenNamespacedSignalHandlers } from '../signal/namespace'
import type { SignalHandlerChain, UnknownSignalHandlers } from '../signal/types'
import type { Worker } from './contract'
import { localWorker } from './local-worker'
import { createFlowRun } from './run'
import type { FlowRun, RunMetadata } from './types'

export interface ExecutionEntry {
  readonly id?: string
  readonly key: string
  readonly implementation: AnyFlowImplementation
}

interface ExecuteOptions<F extends Flow> {
  readonly root: ExecutionEntry
  readonly entries: readonly ExecutionEntry[]
  readonly params: ParamsOf<F>
  readonly providers: Readonly<Record<string, unknown>>
  readonly resolveDependency: (caller: ExecutionEntry, alias: string) => ExecutionEntry
  readonly signals?: Readonly<Record<string, unknown>>
  readonly directSignals?: boolean
  readonly worker?: Worker
  readonly id?: string
  readonly metadata?: RunMetadata
}

function directSignalChain(handlers: Readonly<Record<string, unknown>>): SignalHandlerChain {
  const proxy = new Proxy(handlers as UnknownSignalHandlers, {
    get(target, property) {
      if (typeof property !== 'string') return undefined
      return target[property] ?? target[property.split('.').at(-1) ?? property]
    }
  })
  return Object.freeze({ handlers: proxy, boundary: true })
}

async function executeResolvedFlow<F extends Flow>(
  entry: ExecutionEntry,
  params: ParamsOf<F>,
  options: ExecuteOptions<F>,
  context: ExecutionContext
) {
  const implementation = entry.implementation as unknown as FlowImplementation<F>
  const dependencies = new Proxy(Object.create(null) as DependencyFunctions<F>, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      const dependencyEntry = options.resolveDependency(entry, property)
      return async (
        dependencyParams: unknown,
        callOptions?: { readonly signals?: Readonly<Record<string, unknown>> }
      ) => {
        const dependencyId = dependencyEntry.id?.split('.') ?? [dependencyEntry.key]
        const parentSignalHandlers = context.signalHandlers
        const localHandlers = callOptions?.signals
          ? createSignalHandlerChain(
              Object.fromEntries(
                Object.entries(callOptions.signals).map(([name, handler]) => [
                  [...dependencyId, name].join('.'),
                  handler
                ])
              ) as UnknownSignalHandlers,
              parentSignalHandlers,
              false
            )
          : parentSignalHandlers
        const dependencyContext = new ExecutionContext({
          layerPath: dependencyId.slice(0, -1),
          flowPath: [dependencyId.at(-1) ?? dependencyEntry.key],
          callId: context.callId,
          providers: context.providers,
          ...(localHandlers ? { signalHandlers: localHandlers } : {})
        })
        const outcome = await executeResolvedFlow(
          dependencyEntry,
          dependencyParams as never,
          options as ExecuteOptions<Flow>,
          dependencyContext
        )
        if (outcome.ok) return outcome.value
        return failWith(outcome.error as never)
      }
    }
  })
  const signals = createSignalFunctions(context) as Parameters<
    typeof executeFlowImplementation<F>
  >[4]
  return executeFlowImplementation(
    implementation,
    params,
    context.providers as RequirementsOf<F>,
    dependencies,
    signals
  )
}

export function executeFlow<F extends Flow>(
  options: ExecuteOptions<F>
): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>> {
  const id = options.id ?? randomUUID()
  const handlers = options.signals ?? {}
  const boundary = options.directSignals
    ? directSignalChain(handlers)
    : createSignalHandlerChain(flattenNamespacedSignalHandlers(handlers), undefined, true)
  const rootId = options.root.id?.split('.') ?? []
  const context = new ExecutionContext({
    layerPath: rootId.slice(0, -1),
    flowPath: rootId.length > 0 ? [rootId.at(-1) as string] : [],
    callId: id,
    providers: options.providers,
    signalHandlers: boundary
  })
  const request: EngineExecutionRequest<ResultOf<F>, EffectiveErrorsOf<F>> = {
    id,
    ...(options.root.id ? { flowId: options.root.id } : {}),
    params: options.params,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    context,
    execute: () => executeResolvedFlow(options.root, options.params, options, context),
    signal: ({ name, request: signalRequest }) => resolveSignal(boundary, name, signalRequest)
  }
  return createFlowRun((options.worker ?? localWorker).start(request))
}

export function runDirectFlow<F extends Flow>(
  implementation: FlowImplementation<F>,
  params: ParamsOf<F>,
  options?: Readonly<{
    requirements?: Readonly<Record<string, unknown>>
    dependencies?: Readonly<Record<string, AnyFlowImplementation>>
    signals?: Readonly<Record<string, unknown>>
    worker?: Worker
    id?: string
    metadata?: RunMetadata
  }>
): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>> {
  const dependencyEntries = Object.entries(options?.dependencies ?? {}).map(([key, dependency]) =>
    Object.freeze({ id: key, key, implementation: dependency })
  )
  const root = Object.freeze({ key: 'direct', implementation })
  return executeFlow({
    root,
    entries: [root, ...dependencyEntries],
    params,
    providers: Object.freeze({ ...(options?.requirements ?? {}) }),
    resolveDependency: (_caller, alias) => {
      const matches = dependencyEntries.filter((entry) => entry.key === alias)
      if (matches.length === 0) throw new Error(`Missing direct dependency Flow "${alias}"`)
      if (matches.length > 1) throw new Error(`Ambiguous direct dependency Flow "${alias}"`)
      return matches[0] as ExecutionEntry
    },
    directSignals: true,
    ...(options?.signals ? { signals: options.signals } : {}),
    ...(options?.worker ? { worker: options.worker } : {}),
    ...(typeof options?.id === 'string' ? { id: options.id } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {})
  })
}
