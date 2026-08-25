export const PATH_DELIMITER = '.'

export type ValidPathSegment<Value extends string> = Value extends ''
  ? never
  : Value extends `${string}.${string}`
    ? never
    : Value

export type ValidatePathSegmentKeys<Values extends object> = {
  readonly [Key in keyof Values]: Key extends string
    ? ValidPathSegment<Key> extends never
      ? never
      : Values[Key]
    : never
}

export type HasValidPathSegmentKeys<Values extends object> =
  Values extends ValidatePathSegmentKeys<Values> ? true : false

export function assertValidPathSegment(segment: string): void {
  if (segment.length === 0) {
    throw new Error('Invalid path segment: segment must not be empty')
  }
  if (segment.includes(PATH_DELIMITER)) {
    throw new Error(
      `Invalid path segment "${segment}": "${PATH_DELIMITER}" is a reserved delimiter`
    )
  }
}
