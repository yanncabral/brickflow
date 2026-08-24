export const PATH_DELIMITER = '.'

export function assertValidPathSegment(segment: string): void {
  if (segment.includes(PATH_DELIMITER)) {
    throw new Error(
      `Invalid path segment "${segment}": "${PATH_DELIMITER}" is a reserved delimiter`
    )
  }
}
