/*
 * Vercel Web Analytics: cookieless page views, for Vercel's own dashboard.
 *
 * Vercel serves /_vercel/insights/ only on its own deployments, so the script
 * is left out on localhost, where it would 404.
 * A file rather than an inline script, because the CSP is script-src 'self'.
 * Counts page views only: no cookies, and never the images (docs/features/privacy-and-security.md).
 * Keep apps/app/public/analytics.js and apps/site/public/analytics.js identical (ADR 0001).
 */
;(function () {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return
  var s = document.createElement('script')
  s.defer = true
  s.src = '/_vercel/insights/script.js'
  document.head.appendChild(s)
})()

/*
 * Page views for mattblack.space/analytics, through the shared counter
 * (mtblck/boards docs/events.md). Sends the project name and, when someone
 * arrives from another site, that site's hostname: never the page, a cookie
 * or an id. Client-side navigations count too. Only on inlaytrace.com, so dev
 * and previews don't count.
 */
;(function () {
  if (location.hostname !== 'inlaytrace.com' || typeof navigator.sendBeacon !== 'function') return
  var arrival = true
  var path = location.pathname
  function view() {
    var body = { project: 'inlay', event: 'pageview' }
    if (arrival) {
      arrival = false
      // document.referrer is empty or a whole URL, so this never throws.
      var ref = document.referrer ? new URL(document.referrer).hostname : ''
      if (ref !== location.hostname) {
        body.visit = true
        body.ref = ref
      }
    }
    navigator.sendBeacon('/_mb/events', JSON.stringify(body))
  }
  function moved() {
    if (location.pathname === path) return
    path = location.pathname
    view()
  }
  var push = history.pushState
  history.pushState = function () {
    push.apply(this, arguments)
    moved()
  }
  addEventListener('popstate', moved)
  view()
})()
