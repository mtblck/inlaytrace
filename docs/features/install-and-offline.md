---
order: 8.5
---

# Install and offline

After one visit the app works offline: a service worker keeps the app's own
files in the browser, so it opens, traces, edits and exports with no
connection. It can also be **installed** as an app (in Chrome and Edge,
*Install Inlay* in the address bar or menu; on iOS, *Share → Add to Home
Screen*), opening in its own window.

What's cached, and when:

- **The app** (its code, styles, fonts and workers, about 1 MB) on the first
  visit, all at once. Pages check the network first, so a new version shows
  the next time you open it; the old copy is deleted once the new one takes
  over.
- **The AI models and their runtime** (*Prepare*, about 13 MB) only the first
  time you use them, then offline from then on. Nobody who doesn't use them
  downloads them.

Nothing about your images is in this cache: it's the app's files only. Your
session (the image and edits) is kept separately, as before; see
[Privacy and security](privacy-and-security.md). Clearing this site's data in
your browser removes both.

The service worker is built with the app (`apps/app/sw.template.js`, filled in
by a plugin in `apps/app/vite.config.ts` with the list of built files and a
version hash), and `hosting:check` fails the build if it's missing or would
download the models up front. `npm run verify` loads the app once, goes
offline, reloads and traces the sample.
