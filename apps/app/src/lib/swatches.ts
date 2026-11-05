/**
 * A trace's colours as swatches (#192), for taking a palette into other
 * tools: Adobe Swatch Exchange (.ase), a GIMP/Inkscape palette (.gpl), or CSS
 * custom properties. Built in the browser, like every other export.
 */
import { rgbOf as rgb } from './colors'
import { normalizeHex } from './svg'

export type SwatchFormat = 'ase' | 'gpl' | 'css'

/**
 * The colours as drawn, in paint order (the background first, if any), each
 * once. `paths` are the visible paths, so colour edits (replace, merge,
 * remove) are already applied.
 */
export function swatchColors(paths: { fill: string; gradient?: { stops: { color: string }[] } }[], background: string | null = null): string[] {
  const seen = new Set<string>()
  // A gradient shape is drawn in its stops' colours, not its flat fallback.
  for (const c of [background, ...paths.flatMap((p) => (p.gradient ? p.gradient.stops.map((s) => s.color) : [p.fill]))]) {
    const hex = c ? normalizeHex(c) : null
    if (hex) seen.add(hex)
  }
  return [...seen]
}


/** A GIMP palette, which Inkscape and Krita read too. Each colour named by its hex. */
export function toGpl(colors: string[], name: string): string {
  const lines = ['GIMP Palette', `Name: ${name.replace(/[\r\n]+/g, ' ')}`, 'Columns: 0', '#']
  for (const c of colors) lines.push(`${rgb(c).map((v) => String(v).padStart(3)).join(' ')}\t${c}`)
  return lines.join('\n') + '\n'
}

/** CSS custom properties on :root, named by hex: `--color-1d3557: #1d3557;`. */
export function toCss(colors: string[]): string {
  return `:root {\n${colors.map((c) => `  --color-${c.slice(1)}: ${c};`).join('\n')}\n}\n`
}

/**
 * Adobe Swatch Exchange, version 1.0: big-endian, a header ("ASEF", version,
 * block count) and one colour entry block per colour: its name in UTF-16 with
 * a terminating null, the model "RGB ", three 32-bit floats from 0 to 1, and
 * the colour type (2, normal: not global, not spot).
 */
export function toAse(colors: string[]): Uint8Array {
  const blocks = colors.map((c) => {
    const name = `${c}\0`
    const length = 2 + name.length * 2 + 4 + 12 + 2
    const b = new DataView(new ArrayBuffer(6 + length))
    let o = 0
    b.setUint16(o, 0x0001) // colour entry
    b.setUint32((o += 2), length)
    b.setUint16((o += 4), name.length)
    o += 2
    for (let i = 0; i < name.length; i++, o += 2) b.setUint16(o, name.charCodeAt(i))
    for (const ch of 'RGB ') b.setUint8(o++, ch.charCodeAt(0))
    for (const v of rgb(c)) b.setFloat32((o += 4) - 4, v / 255)
    b.setUint16(o, 2)
    return new Uint8Array(b.buffer)
  })
  const header = new DataView(new ArrayBuffer(12))
  ;[0x41, 0x53, 0x45, 0x46].forEach((ch, i) => header.setUint8(i, ch)) // "ASEF"
  header.setUint16(4, 1)
  header.setUint16(6, 0)
  header.setUint32(8, blocks.length)
  const out = new Uint8Array(12 + blocks.reduce((n, b) => n + b.length, 0))
  out.set(new Uint8Array(header.buffer), 0)
  let at = 12
  for (const b of blocks) out.set(b, (at += b.length) - b.length)
  return out
}

/** The file for a format: contents, MIME type and extension. */
export function swatchFile(format: SwatchFormat, colors: string[], name: string): { data: Uint8Array | string; type: string; ext: string } {
  if (format === 'ase') return { data: toAse(colors), type: 'application/octet-stream', ext: 'ase' }
  if (format === 'gpl') return { data: toGpl(colors, name), type: 'text/plain', ext: 'gpl' }
  return { data: toCss(colors), type: 'text/css', ext: 'css' }
}
