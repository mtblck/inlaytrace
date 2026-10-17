# Security

## Reporting a vulnerability

Please report privately, not in a public issue:

- **GitHub:** the repo's *Security* tab → *Report a vulnerability* (private to
  the maintainer), or
- **Email:** [hello@inlaytrace.com](mailto:hello@inlaytrace.com).

Include what you found, how to reproduce it, and what it lets someone do. I
aim to reply within a week. Fixes go out on `main` (the app and site deploy from
it) and, once the package is published, in a new `inlaytrace` release.

## What's in scope

Inlay runs entirely in the browser: images are never uploaded and there is no
server-side code. The things worth reporting are:

- **Markup injection.** The app draws the traced SVG inline. Path data, colours
  and transforms are validated before they become markup; a way to get script
  or arbitrary markup through an image, a saved session or a pasted value is a
  vulnerability.
- **The content security policy.** `vercel.json` sets a strict policy for the
  app and for the site. A bypass, or a page that works only because the policy
  is looser than it says, is in scope.
- **Data leaving the device.** Any request that sends image data or a session
  anywhere.
- **The package.** Input that makes `inlaytrace` hang, exhaust memory far beyond
  the image's size, or crash a worker.
- **Supply chain.** A dependency or workflow that could ship code nobody here
  wrote.

Out of scope: results that are only visually wrong (please open a bug), and
issues in the hosting provider itself.
