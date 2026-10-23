// Summarises what a PR does to bundle size and Lighthouse, for perf.yml.
// Copy to .github/scripts/perf.mjs. No dependencies, Node 22.
//
//   node perf.mjs <base checkout> <head checkout> <out dir>
//
// Reads each checkout's build output (.next/static, else dist/, build/ or out/,
// or $BUILD_OUTPUT) and the Lighthouse CI results in <out>/lighthouse-<side>/,
// then writes <out>/summary.json (read by the pr-review performance angle) and
// <out>/summary.md (the job summary). A side that failed to build or measure is
// left out and noted, never guessed.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const [baseDir, headDir, outDir] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node perf.mjs <base dir> <head dir> <out dir>');
  process.exit(2);
}
const notes = [];
const kb = (bytes) => Math.round(bytes / 102.4) / 10;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Content hashes change on every build, so files are matched by name without
// them: Vite's 8-char base64url and Next's 16+ hex.
const unhash = (path) =>
  path.replace(/[-.](?:[a-f0-9]{16,}|[A-Za-z0-9_-]{8})(?=\.(?:js|mjs|css)$)/, '');

function initialFiles(root, isNext) {
  if (isNext) {
    const manifest = join(root, 'build-manifest.json');
    if (!existsSync(manifest)) return [];
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    // App Router loads rootMainFiles, Pages Router /_app. Polyfills are nomodule,
    // so modern browsers skip them.
    return m.rootMainFiles?.length ? m.rootMainFiles : (m.pages?.['/_app'] ?? []);
  }
  const html = join(root, 'index.html');
  if (!existsSync(html)) return [];
  const refs = [...readFileSync(html, 'utf8').matchAll(/(?:src|href)="([^"]+\.(?:js|mjs|css))"/g)];
  return refs.map((r) => r[1].replace(/^(?:\.?\/)+/, ''));
}

function bundle(dir, side) {
  const nextDir = join(dir, '.next');
  const isNext = !process.env.BUILD_OUTPUT && existsSync(join(nextDir, 'static'));
  const root = isNext
    ? nextDir
    : [process.env.BUILD_OUTPUT, 'dist', 'build', 'out'].filter(Boolean).map((d) => join(dir, d)).find(existsSync);
  if (!root) {
    notes.push(`${side}: no build output found, bundle size not measured`);
    return null;
  }
  const scan = isNext ? join(nextDir, 'static') : root;
  const initial = new Set(initialFiles(root, isNext));
  const files = {};
  const totals = { js: 0, css: 0, initialJs: 0, initialCss: 0 };
  for (const path of walk(scan)) {
    const ext = path.match(/\.(js|mjs|css)$/)?.[1];
    if (!ext) continue;
    const rel = relative(root, path);
    const type = ext === 'css' ? 'css' : 'js';
    const gzip = gzipSync(readFileSync(path), { level: 9 }).length;
    const isInitial = [...initial].some((f) => rel === f || rel.endsWith('/' + f) || f.endsWith('/' + rel));
    let key = unhash(rel);
    while (files[key]) key += '+';
    files[key] = { path: rel, type, raw: statSync(path).size, gzip, initial: isInitial };
    totals[type] += gzip;
    if (isInitial) totals[type === 'js' ? 'initialJs' : 'initialCss'] += gzip;
  }
  if (!initial.size) notes.push(`${side}: entry files not identified, initial sizes are 0`);
  return { tool: isNext ? 'next' : 'static', output: relative(dir, root), totals, files };
}

function lighthouse(side) {
  const dir = join(outDir, `lighthouse-${side}`);
  const manifest = join(dir, 'manifest.json');
  if (!existsSync(manifest)) {
    notes.push(`${side}: no Lighthouse results`);
    return null;
  }
  const pages = {};
  for (const run of JSON.parse(readFileSync(manifest, 'utf8'))) {
    if (!run.isRepresentativeRun) continue;
    const lhr = JSON.parse(readFileSync(run.jsonPath, 'utf8'));
    const audit = (id, digits = 0) => {
      const v = lhr.audits[id]?.numericValue;
      return v == null ? null : Number(v.toFixed(digits));
    };
    pages[new URL(run.url).pathname] = {
      performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      lcpMs: audit('largest-contentful-paint'),
      cls: audit('cumulative-layout-shift', 3),
      tbtMs: audit('total-blocking-time'),
      fcpMs: audit('first-contentful-paint'),
      speedIndexMs: audit('speed-index'),
      transferBytes: audit('total-byte-weight'),
    };
  }
  return pages;
}

