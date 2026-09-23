import type {
  BrickPlugin,
  BrickPluginContext,
  BrickPluginExit,
  BrickPluginSignalEvent
} from './types'

export function shouldEmitPlugin(plugin: BrickPlugin, isReplay: boolean): boolean {
  if (!isReplay) return true
  return (plugin.replay ?? 'skip') === 'emit'
}

function activePlugins(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext
): readonly BrickPlugin[] {
  return plugins.filter((plugin) => shouldEmitPlugin(plugin, context.isReplay))
}

export async function emitPluginStart(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await plugin.onStart?.(context)
  }
}

export async function emitPluginSuccess(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  value: unknown
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await plugin.onSuccess?.(context, value)
  }
}

export async function emitPluginFailure(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  error: unknown
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await plugin.onFailure?.(context, error)
  }
}

export async function emitPluginDefect(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  error: unknown
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await plugin.onDefect?.(context, error)
  }
}

export async function emitPluginSignal(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  signal: BrickPluginSignalEvent
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await plugin.onSignal?.(context, signal)
  }
}

export async function emitPluginFinally(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  exit: BrickPluginExit
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await plugin.onFinally?.(context, exit)
  }
}

export function wrapSignalFunctions<Signals extends object>(
  signals: Signals,
  emit: (signal: BrickPluginSignalEvent) => Promise<void>
): Signals {
  return new Proxy(signals, {
    get(target, property) {
      const value: unknown = (target as Record<string, unknown>)[property as string]
      if (typeof property !== 'string' || typeof value !== 'function') return value
      const invoke = value as (request: unknown) => Promise<unknown>
      return async (request: unknown) => {
        try {
          const response = await invoke(request)
          await emit({ name: property, request, ok: true, response })
          return response
        } catch (error) {
          await emit({ name: property, request, ok: false, error })
          throw error
        }
      }
    }
  })
}
