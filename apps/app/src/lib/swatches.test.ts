import { describe, expect, it } from 'vitest'
import { swatchColors, toAse, toCss, toGpl } from './swatches'

describe('swatchColors', () => {
  it('lists colours as drawn, in paint order, background first, each once', () => {
    expect(swatchColors([{ fill: '#FF0000' }, { fill: '#00ff00' }, { fill: '#ff0000' }], '#fff')).toEqual(['#ffffff', '#ff0000', '#00ff00'])
    expect(swatchColors([{ fill: '#123456' }])).toEqual(['#123456'])
  })
  it('lists a gradient shape by the colours it draws, its stops', () => {
    const gradient = { stops: [{ color: '#ff0000' }, { color: '#0000ff' }] }
    expect(swatchColors([{ fill: '#800080', gradient }, { fill: '#00ff00' }])).toEqual(['#ff0000', '#0000ff', '#00ff00'])
  })
})

describe('GIMP palette', () => {
  it('has the header and one line per colour, named by hex', () => {
    expect(toGpl(['#1d3557', '#ffffff'], 'logo\nbad')).toBe('GIMP Palette\nName: logo bad\nColumns: 0\n#\n 29  53  87\t#1d3557\n255 255 255\t#ffffff\n')
  })
})

describe('CSS', () => {
  it('writes custom properties named by hex', () => {
    expect(toCss(['#1d3557', '#e63946'])).toBe(':root {\n  --color-1d3557: #1d3557;\n  --color-e63946: #e63946;\n}\n')
  })
})

describe('Adobe Swatch Exchange', () => {
  // Read back by the published layout, independently of how it was written.
  function readAse(bytes: Uint8Array) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const sig = String.fromCharCode(...bytes.slice(0, 4))
    const version = [v.getUint16(4), v.getUint16(6)]
    const count = v.getUint32(8)
    const colors: { name: string; model: string; values: number[]; type: number }[] = []
    let o = 12
    for (let i = 0; i < count; i++) {
      expect(v.getUint16(o)).toBe(0x0001)
      const len = v.getUint32(o + 2)
      const end = o + 6 + len
      let p = o + 6
      const n = v.getUint16(p)
      p += 2
      let name = ''
      for (let k = 0; k < n; k++, p += 2) name += String.fromCharCode(v.getUint16(p))
      const model = String.fromCharCode(...bytes.slice(p, p + 4))
      p += 4
      const values = [0, 1, 2].map((k) => v.getFloat32(p + k * 4))
      p += 12
      const type = v.getUint16(p)
      p += 2
      expect(p).toBe(end)
      colors.push({ name, model, values, type })
      o = end
    }
    expect(o).toBe(bytes.length)
    return { sig, version, count, colors }
  }

  it('matches the published layout, byte for byte', () => {
    const r = readAse(toAse(['#ff8000', '#1d3557']))
    expect(r.sig).toBe('ASEF')
    expect(r.version).toEqual([1, 0])
    expect(r.count).toBe(2)
    expect(r.colors[0]).toMatchObject({ name: '#ff8000\0', model: 'RGB ', type: 2 })
    expect(r.colors[0].values.map((x) => Math.round(x * 255))).toEqual([255, 128, 0])
    expect(r.colors[1].values.map((x) => Math.round(x * 255))).toEqual([29, 53, 87])
  })

  it('starts with the known header bytes', () => {
    const b = toAse(['#000000'])
    expect([...b.slice(0, 12)]).toEqual([0x41, 0x53, 0x45, 0x46, 0, 1, 0, 0, 0, 0, 0, 1])
    // Block: type 0x0001, length 2 + 16 + 4 + 12 + 2 = 36, name length 8 ("#000000" + null).
    expect([...b.slice(12, 20)]).toEqual([0, 1, 0, 0, 0, 36, 0, 8])
    expect(b.length).toBe(12 + 6 + 36)
  })
})
