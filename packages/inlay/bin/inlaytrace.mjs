#!/usr/bin/env node
/**
 * The command line (#165): `npx inlaytrace logo.png -o logo.svg --preset logo`.
 *
 * PNGs are decoded here with Node's own zlib, so the package keeps no
 * dependencies. JPEG, WebP and anything else go through sharp when it's
 * installed (`npm install sharp`), and the error says so when it isn't.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { presets, toSvg, trace } from '../dist/index.js'
import { decodePng, isPng } from './png.mjs'

const HELP = `Usage: inlaytrace <image> [-o out.svg] [options]

Traces a PNG (or, with sharp installed, a JPEG, WebP, GIF or TIFF) into an SVG.
Writes to stdout without -o.

  -o, --output <file>     where to write the SVG
  -p, --preset <name>     ${Object.keys(presets).join(', ')} (default logo)
  -c, --colors <n>        at most this many colours
      --palette <list>    your own colours, comma-separated: '#111111,#e63946'
      --speckle <px>      merge regions smaller than this square
      --tolerance <px>    how far the outline may stray from the pixels
      --corner <deg>      turns sharper than this stay corners
      --layers            shapes whole, in layers (--no-layers: cut out)
      --exact-shapes      draw circles and rectangles exactly (--no-exact-shapes)
      --threshold <0-255> lineart and centerline: ink is darker than this
      --invert            lineart and centerline: light ink on a dark background
      --stroke-width <px> centerline: the stroke width
  -h, --help
  -v, --version`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    output: { type: 'string', short: 'o' },
    preset: { type: 'string', short: 'p' },
    colors: { type: 'string', short: 'c' },
    palette: { type: 'string' },
    speckle: { type: 'string' },
    tolerance: { type: 'string' },
    corner: { type: 'string' },
    layers: { type: 'boolean' },
    'exact-shapes': { type: 'boolean' },
    threshold: { type: 'string' },
    invert: { type: 'boolean' },
    'stroke-width': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
})

if (values.version) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  console.log(pkg.version)
  process.exit(0)
}
if (values.help || positionals.length !== 1) {
  console.log(HELP)
  process.exit(values.help ? 0 : 1)
}

const fail = (message) => {
  console.error(`inlaytrace: ${message}`)
  process.exit(1)
}
const num = (name, v) => {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) fail(`--${name} needs a number, not "${v}"`)
  return n
}

const options = {
  preset: values.preset,
  colors: num('colors', values.colors),
  palette: values.palette?.split(',').map((c) => c.trim().toLowerCase()),
  speckle: num('speckle', values.speckle),
  tolerance: num('tolerance', values.tolerance),
  cornerAngle: num('corner', values.corner),
  layers: values.layers,
  shapes: values['exact-shapes'],
  threshold: values.threshold === undefined ? undefined : values.threshold === 'auto' ? 'auto' : num('threshold', values.threshold),
  invert: values.invert,
  strokeWidth: num('stroke-width', values['stroke-width']),
}
if (options.preset && !(options.preset in presets)) fail(`no preset "${options.preset}". Use one of: ${Object.keys(presets).join(', ')}`)
for (const c of options.palette ?? []) if (!/^#[0-9a-f]{6}$/.test(c)) fail(`--palette colours are #rrggbb, not "${c}"`)

const [input] = positionals
let bytes
try {
  bytes = await readFile(input)
} catch (e) {
  fail(`can't read ${input}: ${e.code ?? e.message}`)
}

let image
try {
  image = isPng(bytes) ? decodePng(bytes) : await decodeWithSharp(bytes, input)
} catch (e) {
  if (e.interlaced) image = await decodeWithSharp(bytes, 'an interlaced PNG')
  else fail(`can't decode ${input}: ${e.message}`)
}
const svg = toSvg(trace(image, options))
if (values.output) {
  await writeFile(values.output, svg)
  console.error(`inlaytrace: ${input} → ${values.output} (${image.width} × ${image.height}, ${(svg.length / 1024).toFixed(1)} KB)`)
} else process.stdout.write(svg)

async function decodeWithSharp(b, name) {
  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    fail(`${name} isn't a PNG. For JPEG, WebP and other formats, install sharp next to inlaytrace (npm install sharp), or convert it to PNG.`)
  }
  const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
