import { defineConfig } from 'vitest/config'

// The app (jsdom, its own Vite config) and the Inlay package (plain Node) run as
// separate projects from the repo root: `npm test`.
export default defineConfig({
  test: {
    projects: ['apps/app/vite.config.ts', { test: { name: 'inlaytrace', root: 'packages/inlay', environment: 'node' } }],
  },
})
