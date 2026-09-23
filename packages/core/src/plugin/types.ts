export type BrickPluginReplay = 'emit' | 'skip'

export interface BrickPluginContext {
  readonly brickId?: string
  readonly callId: string
  readonly layerPath: readonly string[]
  readonly brickPath: readonly string[]
  readonly params: unknown
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly isReplay: boolean
}

export type BrickPluginExit =
  | { readonly kind: 'success'; readonly value: unknown }
  | { readonly kind: 'failure'; readonly error: unknown }
  | { readonly kind: 'defect'; readonly error: unknown }

export interface BrickPluginSignalEvent {
  readonly name: string
  readonly request: unknown
  readonly ok: boolean
  readonly response?: unknown
  readonly error?: unknown
}

export interface BrickPlugin {
  readonly name?: string
  /**
   * Replay behavior for durable engines. Durable engines must skip plugin
   * events during replay unless the plugin explicitly opts in with `'emit'`.
   * Defaults to `'skip'`.
   */
  readonly replay?: BrickPluginReplay
  readonly onStart?: (context: BrickPluginContext) => void | Promise<void>
  readonly onSuccess?: (context: BrickPluginContext, value: unknown) => void | Promise<void>
  /** Typed domain failure. Unexpected defects go to `onDefect` instead. */
  readonly onFailure?: (context: BrickPluginContext, error: unknown) => void | Promise<void>
  /** Unexpected thrown error. Typed domain failures go to `onFailure` instead. */
  readonly onDefect?: (context: BrickPluginContext, error: unknown) => void | Promise<void>
  readonly onSignal?: (
    context: BrickPluginContext,
    signal: BrickPluginSignalEvent
  ) => void | Promise<void>
  readonly onFinally?: (context: BrickPluginContext, exit: BrickPluginExit) => void | Promise<void>
}
