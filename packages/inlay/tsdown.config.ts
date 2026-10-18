import { defineConfig } from 'tsdown'

// One ESM file plus its type declarations. `neutral`: no Node or browser
// built-ins are used, so the same build runs in browsers, workers and Node.
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
})
