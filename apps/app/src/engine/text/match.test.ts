// @vitest-environment node
// Matching is pure; Node reads the fonts straight from public/.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse, type PathCommand } from 'opentype.js'
import { linesFromTsv, matchText, MIN_SCORE, paintOut, rebackground, type FontStyle, type OcrLine } from './match'
import { rasterize } from './raster'

const DIR = new URL('../../../public/models/fonts/', import.meta.url)
const index = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8')) as { styles: { id: string; family: string; weight: number }[] }
const style = (id: string): FontStyle => {
  const s = index.styles.find((x) => x.id === id)!
  const b = readFileSync(new URL(`${id}.woff`, DIR))
  return { ...s, font: parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) }
}
// Close relatives of the drawn fonts, so a right answer means something.
const CANDIDATES = ['Montserrat-400', 'Montserrat-600', 'Montserrat-700', 'Montserrat-800', 'Poppins-700', 'Raleway-700', 'Lato-700', 'Roboto-700', 'OpenSans-700', 'PlayfairDisplay-700', 'Lora-400', 'Merriweather-400', 'CrimsonText-400', 'EBGaramond-400'].map(style)

type Image = { rgba: Uint8ClampedArray; width: number; height: number }
const blank = (width: number, height: number, bg: (x: number, y: number) => number[]): Image => {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([...bg(x, y), 255], (y * width + x) * 4)
  return { rgba, width, height }
}

/** Draws `words` in `s` on one baseline, word gaps of a third of the size; returns OCR's view: each word's ink box. */
function draw(img: Image, s: FontStyle, words: string[], size: number, x: number, baseline: number, ink: number[]): OcrLine {
  const line: OcrLine = { words: [] }
  for (const text of words) {
    const commands: PathCommand[] = []
    let at = x
    for (const ch of text) {
      const g = s.font.charToGlyph(ch)
      commands.push(...g.getPath(at, baseline, size).commands)
      at += ((g.advanceWidth ?? 0) * size) / s.font.unitsPerEm
    }
    const cover = rasterize(commands, img.width, img.height)
    const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
    for (let i = 0; i < cover.length; i++) {
      if (!cover[i]) continue
      const p = i * 4
      for (let c = 0; c < 3; c++) img.rgba[p + c] = Math.round(img.rgba[p + c] * (1 - cover[i]) + ink[c] * cover[i])
      if (cover[i] < 0.25) continue
      const px = i % img.width
      const py = Math.floor(i / img.width)
      box.x0 = Math.min(box.x0, px)
      box.y0 = Math.min(box.y0, py)
      box.x1 = Math.max(box.x1, px + 1)
      box.y1 = Math.max(box.y1, py + 1)
    }
    line.words.push({ text, conf: 95, box })
    x = at + size / 3
  }
  return line
}

