#!/usr/bin/env node
/**
 * The package's changelog, packages/inlay/CHANGELOG.md, is written by
 * `changeset version`. This copies it into the docs (docs/changelog.md, beside
 * the roadmap, so Boards and the site show it) and pulls out one version's
 * section for its GitHub release.
 *
 *   node scripts/changelog.mjs                  write docs/changelog.md
 *   node scripts/changelog.mjs --check          fail if docs/changelog.md is stale
 *   node scripts/changelog.mjs --notes 0.2.0    print 0.2.0's release notes
 *
 * `npm run version-packages` runs the first; `npm run build` the second.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'packages/inlay/CHANGELOG.md')
const docs = join(root, 'docs/changelog.md')

// Everything after the package-name heading: one `## x.y.z` section per version.
const body = readFileSync(source, 'utf8').replace(/^# .*\n+/, '')

const page = `---
order: 41
---

# Changelog

What changed in each release of [\`inlaytrace\`](https://www.npmjs.com/package/inlaytrace),
the tracing package (see [The package](package.md)). The [app](https://inlaytrace.com/app/)
and this site update as changes land and aren't versioned. Changes waiting for
the next release are in [\`.changeset/\`](../.changeset/); the
[GitHub releases](https://github.com/mtblck/inlaytrace/releases) carry the same notes.

<!-- Written by scripts/changelog.mjs from packages/inlay/CHANGELOG.md: edit that (or the changesets), not this. -->

${body}`

const [flag, arg] = process.argv.slice(2)
if (flag === '--notes') {
  const sections = body.split(/^(?=## )/m)
  const section = sections.find((s) => s.startsWith(`## ${arg}\n`))
  if (!section) {
    console.error(`No "## ${arg}" section in packages/inlay/CHANGELOG.md.`)
    process.exit(1)
  }
  process.stdout.write(section.replace(/^## .*\n+/, '').trimEnd() + '\n')
} else if (flag === '--check') {
  let current = ''
  try {
    current = readFileSync(docs, 'utf8')
  } catch {}
  if (current !== page) {
    console.error('docs/changelog.md is out of date with packages/inlay/CHANGELOG.md: run `node scripts/changelog.mjs`.')
    process.exit(1)
  }
} else {
  writeFileSync(docs, page)
}
