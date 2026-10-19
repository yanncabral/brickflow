import { expect, test } from 'bun:test'
import { type Brick, brick } from '../src/index'

test('the public core entry bundles for browsers without Node built-ins', async () => {
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const sourceDir = new URL('../src/', import.meta.url).pathname
  for await (const path of new Bun.Glob('**/*.ts').scan({ cwd: sourceDir, absolute: true })) {
    const externalImports = transpiler
      .scanImports(await Bun.file(path).text())
      .map((entry) => entry.path)
      .filter((specifier) => !specifier.startsWith('.') && specifier !== 'ts-pattern')
    expect(externalImports).toEqual([])
  }
  const result = await Bun.build({
    entrypoints: [new URL('../src/index.ts', import.meta.url).pathname],
    target: 'browser'
  })
  expect(result.success).toBe(true)
  const output = await result.outputs[0]?.text()
  expect(output).toBeDefined()
  expect(output).not.toContain('node:')
})

test('Bricks execute with generated UUIDs when crypto.randomUUID is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  try {
    type PortableBrick = Brick<{ params: number; result: number }>
    const operation = brick<PortableBrick>((value) => value * 2)
    const first = operation(3)
    const second = operation(4)
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(first.id).toMatch(uuidV4)
    expect(second.id).toMatch(uuidV4)
    expect(first.id).not.toBe(second.id)
    expect(await first).toBe(6)
    expect(await second).toBe(8)
    const explicit = operation(5, { id: 'portable-explicit-id' })
    expect(explicit.id).toBe('portable-explicit-id')
    expect(await explicit).toBe(10)
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor)
    else Reflect.deleteProperty(crypto, 'randomUUID')
  }
})