const sides = { base: baseDir, head: headDir };
const result = {
  version: 1,
  sha: { base: process.env.BASE_SHA ?? null, head: process.env.HEAD_SHA ?? null },
  units: 'bytes gzipped (level 9), milliseconds, Lighthouse score 0-100',
  notes,
  bundle: {},
  lighthouse: {},
};
for (const [side, dir] of Object.entries(sides)) {
  if (existsSync(join(outDir, `build-failed-${side}`))) {
    notes.push(`${side}: build failed, not measured`);
    continue;
  }
  result.bundle[side] = bundle(dir, side);
  result.lighthouse[side] = lighthouse(side);
}

const { base, head } = result.bundle;
if (base && head) {
  const delta = Object.fromEntries(Object.keys(head.totals).map((k) => [k, head.totals[k] - base.totals[k]]));
  const changed = [];
  for (const key of new Set([...Object.keys(base.files), ...Object.keys(head.files)])) {
    const b = base.files[key]?.gzip ?? 0;
    const h = head.files[key]?.gzip ?? 0;
    if (Math.abs(h - b) < 1024) continue;
    const status = !base.files[key] ? 'added' : !head.files[key] ? 'removed' : 'changed';
    changed.push({ file: key, status, baseGzip: b, headGzip: h, delta: h - b, initial: !!(head.files[key] ?? base.files[key]).initial });
  }
  changed.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  result.bundle.delta = delta;
  result.bundle.changed = changed.slice(0, 20);
}
for (const side of ['base', 'head']) if (result.bundle[side]) delete result.bundle[side].files;
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(result, null, 2) + '\n');

// The same numbers for people, in the job summary.
const md = ['## Performance', ''];
const sign = (n) => (n > 0 ? '+' : '') + n;
const pct = (b, h) => (b ? ` (${sign(Math.round(((h - b) / b) * 100))}%)` : '');
if (base && head) {
  md.push('| Bundle, gzipped | Base | Head | Change |', '| --- | ---: | ---: | ---: |');
  for (const [k, label] of [['initialJs', 'Initial JS'], ['initialCss', 'Initial CSS'], ['js', 'All JS'], ['css', 'All CSS']]) {
    const b = base.totals[k];
    const h = head.totals[k];
    md.push(`| ${label} | ${kb(b)} KB | ${kb(h)} KB | ${sign(kb(h - b))} KB${pct(b, h)} |`);
  }
  if (result.bundle.changed.length) {
    md.push('', '| File | Status | Change |', '| --- | --- | ---: |');
    for (const c of result.bundle.changed) md.push(`| \`${c.file}\`${c.initial ? ' (initial)' : ''} | ${c.status} | ${sign(kb(c.delta))} KB |`);
  }
}
const lb = result.lighthouse.base ?? {};
const lh = result.lighthouse.head ?? {};
const paths = [...new Set([...Object.keys(lb), ...Object.keys(lh)])];
if (paths.length) {
  const v = (p, k, f) => (p?.[k] == null ? '–' : f(p[k]));
  const ms = (n) => `${(n / 1000).toFixed(2)} s`;
  md.push('', '| Page | Perf | LCP | CLS | TBT |', '| --- | ---: | ---: | ---: | ---: |');
  for (const p of paths) {
    const cell = (k, f) => `${v(lb[p], k, f)} → ${v(lh[p], k, f)}`;
    md.push(`| \`${p}\` | ${cell('performance', String)} | ${cell('lcpMs', ms)} | ${cell('cls', (n) => n.toFixed(3))} | ${cell('tbtMs', (n) => `${Math.round(n)} ms`)} |`);
  }
  md.push('', `Lighthouse: median of ${process.env.RUNS ?? 'several'} mobile runs per page against a local production build, base → head.`);
}
if (notes.length) md.push('', ...notes.map((n) => `- ${n}`));
writeFileSync(join(outDir, 'summary.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
