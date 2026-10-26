import { afterEach, describe, expect, it, vi } from 'vitest'

async function load(hostname: string) {
  vi.resetModules()
  const sendBeacon = vi.fn(() => true)
  vi.stubGlobal('location', { hostname })
  vi.stubGlobal('navigator', { sendBeacon })
  const { track } = await import('./track')
  return { track, sendBeacon }
}

afterEach(() => vi.unstubAllGlobals())

describe('track', () => {
  it('sends only the project and event name, same-origin', async () => {
    const { track, sendBeacon } = await load('inlaytrace.com')
    track('downloaded')
    expect(sendBeacon).toHaveBeenCalledWith('/_mb/events', '{"project":"inlay","event":"downloaded"}')
  })

  it('counts a keyed event once per key', async () => {
    const { track, sendBeacon } = await load('inlaytrace.com')
    track('traced', 'logo.png')
    track('traced', 'logo.png')
    track('traced', 'badge.png')
    expect(sendBeacon).toHaveBeenCalledTimes(2)
  })

  it('never counts off the live site', async () => {
    for (const host of ['localhost', 'img-to-svg-git-x-mtblcks-projects.vercel.app']) {
      const { track, sendBeacon } = await load(host)
      track('downloaded')
      expect(sendBeacon).not.toHaveBeenCalled()
    }
  })
})
