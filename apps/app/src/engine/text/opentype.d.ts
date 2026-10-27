// The parts of opentype.js (MIT, ships no types) that text recognition uses.
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' }
  export class Path {
    commands: PathCommand[]
  }
  export class Glyph {
    index: number
    advanceWidth?: number
    getPath(x: number, y: number, fontSize: number): Path
  }
  export class Font {
    unitsPerEm: number
    charToGlyph(c: string): Glyph
    charToGlyphIndex(c: string): number
    getKerningValue(left: Glyph, right: Glyph): number
  }
  export function parse(buffer: ArrayBuffer): Font
}
