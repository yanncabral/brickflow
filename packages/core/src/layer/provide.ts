export function addProviders(
  current: Readonly<Record<string, unknown>>,
  values: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  for (const key of Object.keys(values)) {
    if (Object.hasOwn(current, key)) {
      throw new Error(`Provider key is already provided: ${key}`)
    }
  }
  return Object.freeze({ ...current, ...values })
}

export function overrideProviders(
  current: Readonly<Record<string, unknown>>,
  values: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(current, key)) {
      throw new Error(`Cannot override absent provider key: ${key}`)
    }
  }
  return Object.freeze({ ...current, ...values })
}
