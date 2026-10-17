#!/usr/bin/env node
/**
 * Copy the repo's docs/*.md into the site's Starlight content, so there's one
 * copy of every doc: Boards reads docs/ directly, and the site reads this
 * generated folder (apps/site/src/content/docs/docs/, gitignored).
 *
 * Per file:
 *  - The first `# Heading` becomes the `title` (and leaves the body).
 *  - Frontmatter `order` becomes `sidebar.order`.
 *  - A parent doc beside a folder of the same name (how-it-works.md and
 *    how-it-works/) becomes that folder's index page.
 *  - Relative links to other docs (`../features/export.md#anchor`) become site
 *    URLs (`/docs/features/export/#anchor`). Links to anything else in the
 *    repo point at the file on GitHub.
 *  - Docs listed in INTERNAL (planning notes) are left out, and so is anything
 *    between <!-- site:hide --> and <!-- /site:hide --> (notes for the board
 *    that don't belong on the public site).
 *
 * Boards' `public:` frontmatter isn't consulted: that decides what anonymous
 * visitors see on the board. Everything synced here is published on the site.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, posix } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'docs')
const out = join(root, 'apps/site/src/content/docs/docs')
const REPO = 'https://github.com/mtblck/inlaytrace/blob/main'
const INTERNAL = new Set(['launch-plan.md'])

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.md') ? [join(dir, f)] : []))
const files = walk(src)
  .map((f) => relative(src, f).split('\\').join('/'))
  .filter((f) => !INTERNAL.has(f))
const isParent = (rel) => existsSync(join(src, rel.replace(/\.md$/, ''))) && statSync(join(src, rel.replace(/\.md$/, ''))).isDirectory()
/** docs-relative path → site URL. */
const urlOf = (rel) => `/docs/${rel.replace(/\.md$/, '').replace(/(^|\/)index$/, '')}/`
/** docs-relative path → output file. */
const outOf = (rel) => join(out, isParent(rel) ? rel.replace(/\.md$/, '/index.md') : rel)

rmSync(out, { recursive: true, force: true })
for (const rel of files) {
  let text = readFileSync(join(src, rel), 'utf8')
  // Frontmatter.
  let fm = {}
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv) fm[kv[1]] = kv[2].trim()
    }
    text = text.slice(m[0].length)
  }
  text = text.replace(/\n?<!-- site:hide -->[\s\S]*?<!-- \/site:hide -->/g, '')
  // Title from the first heading.
  const h1 = text.match(/^\s*# (.+)\n/)
  const title = h1 ? h1[1].trim() : rel.replace(/\.md$/, '')
  if (h1) text = text.slice(h1.index + h1[0].length)
  // Links.
  const here = posix.dirname(rel)
  text = text.replace(/\]\((?!https?:|mailto:|#|\/)([^)\s]+?)(#[^)\s]*)?\)/g, (all, target, hash = '') => {
    const resolved = posix.normalize(posix.join(here, target))
    if (resolved.endsWith('.md') && !resolved.startsWith('..') && files.includes(resolved)) return `](${urlOf(resolved)}${hash})`
    if (resolved.endsWith('.md') && INTERNAL.has(resolved)) return `](${REPO}/docs/${resolved}${hash})`
    // Elsewhere in the repo (README, packages, scripts): on GitHub.
    return `](${REPO}/${posix.normalize(posix.join('docs', here, target))}${hash})`
  })
  const order = Number(fm.order)
  const front = [
    '---',
    `title: ${JSON.stringify(title)}`,
    ...(isParent(rel) ? ['sidebar:', '  label: Overview', '  order: 0'] : Number.isFinite(order) ? ['sidebar:', `  order: ${order}`] : []),
    '---',
    '',
  ].join('\n')
  const dest = outOf(rel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, front + text.replace(/^\n+/, ''))
}
console.log(`  synced ${files.length} docs into apps/site/src/content/docs/docs/`)
