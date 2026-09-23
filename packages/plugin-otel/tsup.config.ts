import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  // The package tsconfig is composite; tsup's declaration bundler otherwise raises TS6307.
  dts: {
    compilerOptions: {
      composite: false,
      incremental: false
    }
  },
  entry: ['src/index.ts', 'src/otel-adapter.ts'],
  external: ['@opentelemetry/api'],
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true,
  splitting: false,
  target: 'es2022'
})
