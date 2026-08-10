class FlowFailure<E> {
  readonly error: E

  constructor(error: E) {
    this.error = error
  }
}

export function failWith<E>(error: E): never {
  throw new FlowFailure(error)
}

export function readFlowFailure(value: unknown): unknown | undefined {
  return value instanceof FlowFailure ? value.error : undefined
}

export function isFlowFailure(value: unknown): boolean {
  return value instanceof FlowFailure
}
