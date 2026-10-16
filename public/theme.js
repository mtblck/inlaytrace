// Runs before first paint (blocking, in <head>) so a dark-mode visitor never
// sees a light flash. Kept as a file rather than inline so the CSP can stay at
// script-src 'self' without hashes.
try {
  var t = localStorage.getItem('theme')
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.dataset.theme = 'dark'
} catch (e) {}
