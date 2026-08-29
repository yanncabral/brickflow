class BrickFailure<E> {
  readonly error: E

  constructor(error: E) {
    this.error = error
  }
}

export function failWith<E>(error: E): never {
  throw new BrickFailure(error)
}

export function readBrickFailure(value: unknown): unknown | undefined {
  return value instanceof BrickFailure ? value.error : undefined
}

export function isBrickFailure(value: unknown): boolean {
  return value instanceof BrickFailure
}
