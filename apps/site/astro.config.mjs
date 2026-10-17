import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

/**
 * The Inlay site: a landing page (src/pages/index.astro) and the docs (Starlight,
 * under /docs/). The docs are the repo's docs/*.md, copied in by
 * scripts/sync-docs.mjs. It builds into the repo root's dist/, beside the app.
 */
export default defineConfig({
  site: 'https://inlaytrace.com',
  outDir: '../../dist',
  build: { format: 'directory', inlineStylesheets: 'never' },
  // No inline scripts of ours: the CSP allows Starlight's few by hash only.
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      title: 'Inlay',
      description: 'Trace images into vector shapes that fit together exactly.',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/fonts.css', './src/styles/docs.css'],
      sidebar: [
        {
          // Getting started already leads "The package"; listing it here too
          // highlighted it twice.
          label: 'Start here',
          items: [{ label: 'What Inlay is', link: '/docs/overview/' }],
        },
        { label: 'The package', items: [{ autogenerate: { directory: 'docs/package' } }] },
        { label: 'How it works', items: [{ autogenerate: { directory: 'docs/how-it-works' } }] },
        { label: 'The app', items: [{ autogenerate: { directory: 'docs/features' } }] },
        {
          label: 'Project',
          items: [
            { label: 'Compared with other tools', link: '/docs/how-it-differs/' },
            { label: 'Roadmap', link: '/docs/roadmap/' },
            { label: 'Design notes', link: '/docs/design-notes/' },
            { label: 'Research', link: '/docs/research/' },
          ],
        },
      ],
    }),
  ],
})
