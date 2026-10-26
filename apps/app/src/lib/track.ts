/**
 * "Used it" counts for mattblack.space/analytics (mtblck/boards docs/events.md).
 * Sends only the event's name: never the image, its name, the settings or
 * anything about the visitor. Same-origin: vercel.json rewrites /_mb/events to
 * Boards, so the app's CSP stays connect-src 'self'. Skipped off inlaytrace.com
 * (localhost, previews), so tests and dev never count.
 */
export type UsedIt = 'traced' | 'downloaded'

const once = new Set<string>()

/** @param key Count this event once per key per page load, e.g. once per image. */
export function track(event: UsedIt, key?: string) {
  if (location.hostname !== 'inlaytrace.com' || typeof navigator.sendBeacon !== 'function') return
  if (key !== undefined) {
    if (once.has(`${event}:${key}`)) return
    once.add(`${event}:${key}`)
  }
  navigator.sendBeacon('/_mb/events', JSON.stringify({ project: 'inlay', event }))
}
