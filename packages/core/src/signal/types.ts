export interface SignalDefinition<Request = unknown, Response = unknown> {
  readonly request: Request
  readonly response: Response
}

export type SignalDefinitions = Readonly<Record<string, SignalDefinition>>

export type SignalRequest<Definition> =
  Definition extends SignalDefinition<infer Request, unknown> ? Request : never
export type SignalResponse<Definition> =
  Definition extends SignalDefinition<unknown, infer Response> ? Response : never

type ValidSignalDefinition<Definition extends SignalDefinition> =
  undefined extends SignalResponse<Definition> ? never : Definition

export type SignalFunction<Definition extends SignalDefinition> =
  Definition extends ValidSignalDefinition<Definition>
    ? (request: SignalRequest<Definition>) => Promise<SignalResponse<Definition>>
    : never

export type SignalFunctions<Definitions extends SignalDefinitions> = {
  readonly [Name in keyof Definitions]: SignalFunction<Definitions[Name]>
}

export type InternalSignalHandler<Definition extends SignalDefinition> = (
  request: SignalRequest<Definition>
) => SignalResponse<Definition> | undefined | Promise<SignalResponse<Definition> | undefined>

export type BoundarySignalHandler<Definition extends SignalDefinition> = (
  request: SignalRequest<Definition>
) => SignalResponse<Definition> | Promise<SignalResponse<Definition>>

export type InternalSignalHandlers<Definitions extends SignalDefinitions> = {
  readonly [Name in keyof Definitions]?: InternalSignalHandler<Definitions[Name]>
}

export type BoundarySignalHandlers<Definitions extends SignalDefinitions> = {
  readonly [Name in keyof Definitions]-?: BoundarySignalHandler<Definitions[Name]>
}

export type UnknownSignalHandler = (request: unknown) => unknown | Promise<unknown>
export type UnknownSignalHandlers = Readonly<Record<string, UnknownSignalHandler | undefined>>

export interface SignalHandlerChain {
  readonly handlers: UnknownSignalHandlers
  readonly parent?: SignalHandlerChain
  readonly boundary: boolean
}

export interface SignalCallMetadata {
  readonly durableName: string
  readonly signalName: string
  readonly layerPath: readonly string[]
  readonly brickPath: readonly string[]
  readonly callId: string
  readonly occurrence: number
}