describe('recognising text', () => {
  it('finds the font, weight, size and colour, and outlines every word', () => {
    const img = blank(560, 120, () => [245, 240, 230])
    const line = draw(img, style('Montserrat-700'), ['Fresh', 'coffee', 'roasted', 'daily'], 36, 20, 70, [29, 53, 87])
    const [run, ...rest] = matchText(img.rgba, img.width, img.height, [line], CANDIDATES)
    expect(rest).toEqual([])
    expect(run).toMatchObject({ text: 'Fresh coffee roasted daily', family: 'Montserrat', weight: 700 })
    // The ink's colour, give or take anti-aliasing.
    expect([1, 3, 5].map((i) => Math.abs(parseInt(run.fill.slice(i, i + 2), 16) - [29, 53, 87][(i - 1) / 2]))).toSatisfy((d: number[]) => d.every((v) => v <= 2))
    expect(Math.abs(run.size - 36) / 36).toBeLessThan(0.03)
    expect(run.score).toBeGreaterThan(0.8)
    expect(run.boxes).toHaveLength(4)
    expect(run.boxes[0].bg).toEqual([245, 240, 230, 255])
    // Redrawn where it was: the outline's ink lands on the image's.
    const redrawn = rasterize(parseD(run.d), img.width, img.height)
    let both = 0
    let either = 0
    for (let i = 0; i < redrawn.length; i++) {
      const was = img.rgba[i * 4] < 140 ? 1 : 0
      const now = redrawn[i] > 0.5 ? 1 : 0
      both += was & now
      either += was | now
    }
    expect(both / either).toBeGreaterThan(0.75)
  })

  it('tells a serif from its neighbours', () => {
    const img = blank(520, 90, () => [255, 255, 255])
    const line = draw(img, style('Lora-400'), ['Quality', 'you', 'can', 'trust'], 30, 16, 55, [17, 17, 17])
    const [run] = matchText(img.rgba, img.width, img.height, [line], CANDIDATES)
    expect(run).toMatchObject({ family: 'Lora', weight: 400 })
  })

  it('leaves alone what matches no font (OCR reading artwork as letters)', () => {
    // Scattered blobs, which OCR once read as "DN" on a ship's hull.
    const img = blank(200, 100, () => [255, 255, 255])
    for (let y = 20; y < 80; y++) for (let x = 20; x < 180; x++) if ((x * 7 + y * 13) % 11 < 4) img.rgba.set([60, 100, 150, 255], (y * 200 + x) * 4)
    const runs = matchText(img.rgba, img.width, img.height, [{ words: [{ text: 'DN', conf: 40, box: { x0: 20, y0: 20, x1: 180, y1: 80 } }] }], CANDIDATES)
    expect(runs).toEqual([])
    expect(MIN_SCORE).toBeGreaterThan(0)
  })

  it("keeps text traced on a busy background, where painting it out would leave a mark", () => {
    const img = blank(560, 120, (x) => [255 - (x % 120), 180, 90 + (x % 90)])
    const line = draw(img, style('Montserrat-700'), ['Fresh', 'coffee'], 36, 20, 70, [20, 20, 20])
    expect(matchText(img.rgba, img.width, img.height, [line], CANDIDATES)).toEqual([])
  })

  it('keeps columns side by side apart, each in its own font', () => {
    const img = blank(900, 90, () => [255, 255, 255])
    const left = draw(img, style('Montserrat-700'), ['Fresh', 'coffee'], 34, 16, 55, [17, 17, 17])
    const right = draw(img, style('Lora-400'), ['Quality', 'trust'], 34, 500, 55, [17, 17, 17])
    const runs = matchText(img.rgba, img.width, img.height, [left, right], CANDIDATES)
    expect(runs.map((r) => [r.text, r.family])).toEqual([
      ['Fresh coffee', 'Montserrat'],
      ['Quality trust', 'Lora'],
    ])
  })

  it('drops a word that matches the font badly, beside words that match it well', () => {
    const img = blank(700, 90, () => [255, 255, 255])
    const line = draw(img, style('Montserrat-700'), ['Fresh', 'coffee', 'roasted'], 34, 16, 55, [17, 17, 17])
    // Artwork at the end of the line, which OCR read as "Il".
    for (let y = 25; y < 60; y++) for (let x = 560; x < 600; x++) if ((x + y) % 5 < 2) img.rgba.set([17, 17, 17, 255], (y * 700 + x) * 4)
    line.words.push({ text: 'Il', conf: 60, box: { x0: 560, y0: 25, x1: 600, y1: 60 } })
    const [run] = matchText(img.rgba, img.width, img.height, [line], CANDIDATES)
    expect(run.text).toBe('Fresh coffee roasted')
    expect(run.boxes).toHaveLength(3)
  })

  it('keeps words whose apostrophe, comma or bracket is too faint to bound them, in small grey text', () => {
    // From a 404 page's small print, which once lost "we're", "you" and "see)" from its line.
    const img = blank(700, 60, () => [255, 255, 255])
    const line = draw(img, style('Montserrat-400'), ['Sorry,', "we're", 'having', 'technical', 'issues', '(as', 'you', 'see)'], 14, 10, 35, [110, 110, 110])
    const [run] = matchText(img.rgba, img.width, img.height, [line], CANDIDATES)
    expect(run.text).toBe("Sorry, we're having technical issues (as you see)")
    expect(Math.abs(run.size - 14) / 14).toBeLessThan(0.05)
  })

  it('takes the background again after it is removed, so painting out leaves it transparent', () => {
    const img = blank(560, 120, () => [255, 255, 255])
    const line = draw(img, style('Montserrat-700'), ['Fresh', 'coffee'], 36, 20, 70, [29, 53, 87])
    const runs = matchText(img.rgba, img.width, img.height, [line], CANDIDATES)
    for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 0
    rebackground(img.rgba, img.width, img.height, runs)
    expect(runs[0].boxes.every((b) => b.bg[3] === 0)).toBe(true)
  })

  it('paints out word boxes in their background, at the scale of the traced pixels', () => {
    const img = blank(40, 20, () => [0, 0, 0])
    paintOut(img.rgba, 40, 20, [{ text: 'a', family: 'X', weight: 400, size: 10, fill: '#000000', d: '', score: 1, boxes: [{ x0: 2, y0: 1, x1: 5, y1: 4, bg: [255, 0, 0, 255] }] }], 2)
    const red = (x: number, y: number) => img.rgba[(y * 40 + x) * 4] === 255
    expect(red(4, 2) && red(9, 7)).toBe(true)
    expect(red(3, 2) || red(10, 7) || red(4, 8)).toBe(false)
  })
})

describe("Tesseract's TSV", () => {
  it('becomes lines of words, back in the image’s pixels, without unsure or letterless words', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '4\t1\t2\t1\t1\t0\t160\t354\t320\t26\t-1\t',
      '5\t1\t2\t1\t1\t1\t160\t354\t140\t26\t96.1\tSomething',
      '5\t1\t2\t1\t1\t2\t310\t360\t82\t20\t96.0\twrong',
      '5\t1\t2\t1\t1\t3\t403\t354\t77\t20\t12.0\there',
      '5\t1\t3\t1\t1\t1\t125\t396\t36\t12\t92.2\tSorry,',
      '5\t1\t3\t1\t1\t2\t166\t396\t35\t10\t91.9\t:)',
    ].join('\n')
    expect(linesFromTsv(tsv, 2)).toEqual([
      { words: [{ text: 'Something', conf: 96.1, box: { x0: 80, y0: 177, x1: 150, y1: 190 } }, { text: 'wrong', conf: 96, box: { x0: 155, y0: 180, x1: 196, y1: 190 } }] },
      { words: [{ text: 'Sorry,', conf: 92.2, box: { x0: 62, y0: 198, x1: 81, y1: 204 } }] },
    ])
  })
})

/** Path data as written by matchText (absolute M L Q C Z) back to commands. */
function parseD(d: string): PathCommand[] {
  const out: PathCommand[] = []
  for (const [, type, args] of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = args.trim() ? args.trim().split(/[ ,]+/).map(Number) : []
    if (type === 'Z') out.push({ type: 'Z' })
    else if (type === 'Q') out.push({ type: 'Q', x1: n[0], y1: n[1], x: n[2], y: n[3] })
    else if (type === 'C') out.push({ type: 'C', x1: n[0], y1: n[1], x2: n[2], y2: n[3], x: n[4], y: n[5] })
    else out.push({ type: type as 'M' | 'L', x: n[0], y: n[1] })
  }
  return out
}
