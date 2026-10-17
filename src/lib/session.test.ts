import { describe, expect, it } from 'vitest'
import { checkEdits, checkSettings } from './session'
import { settingsFor } from '../engine/presets'

describe('restoring a saved session', () => {
  it('fills settings from the preset and keeps only well-typed saved fields', () => {
    expect(checkSettings(null)).toEqual(settingsFor('logo'))
    expect(checkSettings({ preset: 'nope', colors: 3 })).toMatchObject({ preset: 'logo', colors: 3 })
    const s = checkSettings({ preset: 'illustration', colors: 'many', smoothing: 2, shapes: 'weird', merge: { '#ff0000': '#00ff00', bad: '#000000', '#0000ff': 5 } })
    expect(s.preset).toBe('illustration')
    expect(s.colors).toBe(settingsFor('illustration').colors)
    expect(s.smoothing).toBe(2)
    expect(s.shapes).toBe(settingsFor('illustration').shapes)
    expect(s.merge).toEqual({ '#ff0000': '#00ff00' })
  })
  it('drops malformed edits rather than letting them into markup or files', () => {
    expect(checkEdits('x')).toEqual({ inks: { recolor: {}, removed: [] }, doc: null, background: null })
    const e = checkEdits({
      inks: { recolor: { '#ff0000': '#00ff00', '#00ff00': 'red"/><script>' }, removed: ['#0000ff', 7] },
      background: 'not a colour',
      doc: { width: 10, height: 10, paths: [{ id: 'p1', d: 'M0 0L1 1Z', fill: '#ff0000' }, { id: 2 }] },
    })
    expect(e.inks).toEqual({ recolor: { '#ff0000': '#00ff00' }, removed: ['#0000ff'] })
    expect(e.background).toBeNull()
    expect(e.doc!.paths).toHaveLength(1)
  })
})
