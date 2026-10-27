import { describe, expect, it } from 'vitest'
import { checkEdits, checkSettings } from './session'
import { settingsFor } from '../engine/presets'
import { buildSvg, groupPaths, reserveGroups } from './doc'

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
    expect(checkSettings({ preset: 'logo', recogniseText: true }).recogniseText).toBe(true)
    expect(checkSettings({ preset: 'logo', recogniseText: 'yes' }).recogniseText).toBe(false)
  })
  it("keeps Line art's threshold mode: Auto, a level, or Uneven light", () => {
    expect(checkSettings({ preset: 'lineart', threshold: 'auto' }).threshold).toBe('auto')
    expect(checkSettings({ preset: 'lineart', threshold: 90 }).threshold).toBe(90)
    expect(checkSettings({ preset: 'lineart', threshold: null }).threshold).toBeNull()
    expect(checkSettings({ preset: 'lineart', threshold: 'dark' }).threshold).toBe('auto')
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

describe('groups in a saved session', () => {
  it('keep their ids, drop malformed ones, and new groups get fresh ids', () => {
    const saved = {
      inks: { recolor: {}, removed: [] },
      background: null,
      doc: {
        width: 10,
        height: 10,
        paths: [
          { id: 'p1', d: 'M0 0L1 0L1 1Z', fill: '#000000', group: 'g7' },
          { id: 'p2', d: 'M0 0L1 0L1 1Z', fill: '#000000', group: 'g7' },
          { id: 'p3', d: 'M0 0L1 0L1 1Z', fill: '#000000', group: '"><script>' },
          { id: 'p4', d: 'M0 0L1 0L1 1Z', fill: '#000000' },
        ],
      },
    }
    const doc = checkEdits(saved).doc!
    expect(doc.paths.map((p) => p.group)).toEqual(['g7', 'g7', undefined, undefined])
    reserveGroups(doc)
    const regrouped = groupPaths(doc, ['p3', 'p4'])
    expect(regrouped.paths.find((p) => p.id === 'p3')!.group).not.toBe('g7')
    expect(Number(regrouped.paths.find((p) => p.id === 'p3')!.group!.slice(1))).toBeGreaterThan(7)
  })

  it('a group left with one shape exports as just that shape', () => {
    const doc = checkEdits({ inks: { recolor: {}, removed: [] }, background: null, doc: { width: 10, height: 10, paths: [{ id: 'p1', d: 'M0 0L1 0L1 1Z', fill: '#000000', group: 'g3' }] } }).doc!
    expect(buildSvg(doc)).not.toContain('<g')
  })
})
