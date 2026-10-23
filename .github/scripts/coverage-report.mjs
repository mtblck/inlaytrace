#!/usr/bin/env node
// Coverage report for CI, from the repo-setup baseline (mtblck/claude-marketplace).
// Reads an lcov file (Vitest, Jest, cargo llvm-cov and pytest-cov all write one),
// writes the whole-repo totals and, on a PR, coverage of the changed lines only to
// the job summary and to coverage/diff-coverage.json, which the Claude review reads.
// Report only, unless the repo sets the COVERAGE_MIN / DIFF_COVERAGE_MIN variables
// (a line percentage): then it fails when coverage is below them.
// No dependencies; needs Node 18+ and the PR merge commit's base parent (fetch-depth: 2).
//
//   COVERAGE_FILE      lcov path, default coverage/lcov.info
//   COVERAGE_MIN       fail if whole-repo line coverage is below this
//   DIFF_COVERAGE_MIN  fail if changed-line coverage is below this
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const lcovPath = process.env.COVERAGE_FILE || 'coverage/lcov.info'
const outPath = resolve(dirname(lcovPath), 'diff-coverage.json')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

if (!existsSync(lcovPath)) {
  console.log(`No ${lcovPath}; nothing to report.`)
  process.exit(0)
}

const root = git('rev-parse', '--show-toplevel')
// lcov paths are absolute or relative to where the tests ran; make them repo-relative.
const repoPath = (p) => relative(root, isAbsolute(p) ? p : resolve(p)).split('\\').join('/')

// Per file: line -> hits, line -> [branches not taken, total], functions [{name, line, hits}].
const files = new Map()
let file
for (const raw of readFileSync(lcovPath, 'utf8').split('\n')) {
  const line = raw.trim()
  const colon = line.indexOf(':')
  const tag = colon === -1 ? line : line.slice(0, colon)
  const val = line.slice(colon + 1)
  if (tag === 'SF') {
    file = { lines: new Map(), branches: new Map(), fns: new Map() }
    files.set(repoPath(val), file)
  } else if (!file) {
    continue
  } else if (tag === 'DA') {
    const [n, hits] = val.split(',')
    file.lines.set(+n, (file.lines.get(+n) || 0) + Number(hits))
  } else if (tag === 'BRDA') {
    const [n, , , taken] = val.split(',')
    const b = file.branches.get(+n) || [0, 0]
    b[1]++
    if (taken === '-' || Number(taken) === 0) b[0]++
    file.branches.set(+n, b)
  } else if (tag === 'FN') {
    // lcov 1: FN:<line>,<name>; lcov 2: FN:<line>,<end line>,<name>
    const parts = val.split(',')
    const name = parts.slice(/^\d+$/.test(parts[1]) ? 2 : 1).join(',')
    file.fns.set(name, { name, line: +parts[0], hits: file.fns.get(name)?.hits || 0 })
  } else if (tag === 'FNDA') {
    const [hits, ...name] = val.split(',')
    const key = name.join(',')
    const fn = file.fns.get(key) || { name: key, line: 0, hits: 0 }
    fn.hits += Number(hits)
    file.fns.set(key, fn)
  } else if (tag === 'end_of_record') {
    file = undefined
  }
}

