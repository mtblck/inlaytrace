/*
 * Inlay's service worker, so the app installs and works offline.
 * Built by the Vite plugin in vite.config.ts, which fills in VERSION and the
 * app shell's files (every built file but the AI models and runtime).
 *
 * - The app shell is cached on install, all at once, and served from the
 *   cache: hashed files never change, so they're always right.
 * - Pages (navigations) go to the network first, so a new version shows on
 *   the next visit, and fall back to the cached page offline.
 * - The AI models and runtime (about 13 MB) are cached the first time they're
 *   used, not on install, so nobody downloads them who doesn't use them.
 * - An old version's caches are deleted once the new one takes over.
 */
const VERSION = '__VERSION__'
const SHELL = __SHELL__
const BASE = '__BASE__'
const SHELL_CACHE = `inlay-shell-${VERSION}`
const ON_USE_CACHE = 'inlay-on-use'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('inlay-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(BASE, { cacheName: SHELL_CACHE }).then((r) => r || caches.match(`${BASE}index.html`))),
    )
    return
  }
  const onUse = /\.(onnx|wasm)$/.test(url.pathname)
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (onUse && res.ok) {
            const copy = res.clone()
            caches.open(ON_USE_CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
