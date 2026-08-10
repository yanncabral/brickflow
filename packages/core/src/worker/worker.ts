import { randomUUID } from 'node:crypto'
import { ExecutionContext } from '../engine/execution-context'
import type { EngineExecutionRequest } from '../engine/types'
import { failWith } from '../flow/failure'
import { executeFlowImplementation } from '../flow/implementation'
import type {
  DependencyFunctions,
  EffectiveErrorsOf,
  EffectiveSignalsOf,
  FlowImplementation,
  FlowSpec,
  ParamsOf,
  RequirementsOf,
  ResultOf
} from '../flow/types'
import { effectiveLayerProviders, flattenLayer } from '../layer/composition'
import type { AnyLayer } from '../layer/types'
import { createSignalFunctions } from '../signal/functions'
import { createSignalHandlerChain, resolveSignal } from '../signal/handler'
import { flattenNamespacedSignalHandlers } from '../signal/namespace'
import type { UnknownSignalHandlers } from '../signal/types'
import { createFlowRun } from './run'
import type {
  FlowRun,
  WorkerConstructor,
  WorkerOptions,
  WorkerRunOptions,
  WorkerState
} from './types'

function findImplementationByContract(
  layer: AnyLayer,
  contract: unknown,
  alias: string
): ReturnType<typeof flattenLayer>[number] {
  const matches = flattenLayer(layer).filter((entry) => entry.implementation.contract === contract)
  if (matches.length === 0)
    throw new Error(`Missing dependency Flow "${alias}" in the configured Layer`)
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous dependency Flow "${alias}" resolved to multiple durable paths: ${matches
        .map(({ id }) => id)
        .join(', ')}`
    )
  }
  return matches[0] as ReturnType<typeof flattenLayer>[number]
}

function collectRequiredProviderKeys(
  root: FlowImplementation<never>,
  layer: AnyLayer,
  active = new Set<FlowImplementation<never>>(),
  collected = new Set<string>()
): readonly string[] {
  if (active.has(root)) throw new Error('Cyclic Flow dependency detected while resolving providers')
  active.add(root)
  for (const key of root.requires) collected.add(key)
  for (const [alias, dependency] of Object.entries(root.depends)) {
    const implementation = findImplementationByContract(layer, dependency, alias).implementation
    collectRequiredProviderKeys(
      implementation as unknown as FlowImplementation<never>,
      layer,
      active,
      collected
    )
  }
  active.delete(root)
  return [...collected]
}

function projectProviders<S extends FlowSpec>(
  implementation: FlowImplementation<S>,
  providers: Readonly<Record<string, unknown>>
): RequirementsOf<S> {
  return Object.freeze(
    Object.fromEntries(implementation.requires.map((key) => [key, providers[key]]))
  ) as RequirementsOf<S>
}

async function executeResolvedFlow<S extends FlowSpec>(
  implementation: FlowImplementation<S>,
  params: ParamsOf<S>,
  layer: AnyLayer,
  context: ExecutionContext
) {
  const dependencies = Object.fromEntries(
    Object.entries(implementation.depends).map(([alias, contract]) => {
      const dependencyEntry = findImplementationByContract(layer, contract, alias)
      return [
        alias,
        async (
          dependencyParams: unknown,
          callOptions?: { readonly signals?: Readonly<Record<string, unknown>> }
        ) => {
          const dependencyId = dependencyEntry.id.split('.')
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
            flowPath: [dependencyId.at(-1) ?? dependencyEntry.id],
            callId: context.callId,
            providers: context.providers,
            ...(localHandlers ? { signalHandlers: localHandlers } : {})
          })
          const outcome = await executeResolvedFlow(
            dependencyEntry.implementation,
            dependencyParams,
            layer,
            dependencyContext
          )
          if (outcome.ok) return outcome.value
          return failWith(outcome.error as never)
        }
      ]
    })
  ) as DependencyFunctions<S>
  const signals = createSignalFunctions(context) as Parameters<
    typeof executeFlowImplementation<S>
  >[4]

  return executeFlowImplementation(
    implementation,
    params,
    projectProviders(implementation, context.providers),
    dependencies,
    signals
  )
}

class WorkerImplementation<Layer extends AnyLayer> implements WorkerState<Layer> {
  readonly engine
  readonly layer: Layer

  constructor(options: WorkerOptions<Layer>) {
    this.engine = options.engine
    this.layer = options.layer
    effectiveLayerProviders(this.layer)
    Object.freeze(this)
  }

  run<S extends FlowSpec>(
    root: FlowImplementation<S>,
    params: ParamsOf<S>,
    ...optionArgs: keyof EffectiveSignalsOf<S> extends never
      ? readonly [options?: WorkerRunOptions<Layer, S>]
      : readonly [options: WorkerRunOptions<Layer, S>]
  ): FlowRun<EffectiveErrorsOf<S>, ResultOf<S>> {
    const rootEntries = flattenLayer(this.layer).filter(
      ({ implementation }) => implementation === root
    )
    if (rootEntries.length === 0)
      throw new Error('Root Flow is not present in the configured Layer')
    if (rootEntries.length > 1) {
      throw new Error(
        `Ambiguous root Flow is present at multiple durable paths: ${rootEntries
          .map(({ id }) => id)
          .join(', ')}`
      )
    }
    const entry = rootEntries[0] as (typeof rootEntries)[number]
    const providers = effectiveLayerProviders(this.layer)

    const requiredProviderKeys = collectRequiredProviderKeys(
      root as unknown as FlowImplementation<never>,
      this.layer
    )
    const missing = requiredProviderKeys.filter((key) => !Object.hasOwn(providers, key))
    if (missing.length > 0) throw new Error(`Missing Flow provider(s): ${missing.join(', ')}`)

    const options = optionArgs[0]
    const id = options?.id ?? randomUUID()
    const signalHandlers = (options as WorkerRunOptions<Layer, S> | undefined)?.signals as
      | Readonly<Record<string, unknown>>
      | undefined
    const boundary = createSignalHandlerChain(
      signalHandlers ? flattenNamespacedSignalHandlers(signalHandlers) : {},
      undefined,
      true
    )
    const context = new ExecutionContext({
      layerPath: entry.id.split('.').slice(0, -1),
      flowPath: [entry.id.split('.').at(-1) ?? entry.id],
      callId: id,
      providers,
      signalHandlers: boundary
    })
    const request: EngineExecutionRequest<ResultOf<S>, EffectiveErrorsOf<S>> = {
      id,
      flowId: entry.id,
      params,
      ...(options?.metadata ? { metadata: options.metadata } : {}),
      context,
      execute: () => executeResolvedFlow(root, params, this.layer, context),
      signal: ({ name, request: signalRequest }) => resolveSignal(boundary, name, signalRequest)
    }

    return createFlowRun(this.engine.start(request))
  }
}

export const Worker = WorkerImplementation as unknown as WorkerConstructor
