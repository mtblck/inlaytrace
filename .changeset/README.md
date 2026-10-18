# Changesets

Each change to the `inlaytrace` package that users would notice gets a
changeset: a small Markdown file saying how to bump the version and what to put
in the changelog. Add one with `npx changeset`, or write it by hand:

```md
---
'inlaytrace': patch
---

Corners at junctions of three colours no longer drift by half a pixel.
```

While the package is 0.x, `minor` means a breaking change and `patch` anything
else. Changes to the app, the site or the docs don't need one.

To release: `npm run version-packages` on a branch (it runs `changeset
version`, which bumps `packages/inlay/package.json` and writes
`packages/inlay/CHANGELOG.md`, then updates the lockfile to match), and merge
that PR. The release workflow publishes any version that isn't on npm yet.
