import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  dts: {
    compilerOptions: {
      composite: false
    }
  },
  entry: ['src/index.ts'],
  external: ['ts-pattern'],
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true,
  splitting: false,
  target: 'es2022'
})
