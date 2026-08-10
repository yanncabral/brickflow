import type { P } from 'ts-pattern'

export type MatchingOutcome<Success, Error> =
  | { readonly ok: true; readonly value: Success }
  | { readonly ok: false; readonly error: Error }

export type MatchingThunk<Success, Error> = () =>
  | MatchingOutcome<Success, Error>
  | Promise<MatchingOutcome<Success, Error>>

export type SupportedPattern<Input> = P.Pattern<Input>

export type MatchedError<Error, Pattern extends SupportedPattern<Error>> = P.narrow<Error, Pattern>

export type RecoveryValue<Handler> = Exclude<Awaited<Handler>, undefined>

type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false

type CoveredError<Error, Pattern extends SupportedPattern<Error>> =
  IsEqual<MatchedError<Error, Pattern>, Error> extends true
    ? Error
    : Pattern extends string | number | boolean | bigint | symbol | null | undefined
      ? Extract<Error, Pattern>
      : Pattern extends { readonly type: infer Type }
        ? Exclude<keyof Pattern, 'type'> extends never
          ? Extract<Error, { readonly type: Type }>
          : never
        : never

export type RemainingErrors<Error, Pattern extends SupportedPattern<Error>, HandlerResult> =
  undefined extends Awaited<HandlerResult> ? Error : Exclude<Error, CoveredError<Error, Pattern>>

export interface MatchingBuilder<
  Error,
  InitialSuccess,
  LocalResult = InitialSuccess,
  RemainingError = Error
> extends PromiseLike<MatchingOutcome<LocalResult, RemainingError>> {
  with<const Pattern extends SupportedPattern<RemainingError>, HandlerResult>(
    pattern: Pattern extends readonly unknown[] ? never : Pattern,
    handler: (
      error: MatchedError<RemainingError, Pattern>
    ) => HandlerResult | Promise<HandlerResult>
  ): MatchingBuilder<
    Error,
    InitialSuccess,
    LocalResult | RecoveryValue<HandlerResult>,
    RemainingErrors<RemainingError, Pattern, HandlerResult>
  >
}
