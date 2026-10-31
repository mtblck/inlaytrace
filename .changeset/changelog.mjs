// Changelog lines for `changeset version`: the changeset's text as written,
// without the commit hash the default puts in front, so a version's section
// reads as release notes (scripts/changelog.mjs copies it to the docs and the
// GitHub release).
export default {
  getReleaseLine: (changeset) => {
    const [first, ...rest] = changeset.summary.split('\n').map((l) => l.trimEnd())
    return [`- ${first}`, ...rest.map((l) => (l ? `  ${l}` : ''))].join('\n')
  },
  // The workspace has one published package, so nothing depends on it.
  getDependencyReleaseLine: () => '',
}
