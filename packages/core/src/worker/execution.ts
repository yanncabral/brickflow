import { randomUUID } from 'node:crypto'
import type { Brick } from '../brick/contract'
import { failWith } from '../brick/failure'
import { executeBrickImplementation } from '../brick/implementation'
import type {
  AnyBrickImplementation,
  BrickImplementation,
  DependencyFunctions,
  EffectiveErrorsOf,
  ParamsOf,
  RequirementsOf,
  ResultOf
} from '../brick/types'
import { ExecutionContext } from '../engine/execution-context'
import type { EngineExecutionRequest, EngineStepRunner } from '../engine/types'
import { assertValidPathSegment } from '../path-segment'
import {
  emitPluginDefect,
  emitPluginFailure,
  emitPluginFinally,
  emitPluginSignal,
  emitPluginStart,
  emitPluginSuccess,
  wrapSignalFunctions
} from '../plugin/emit'
import type { BrickPlugin, BrickPluginContext, BrickPluginExit } from '../plugin/types'
import { createSignalFunctions } from '../signal/functions'
import { createSignalHandlerChain, resolveSignal } from '../signal/handler'
import { flattenNamespacedSignalHandlers } from '../signal/namespace'
import type { SignalHandlerChain, UnknownSignalHandlers } from '../signal/types'
import type { Worker } from './contract'
import { localWorker } from './local-worker'
import { createBrickRun } from './run'
import { toDurableStepName } from './step-name'
import type { BrickRun, RunMetadata } from './types'

export interface SuppliedDependencyNode {
  readonly brick?: AnyBrickImplementation
  readonly dependencies?: Readonly<Record<string, SuppliedDependencyNode>>
}

export interface ExecutionEntry {
  readonly id?: string
  readonly key: string
  readonly implementation: AnyBrickImplementation
  readonly suppliedDependencies?: Readonly<Record<string, SuppliedDependencyNode>>
  readonly suppliedPath?: readonly string[]
  readonly signalPath?: readonly string[]
  readonly ownSignalPath?: readonly string[]
}

interface ExecuteOptions<F extends Brick> {
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
  readonly plugins?: readonly BrickPlugin[]
  readonly isReplay?: boolean
  /** Snapshot of the request's late-bound step runner, taken when execute() runs. */
  readonly stepRunner?: EngineStepRunner | undefined
}

interface PluginScope {
  readonly inherited: readonly BrickPlugin[]
}

function mergePlugins(...groups: readonly (readonly BrickPlugin[])[]): readonly BrickPlugin[] {
  const merged: BrickPlugin[] = []
  for (const group of groups) {
    for (const plugin of group) {
      if (!merged.includes(plugin)) merged.push(plugin)
    }
  }
  return Object.freeze(merged)
}

function brickPluginsOf(implementation: AnyBrickImplementation): readonly BrickPlugin[] {
  const candidate: unknown = implementation
  if (typeof candidate !== 'object' || candidate === null) return []
  const plugins: unknown = (candidate as { readonly plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return []
  return plugins.filter(
    (plugin): plugin is BrickPlugin => typeof plugin === 'object' && plugin !== null
  )
}

function directSignalChain(handlers: Readonly<Record<string, unknown>>): SignalHandlerChain {
  return createSignalHandlerChain(flattenNamespacedSignalHandlers(handlers), undefined, true)
}

async function executeResolvedBrick<F extends Brick>(
  entry: ExecutionEntry,
  params: ParamsOf<F>,
  options: ExecuteOptions<F>,
  context: ExecutionContext,
  scope: PluginScope
) {
  const implementation = entry.implementation as unknown as BrickImplementation<F>
  const plugins = mergePlugins(scope.inherited, brickPluginsOf(entry.implementation))
  const pluginContext: BrickPluginContext = Object.freeze({
    ...(entry.id ? { brickId: entry.id } : {}),
    callId: context.callId,
    layerPath: context.layerPath,
    brickPath: context.brickPath,
    params,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    isReplay: options.isReplay ?? false
  })
  const dependencies = new Proxy(Object.create(null) as DependencyFunctions<F>, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      assertValidPathSegment(property)
      const dependencyEntry = options.resolveDependency(entry, property)
      return async (
        dependencyParams: unknown,
        callOptions?: {
          readonly signals?: Readonly<Record<string, unknown>>
          readonly plugins?: readonly BrickPlugin[]
        }
      ) => {
        const signalPath = dependencyEntry.signalPath ??
          dependencyEntry.suppliedPath ??
          dependencyEntry.id?.split('.') ?? [dependencyEntry.key]
        const layerPath = signalPath.slice(0, -1)
        const brickPath = [signalPath.at(-1) ?? dependencyEntry.key]
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
          brickPath,
          callId: context.callId,
          providers: context.providers,
          ...(localHandlers ? { signalHandlers: localHandlers } : {})
        })
        const outcome = await executeResolvedBrick(
          dependencyEntry,
          dependencyParams as never,
          options as ExecuteOptions<Brick>,
          dependencyContext,
          {
            inherited: mergePlugins(plugins, callOptions?.plugins ?? [])
          }
        )
        if (outcome.ok) return outcome.value
        return failWith(outcome.error as never)
      }
    }
  })
  const signalContext = entry.ownSignalPath
    ? new ExecutionContext({
        layerPath: entry.ownSignalPath.slice(0, -1),
        brickPath: [entry.ownSignalPath.at(-1) ?? entry.key],
        callId: context.callId,
        providers: context.providers,
        ...(context.signalHandlers ? { signalHandlers: context.signalHandlers } : {})
      })
    : context
  const signals = wrapSignalFunctions(
    createSignalFunctions(signalContext) as Parameters<typeof executeBrickImplementation<F>>[4] &
      object,
    (signal) => emitPluginSignal(plugins, pluginContext, signal)
  )
  // The stepped unit is exactly one Brick handler invocation, including its
  // plugin lifecycle: a durable runner that skips checkpointed steps emits
  // no plugin events for them either. Without a step runner this wrapper is
  // transparent and behavior matches unstepped execution exactly.
  const stepName = toDurableStepName(entry.id, context.callId)
  const invokeNode = async () => {
    let exit: BrickPluginExit | undefined
    try {
      await emitPluginStart(plugins, pluginContext)
      const outcome = await executeBrickImplementation(
        implementation,
        params,
        context.providers as RequirementsOf<F>,
        dependencies,
        signals
      )
      if (!outcome.ok) {
        exit = { kind: 'failure', error: outcome.error }
        await emitPluginFailure(plugins, pluginContext, outcome.error)
        return outcome
      }
      exit = { kind: 'success', value: outcome.value }
      await emitPluginSuccess(plugins, pluginContext, outcome.value)
      return outcome
    } catch (error) {
      if (exit === undefined) {
        exit = { kind: 'defect', error }
        await emitPluginDefect(plugins, pluginContext, error)
      }
      throw error
    } finally {
      if (exit !== undefined) await emitPluginFinally(plugins, pluginContext, exit)
    }
  }
  const stepRunner = options.stepRunner
  if (stepRunner) return stepRunner(stepName, invokeNode)
  return invokeNode()
}

