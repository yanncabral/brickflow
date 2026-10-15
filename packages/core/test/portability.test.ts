import { expect, test } from 'bun:test'

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
