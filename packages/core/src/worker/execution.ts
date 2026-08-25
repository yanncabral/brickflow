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
import { assertValidPathSegment } from '../path-segment'
import { createSignalFunctions } from '../signal/functions'
import { createSignalHandlerChain, resolveSignal } from '../signal/handler'
import { flattenNamespacedSignalHandlers } from '../signal/namespace'
import type { SignalHandlerChain, UnknownSignalHandlers } from '../signal/types'
import type { Worker } from './contract'
import { localWorker } from './local-worker'
import { createFlowRun } from './run'
import type { FlowRun, RunMetadata } from './types'

export interface SuppliedDependencyNode {
  readonly flow?: AnyFlowImplementation
  readonly dependencies?: Readonly<Record<string, SuppliedDependencyNode>>
}

export interface ExecutionEntry {
  readonly id?: string
  readonly key: string
  readonly implementation: AnyFlowImplementation
  readonly suppliedDependencies?: Readonly<Record<string, SuppliedDependencyNode>>
  readonly suppliedPath?: readonly string[]
  readonly signalPath?: readonly string[]
  readonly ownSignalPath?: readonly string[]
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
  return createSignalHandlerChain(flattenNamespacedSignalHandlers(handlers), undefined, true)
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
      assertValidPathSegment(property)
      const dependencyEntry = options.resolveDependency(entry, property)
      return async (
        dependencyParams: unknown,
        callOptions?: { readonly signals?: Readonly<Record<string, unknown>> }
      ) => {
        const signalPath = dependencyEntry.signalPath ??
          dependencyEntry.suppliedPath ??
          dependencyEntry.id?.split('.') ?? [dependencyEntry.key]
        const layerPath = signalPath.slice(0, -1)
        const flowPath = [signalPath.at(-1) ?? dependencyEntry.key]
        const parentSignalHandlers = context.signalHandlers
        const localHandlers = callOptions?.signals
          ? createSignalHandlerChain(
              Object.fromEntries(
                Object.entries(callOptions.signals).map(([name, handler]) => {
                  assertValidPathSegment(name)
                  return [[...signalPath, name].join('.'), handler]
                })
              ) as UnknownSignalHandlers,
              parentSignalHandlers,
              false
            )
          : parentSignalHandlers
        const dependencyContext = new ExecutionContext({
          layerPath,
          flowPath,
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
  const signalContext = entry.ownSignalPath
    ? new ExecutionContext({
        layerPath: entry.ownSignalPath.slice(0, -1),
        flowPath: [entry.ownSignalPath.at(-1) ?? entry.key],
        callId: context.callId,
        providers: context.providers,
        ...(context.signalHandlers ? { signalHandlers: context.signalHandlers } : {})
      })
    : context
  const signals = createSignalFunctions(signalContext) as Parameters<
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

function createSuppliedEntry(
  key: string,
  flow: AnyFlowImplementation,
  dependencies: Readonly<Record<string, SuppliedDependencyNode>> | undefined,
  path: readonly string[]
): ExecutionEntry {
  const id = [...path, key].join('.')
  return Object.freeze({
    id,
    key,
    implementation: flow,
    suppliedPath: Object.freeze([...path, key]),
    ...(dependencies ? { suppliedDependencies: dependencies } : {})
  })
}

export function runDirectFlow<F extends Flow>(
  implementation: FlowImplementation<F>,
  params: ParamsOf<F>,
  options?: Readonly<{
    requirements?: Readonly<Record<string, unknown>>
    dependencies?: Readonly<Record<string, SuppliedDependencyNode>>
    signals?: Readonly<Record<string, unknown>>
    worker?: Worker
    id?: string
    metadata?: RunMetadata
  }>
): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>> {
  const root = Object.freeze({
    key: 'direct',
    implementation,
    ...(options?.dependencies ? { suppliedDependencies: options.dependencies } : {})
  })
  return executeFlow({
    root,
    entries: [root],
    params,
    providers: Object.freeze({ ...(options?.requirements ?? {}) }),
    resolveDependency: (caller, alias) => {
      const node = caller.suppliedDependencies?.[alias]
      if (!node?.flow) throw new Error(`Missing direct dependency Flow "${alias}"`)
      return createSuppliedEntry(alias, node.flow, node.dependencies, caller.id?.split('.') ?? [])
    },
    directSignals: true,
    ...(options?.signals ? { signals: options.signals } : {}),
    ...(options?.worker ? { worker: options.worker } : {}),
    ...(typeof options?.id === 'string' ? { id: options.id } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {})
  })
}
