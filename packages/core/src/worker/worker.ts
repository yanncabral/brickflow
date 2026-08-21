import type { Engine } from '../engine/engine'
import type { Flow } from '../flow/contract'
import type {
  EffectiveErrorsOf,
  EffectiveSignalsOf,
  FlowImplementation,
  ParamsOf,
  ResultOf
} from '../flow/types'
import { effectiveLayerProviders, flattenLayer, resolveLayerDependency } from '../layer/composition'
import type { AnyLayer } from '../layer/types'
import { executeFlow } from './execution'
import type { FlowRun, WorkerRunOptions } from './types'

export interface LegacyWorkerOptions<Layer extends AnyLayer = AnyLayer> {
  readonly engine: Engine
  readonly layer: Layer
}

export interface LegacyWorkerState<Layer extends AnyLayer = AnyLayer> {
  readonly engine: Engine
  readonly layer: Layer
  run<F extends Flow>(
    root: FlowImplementation<F>,
    params: ParamsOf<F>,
    ...options: keyof EffectiveSignalsOf<F> extends never
      ? readonly [options?: WorkerRunOptions<Layer, F>]
      : readonly [options: WorkerRunOptions<Layer, F>]
  ): FlowRun<EffectiveErrorsOf<F>, ResultOf<F>>
}

export interface LegacyWorkerConstructor {
  new <Layer extends AnyLayer>(options: LegacyWorkerOptions<Layer>): LegacyWorkerState<Layer>
}

class LegacyWorkerImplementation<Layer extends AnyLayer> implements LegacyWorkerState<Layer> {
  readonly engine
  readonly layer: Layer

  constructor(options: LegacyWorkerOptions<Layer>) {
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
    const entries = flattenLayer(this.layer)
    const roots = entries.filter(({ implementation }) => implementation === root)
    if (roots.length === 0) throw new Error('Root Flow is not present in the configured Layer')
    if (roots.length > 1) {
      throw new Error(
        `Ambiguous root Flow is present at multiple durable paths: ${roots.map(({ id }) => id).join(', ')}`
      )
    }
    const entry = roots[0] as (typeof roots)[number]
    const options = optionArgs[0]
    return executeFlow({
      root: entry,
      entries,
      params,
      providers: effectiveLayerProviders(this.layer),
      resolveDependency: (caller, alias) =>
        resolveLayerDependency(this.layer, caller as never, alias),
      worker: { start: (request) => this.engine.start(request) },
      ...(options?.signals
        ? { signals: options.signals as Readonly<Record<string, unknown>> }
        : {}),
      ...(options?.id ? { id: options.id } : {}),
      ...(options?.metadata ? { metadata: options.metadata } : {})
    })
  }
}

export const LegacyWorker = LegacyWorkerImplementation as unknown as LegacyWorkerConstructor
