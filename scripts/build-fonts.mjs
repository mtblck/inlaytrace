/**
 * Builds the fonts that "Recognise text" matches against (apps/app/public/models/fonts/):
 * each family's static weights from Google Fonts, cut down to Latin and kerning, as WOFF,
 * plus index.json (what the AI worker loads) and LICENSES.txt.
 *
 *   npm run fonts            (needs network, and fontTools: `pip install fonttools`)
 *
 * The output is committed, so this only runs when the list below changes. Every family
 * here is OFL, Apache or UFL (checked as each licence is fetched); any other licence
 * stops the build.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = new URL('../apps/app/public/models/fonts/', import.meta.url).pathname

// The families most used on the web and in print, across sans, serif, slab, display,
// script and mono, and stand-ins for common system fonts. Matching cost and download
// grow with the list (~15 KB a style).
const FAMILIES = [
  // sans
  'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Poppins', 'Inter', 'Raleway', 'Nunito', 'Nunito Sans', 'Noto Sans',
  'Source Sans 3', 'Ubuntu', 'PT Sans', 'Rubik', 'Work Sans', 'Mulish', 'Kanit', 'Fira Sans', 'Barlow', 'Josefin Sans',
  'Karla', 'DM Sans', 'Manrope', 'Archivo', 'Cabin', 'Arimo', 'Hind', 'Titillium Web', 'Exo 2', 'Heebo', 'Prompt',
  'Sora', 'Outfit', 'Lexend', 'Plus Jakarta Sans', 'Figtree', 'Urbanist', 'Libre Franklin', 'Maven Pro', 'IBM Plex Sans',
  'Space Grotesk', 'Quicksand', 'Varela Round', 'Comfortaa', 'Dosis', 'Asap', 'Signika', 'Jost', 'Red Hat Display', 'Chivo',
  'Epilogue', 'Fredoka', 'Baloo 2',
  // condensed and display
  'Oswald', 'Bebas Neue', 'Anton', 'Teko', 'Archivo Black', 'Righteous', 'Barlow Condensed', 'Archivo Narrow',
  'Fjalla One', 'Yanone Kaffeesatz', 'Passion One', 'Alfa Slab One', 'Abril Fatface', 'DM Serif Display', 'Cinzel',
  // serif and slab
  'Merriweather', 'Playfair Display', 'Lora', 'Libre Baskerville', 'EB Garamond', 'Crimson Text', 'Cormorant Garamond',
  'Noto Serif', 'IBM Plex Serif', 'Source Serif 4', 'PT Serif', 'Spectral', 'Alegreya', 'Libre Caslon Text', 'Bitter',
  'Roboto Slab', 'Zilla Slab', 'Arvo', 'Josefin Slab', 'Bree Serif', 'Patua One',
  // script and hand
  'Pacifico', 'Lobster', 'Dancing Script', 'Caveat', 'Great Vibes', 'Satisfy', 'Permanent Marker', 'Amatic SC',
  'Shadows Into Light', 'Indie Flower', 'Kalam',
  // mono
  'Roboto Mono', 'Source Code Pro', 'Inconsolata', 'Space Mono',
  // drawn to the metrics of system fonts, so screenshots of them match: Arial
  // (Arimo, above), Courier, Calibri, Cambria, Georgia. (Tinos, for Times, has no
  // licence file in google/fonts to ship with it.)
  'Cousine', 'Carlito', 'Caladea', 'Gelasio',
]
const WEIGHTS = [300, 400, 500, 600, 700, 800]
// Basic Latin, Latin-1, dashes, curly quotes, ellipsis, euro: what the English OCR model reads.
const UNICODES = 'U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2026,U+20AC'

const slug = (family) => family.replace(/ /g, '')
// An old user agent gets static TrueType files, one per weight, rather than variable WOFF2.
const UA = { 'User-Agent': 'Mozilla/4.0' }

async function staticUrl(family, weight) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}`, { headers: UA })
  if (!res.ok) return null // the family has no such weight
  return /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(await res.text())?.[1] ?? null
}

async function licence(family) {
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [kind, file] of [['OFL-1.1', 'OFL.txt'], ['Apache-2.0', 'LICENSE.txt'], ['UFL-1.0', 'UFL.txt']]) {
    const sub = { 'OFL-1.1': 'ofl', 'Apache-2.0': 'apache', 'UFL-1.0': 'ufl' }[kind]
    const res = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${sub}/${dir}/${file}`)
    if (res.ok) return { kind, text: await res.text() }
  }
  throw new Error(`${family}: no OFL, Apache or UFL licence found in google/fonts.`)
}

const tmp = mkdtempSync(join(tmpdir(), 'inlay-fonts-'))
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const styles = []
const licences = []
for (const family of FAMILIES) {
  const [lic, urls] = await Promise.all([licence(family), Promise.all(WEIGHTS.map((w) => staticUrl(family, w)))])
  const seen = new Set()
  for (const [i, url] of urls.entries()) {
    // A family without a weight can answer with its nearest one: keep each file once.
    if (!url || seen.has(url)) continue
    seen.add(url)
    const weight = WEIGHTS[i]
    const id = `${slug(family)}-${weight}`
    const ttf = join(tmp, `${id}.ttf`)
    writeFileSync(ttf, Buffer.from(await (await fetch(url)).arrayBuffer()))
    execFileSync('pyftsubset', [ttf, `--unicodes=${UNICODES}`, '--layout-features=kern', '--no-hinting', '--desubroutinize', '--flavor=woff', `--output-file=${join(OUT, `${id}.woff`)}`])
    styles.push({ id, family, weight, bytes: statSync(join(OUT, `${id}.woff`)).size })
  }
  licences.push({ family, ...lic })
  console.log(family, styles.filter((s) => s.family === family).map((s) => s.weight).join(' '), lic.kind)
}
rmSync(tmp, { recursive: true, force: true })

writeFileSync(join(OUT, 'index.json'), JSON.stringify({ styles }, null, 0) + '\n')
const byKind = (k) => licences.filter((l) => l.kind === k).map((l) => l.family)
const notice = [
  'Fonts served with the Inlay app for "Recognise text", used only in your browser to match and',
  'redraw text found in an image. From Google Fonts (https://fonts.google.com), subset to Latin.',
  'Text Inlay outlines with these fonts is your artwork: font licences do not cover documents made with a font.',
  '',
  ...['OFL-1.1', 'Apache-2.0', 'UFL-1.0'].flatMap((k) => (byKind(k).length ? [`${k}: ${byKind(k).join(', ')}`, ''] : [])),
  ...licences.flatMap((l) => ['='.repeat(72), `${l.family} (${l.kind})`, '='.repeat(72), l.text.trim(), '']),
]
writeFileSync(join(OUT, 'LICENSES.txt'), notice.join('\n'))
const bytes = styles.reduce((s, x) => s + x.bytes, 0)
console.log(`${styles.length} styles from ${licences.length} families, ${(bytes / 1e6).toFixed(1)} MB`)
