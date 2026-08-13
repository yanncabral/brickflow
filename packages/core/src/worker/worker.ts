import { randomUUID } from 'node:crypto'
import { ExecutionContext } from '../engine/execution-context'
import type { EngineExecutionRequest } from '../engine/types'
import type { Flow } from '../flow/contract'
import { failWith } from '../flow/failure'
import { executeFlowImplementation } from '../flow/implementation'
import type {
  DependencyFunctions,
  EffectiveErrorsOf,
  EffectiveSignalsOf,
  FlowImplementation,
  ParamsOf,
  RequirementsOf,
  ResultOf
} from '../flow/types'
import { effectiveLayerProviders, flattenLayer, resolveLayerDependency } from '../layer/composition'
import type { AnyLayer, FlattenedLayerEntry } from '../layer/types'
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

async function executeResolvedFlow<F extends Flow>(
  entry: FlattenedLayerEntry,
  params: ParamsOf<F>,
  layer: AnyLayer,
  context: ExecutionContext
) {
  const implementation = entry.implementation as FlowImplementation<F>
  const dependencies = new Proxy(Object.create(null) as DependencyFunctions<F>, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      const dependencyEntry = resolveLayerDependency(layer, entry, property)
      return async (
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
          dependencyEntry,
          dependencyParams,
          layer,
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

class WorkerImplementation<Layer extends AnyLayer> implements WorkerState<Layer> {
  readonly engine
  readonly layer: Layer

  constructor(options: WorkerOptions<Layer>) {
    this.engine = options.engine
    this.layer = options.layer
    effectiveLayerProviders(this.layer)
    Object.freeze(this)
  }

  run<F extends Flow>(
    root: FlowImplementation<F>,
    params: ParamsOf<F>,
    ...optionArgs: keyof EffectiveSignalsOf<F> extends never
      ? readonly [options?: WorkerRunOptions<Layer, F>]
      : readonly [options: WorkerRunOptions<Layer, F>]
  ): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>> {
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
    const options = optionArgs[0]
    const id = options?.id ?? randomUUID()
    const signalHandlers = (options as WorkerRunOptions<Layer, F> | undefined)?.signals as
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
    const request: EngineExecutionRequest<ResultOf<F>, EffectiveErrorsOf<F>> = {
      id,
      flowId: entry.id,
      params,
      ...(options?.metadata ? { metadata: options.metadata } : {}),
      context,
      execute: () => executeResolvedFlow<F>(entry, params, this.layer, context),
      signal: ({ name, request: signalRequest }) => resolveSignal(boundary, name, signalRequest)
    }

    return createFlowRun(this.engine.start(request))
  }
}

export const Worker = WorkerImplementation as unknown as WorkerConstructor
