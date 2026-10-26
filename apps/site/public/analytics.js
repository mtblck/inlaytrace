/*
 * Vercel Web Analytics: cookieless page views, read by mattblack.space/analytics.
 *
 * Vercel serves /_vercel/insights/ only on its own deployments, so the script
 * is left out on localhost, where it would 404.
 * A file rather than an inline script, because the CSP is script-src 'self'.
 * Counts page views only: no cookies, and never the images (docs/features/privacy-and-security.md).
 */
;(function () {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return
  var s = document.createElement('script')
  s.defer = true
  s.src = '/_vercel/insights/script.js'
  document.head.appendChild(s)
})()
