import { defineConfig } from 'vitest/config'

// The app (jsdom, its own Vite config), the Inlay package and the API server (plain
// Node) run as separate projects from the repo root: `npm test`.
export default defineConfig({
  test: {
    projects: [
      'apps/app/vite.config.ts',
      { test: { name: 'inlaytrace', root: 'packages/inlay', environment: 'node' } },
      { test: { name: 'server', root: 'server', environment: 'node' } },
    ],
  },
})
