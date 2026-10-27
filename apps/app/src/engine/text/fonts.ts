/**
 * The fonts text is matched against (public/models/fonts/, built by
 * `npm run fonts`): Google Fonts families subset to Latin, all OFL, Apache or
 * UFL (LICENSES.txt beside them). Fetched from this site and parsed once.
 */
import { parse } from 'opentype.js'
import type { FontStyle } from './match'

type Index = { styles: { id: string; family: string; weight: number; bytes: number }[] }

/** Files fetched at once. */
const PARALLEL = 8

let loaded: Promise<FontStyle[]> | undefined

/** Every style, fetched and parsed; `progress` counts bytes against the index's total. */
export function loadFonts(base: string, progress: (done: number, total: number) => void) {
  loaded ??= (async () => {
    const res = await fetch(`${base}index.json`)
    if (!res.ok) throw new Error(`Couldn't load the fonts (${res.status}).`)
    const { styles } = (await res.json()) as Index
    const total = styles.reduce((s, x) => s + x.bytes, 0)
    let done = 0
    const out: FontStyle[] = new Array(styles.length)
    let next = 0
    const worker = async () => {
      while (next < styles.length) {
        const i = next++
        const s = styles[i]
        const r = await fetch(`${base}${s.id}.woff`)
        if (!r.ok) throw new Error(`Couldn't load the font ${s.family} (${r.status}).`)
        out[i] = { id: s.id, family: s.family, weight: s.weight, font: parse(await r.arrayBuffer()) }
        done += s.bytes
        progress(done, total)
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    return out
  })()
  loaded.catch(() => (loaded = undefined))
  return loaded
}
