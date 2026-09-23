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

/**
 * Best-effort plugin invocation. A throwing (or rejecting) plugin hook must
 * never break Brick execution, mask the real exit, or corrupt durable replay:
 * the error is swallowed and emission continues with the next plugin.
 */
async function invokeSafely(action: () => void | Promise<void>): Promise<void> {
  try {
    await action()
  } catch {
    // Intentionally ignored: plugin hooks are observers, not participants.
  }
}

export async function emitPluginStart(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await invokeSafely(() => plugin.onStart?.(context))
  }
}

export async function emitPluginSuccess(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  value: unknown
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await invokeSafely(() => plugin.onSuccess?.(context, value))
  }
}

export async function emitPluginFailure(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  error: unknown
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await invokeSafely(() => plugin.onFailure?.(context, error))
  }
}

export async function emitPluginDefect(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  error: unknown
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await invokeSafely(() => plugin.onDefect?.(context, error))
  }
}

export async function emitPluginSignal(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  signal: BrickPluginSignalEvent
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await invokeSafely(() => plugin.onSignal?.(context, signal))
  }
}

export async function emitPluginFinally(
  plugins: readonly BrickPlugin[],
  context: BrickPluginContext,
  exit: BrickPluginExit
): Promise<void> {
  for (const plugin of activePlugins(plugins, context)) {
    await invokeSafely(() => plugin.onFinally?.(context, exit))
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
          await invokeSafely(() => emit({ name: property, request, ok: true, response }))
          return response
        } catch (error) {
          await invokeSafely(() => emit({ name: property, request, ok: false, error }))
          throw error
        }
      }
    }
  })
}
