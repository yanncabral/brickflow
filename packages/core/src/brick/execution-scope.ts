import { bindBrickRunToHandler } from '../worker/run'

export interface HandlerExecutionScope {
  active: boolean
  readonly failures: WeakMap<Error, unknown>
}

// Bind returned runs explicitly to their consuming handler, without ambient context.
export function bindHandlerRequirements<Requirements extends object>(
  requirements: Requirements,
  scope: HandlerExecutionScope
): Requirements {
  const functions = new WeakMap<object, object>()
  const descriptors = Object.getOwnPropertyDescriptors(requirements)
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor
    const value: unknown = descriptor.value
    if (typeof value !== 'function') continue
    let bound = functions.get(value)
    if (!bound) {
      bound = new Proxy(value, {
        apply(target, receiver, args) {
          return bindBrickRunToHandler(Reflect.apply(target, receiver, args), scope)
        }
      })
      functions.set(value, bound)
    }
    descriptor.value = bound
  }
  return Object.create(Object.getPrototypeOf(requirements), descriptors) as Requirements
}
