/**
 * Your own colours (#191): reading a pasted list, adding to the list, and
 * snapping a colour to the nearest of them.
 */
import { oklab } from 'inlaytrace'
import { MAX_OWN_COLORS } from '../engine/presets'
import { normalizeHex } from './svg'

/**
 * Hex codes from pasted text, separated by commas, spaces, semicolons or new
 * lines; the # is optional. `bad` holds what wasn't a colour, to say so.
 */
export function parseColorList(text: string): { colors: string[]; bad: string[] } {
  const colors: string[] = []
  const bad: string[] = []
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue
    const hex = normalizeHex(token.startsWith('#') ? token : `#${token}`)
    if (hex) colors.push(hex)
    else bad.push(token)
  }
  return { colors, bad }
}

/** `list` with `more` added: normalised, each colour once, in the order first given, at most MAX_OWN_COLORS. */
export function addColors(list: string[], more: string[]): string[] {
  const out = [...list]
  for (const c of more) {
    const hex = normalizeHex(c)
    if (hex && !out.includes(hex) && out.length < MAX_OWN_COLORS) out.push(hex)
  }
  return out
}

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** The colour in `palette` nearest `hex` as the eye sees it (OKLab); `hex` itself when the palette is empty or it isn't a colour. */
export function nearestColor(hex: string, palette: string[]): string {
  const v = normalizeHex(hex)
  if (!v || !palette.length) return hex
  const [l, a, b] = oklab(rgbOf(v))
  let best = palette[0]
  let bestD = Infinity
  for (const c of palette) {
    const [l2, a2, b2] = oklab(rgbOf(c))
    const d = (l - l2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2
    if (d < bestD) [best, bestD] = [c, d]
  }
  return best
}

/** The eyedropper's target when it's adding to your own colours (ink targets are hexes, so this can't clash). */
export const OWN_COLORS = 'own-colours'