const pct = (hit, found) => (found ? Math.round((hit / found) * 1000) / 10 : null)
const stat = (hit, found) => ({ hit, found, pct: pct(hit, found) })
const show = (s) => (s.found ? `${s.pct}% (${s.hit}/${s.found})` : '–')
const ranges = (nums) => {
  const out = []
  for (const n of nums) {
    const last = out[out.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else out.push([n, n])
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
}

const t = { lh: 0, lf: 0, bh: 0, bf: 0, fh: 0, ff: 0 }
for (const f of files.values()) {
  for (const hits of f.lines.values()) {
    t.lf++
    if (hits > 0) t.lh++
  }
  for (const [missed, all] of f.branches.values()) {
    t.bf += all
    t.bh += all - missed
  }
  for (const fn of f.fns.values()) {
    t.ff++
    if (fn.hits > 0) t.fh++
  }
}
const total = { lines: stat(t.lh, t.lf), branches: stat(t.bh, t.bf), functions: stat(t.fh, t.ff) }

// On a PR, actions/checkout checks out the merge commit: its first parent is the base
// branch, so HEAD^1..HEAD is exactly what the PR changes, at the lines the tests ran on.
let diff = null
const isPr = process.env.GITHUB_EVENT_NAME?.startsWith('pull_request')
if (isPr) {
  let patch = null
  try {
    patch = git('diff', '--unified=0', '--no-color', '--no-renames', 'HEAD^1', 'HEAD')
  } catch {
    console.log('No base parent for HEAD (checkout needs fetch-depth: 2); skipping changed-line coverage.')
  }
  if (patch !== null) {
    const added = new Map()
    let path
    for (const l of patch.split('\n')) {
      if (l.startsWith('+++ ')) path = l === '+++ /dev/null' ? undefined : l.slice(6)
      const m = path && l.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/)
      if (m) {
        const set = added.get(path) || new Set()
        for (let i = 0; i < Number(m[2] ?? 1); i++) set.add(Number(m[1]) + i)
        added.set(path, set)
      }
    }
    let head = null
    try {
      head = git('rev-parse', 'HEAD^2')
    } catch {}
    const d = { lh: 0, lf: 0, bh: 0, bf: 0 }
    const changed = []
    for (const [p, set] of added) {
      const f = files.get(p)
      if (!f) continue // not instrumented: tests, config, types, files no test loads
      const instrumented = [...set].filter((n) => f.lines.has(n)).sort((a, b) => a - b)
      const uncovered = instrumented.filter((n) => f.lines.get(n) === 0)
      const branchLines = [...set].filter((n) => f.branches.has(n)).sort((a, b) => a - b)
      const missedBranches = branchLines.filter((n) => f.branches.get(n)[0] > 0)
      for (const n of branchLines) {
        const [missed, all] = f.branches.get(n)
        d.bf += all
        d.bh += all - missed
      }
      d.lf += instrumented.length
      d.lh += instrumented.length - uncovered.length
      if (!instrumented.length && !branchLines.length) continue
      changed.push({
        path: p,
        lines: stat(instrumented.length - uncovered.length, instrumented.length),
        uncoveredLines: ranges(uncovered),
        branchesNotTaken: missedBranches,
        uncoveredFunctions: [...f.fns.values()]
          .filter((fn) => fn.hits === 0 && set.has(fn.line))
          .map(({ name, line }) => ({ name, line })),
      })
    }
    changed.sort((a, b) => (a.lines.pct ?? 100) - (b.lines.pct ?? 100))
    diff = {
      base: git('rev-parse', 'HEAD^1'),
      head,
      lines: stat(d.lh, d.lf),
      branches: stat(d.bh, d.bf),
      files: changed,
    }
  }
}

const min = Number(process.env.COVERAGE_MIN) || null
const diffMin = Number(process.env.DIFF_COVERAGE_MIN) || null
const report = { commit: git('rev-parse', 'HEAD'), lcov: repoPath(lcovPath), total, diff, thresholds: { lines: min, diffLines: diffMin } }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')

const md = [
  `### Coverage${process.env.COVERAGE_NAME ? `: ${process.env.COVERAGE_NAME}` : ''}`,
  '',
  '| | Lines | Branches | Functions |',
  '| --- | --- | --- | --- |',
  `| Whole repo | ${show(total.lines)} | ${show(total.branches)} | ${show(total.functions)} |`,
]
if (diff) md.push(`| Changed lines | ${show(diff.lines)} | ${show(diff.branches)} | |`)
const gaps = diff?.files.filter((f) => f.uncoveredLines || f.uncoveredFunctions.length) || []
if (gaps.length) {
  md.push('', '| Changed file | Covered | Uncovered changed lines |', '| --- | --- | --- |')
  for (const f of gaps.slice(0, 20)) md.push(`| \`${f.path}\` | ${show(f.lines)} | ${f.uncoveredLines || '–'} |`)
  if (gaps.length > 20) md.push(`| … ${gaps.length - 20} more in \`diff-coverage.json\` | | |`)
} else if (diff && !diff.lines.found) {
  md.push('', 'No instrumented lines changed.')
}

const failures = []
if (min && total.lines.found && total.lines.pct < min) failures.push(`whole-repo line coverage ${total.lines.pct}% is below COVERAGE_MIN ${min}%`)
if (diffMin && diff?.lines.found && diff.lines.pct < diffMin) failures.push(`changed-line coverage ${diff.lines.pct}% is below DIFF_COVERAGE_MIN ${diffMin}%`)
md.push('', failures.length ? `**Failed:** ${failures.join('; ')}.` : min || diffMin ? `Thresholds met.` : 'Report only: set the `COVERAGE_MIN` or `DIFF_COVERAGE_MIN` repository variable to fail below a line percentage.', '')

const text = md.join('\n')
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n')
for (const f of failures) console.log(`::error::Coverage: ${f}`)
process.exit(failures.length ? 1 : 0)