export function executeBrick<F extends Brick>(
  options: ExecuteOptions<F>
): BrickRun<EffectiveErrorsOf<F>, ResultOf<F>> {
  const id = options.id ?? randomUUID()
  const handlers = options.signals ?? {}
  const boundary = options.directSignals
    ? directSignalChain(handlers)
    : createSignalHandlerChain(flattenNamespacedSignalHandlers(handlers), undefined, true)
  const rootId = options.root.id?.split('.') ?? []
  const context = new ExecutionContext({
    layerPath: rootId.slice(0, -1),
    brickPath: rootId.length > 0 ? [rootId.at(-1) as string] : [],
    callId: id,
    providers: options.providers,
    signalHandlers: boundary
  })
  const worker = options.worker ?? localWorker
  const scope: PluginScope = {
    inherited: mergePlugins(
      worker.plugins ?? [],
      brickPluginsOf(options.root.implementation),
      options.plugins ?? []
    )
  }
  const request: EngineExecutionRequest<ResultOf<F>, EffectiveErrorsOf<F>> = {
    id,
    ...(options.root.id ? { brickId: options.root.id } : {}),
    params: options.params,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    context,
    execute: () =>
      executeResolvedBrick(
        options.root,
        options.params,
        { ...options, stepRunner: request.step },
        context,
        scope
      ),
    signal: ({ name, request: signalRequest }) => resolveSignal(boundary, name, signalRequest)
  }
  return createBrickRun(worker.start(request))
}

function createSuppliedEntry(
  key: string,
  brick: AnyBrickImplementation,
  dependencies: Readonly<Record<string, SuppliedDependencyNode>> | undefined,
  path: readonly string[]
): ExecutionEntry {
  const id = [...path, key].join('.')
  return Object.freeze({
    id,
    key,
    implementation: brick,
    suppliedPath: Object.freeze([...path, key]),
    ...(dependencies ? { suppliedDependencies: dependencies } : {})
  })
}

export function runDirectBrick<F extends Brick>(
  implementation: BrickImplementation<F>,
  params: ParamsOf<F>,
  options?: Readonly<{
    requirements?: Readonly<Record<string, unknown>>
    dependencies?: Readonly<Record<string, SuppliedDependencyNode>>
    signals?: Readonly<Record<string, unknown>>
    worker?: Worker
    id?: string
    metadata?: RunMetadata
    plugins?: readonly BrickPlugin[]
    isReplay?: boolean
  }>
): BrickRun<EffectiveErrorsOf<F>, ResultOf<F>> {
  const root = Object.freeze({
    key: 'direct',
    implementation,
    ...(options?.dependencies ? { suppliedDependencies: options.dependencies } : {})
  })
  return executeBrick({
    root,
    entries: [root],
    params,
    providers: Object.freeze({ ...(options?.requirements ?? {}) }),
    resolveDependency: (caller, alias) => {
      const node = caller.suppliedDependencies?.[alias]
      if (!node?.brick) throw new Error(`Missing direct dependency Brick "${alias}"`)
      return createSuppliedEntry(alias, node.brick, node.dependencies, caller.id?.split('.') ?? [])
    },
    directSignals: true,
    ...(options?.signals ? { signals: options.signals } : {}),
    ...(options?.worker ? { worker: options.worker } : {}),
    ...(typeof options?.id === 'string' ? { id: options.id } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.plugins ? { plugins: options.plugins } : {}),
    ...(typeof options?.isReplay === 'boolean' ? { isReplay: options.isReplay } : {})
  })
}
