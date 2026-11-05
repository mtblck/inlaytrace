---
public: false
---

# 0006: Merging the version PR publishes the package

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** [#225](https://github.com/mtblck/inlaytrace/pull/225)

## Context

Since October 20, 2026, `release.yml` only *staged* each version on
npm (`npm stage publish`): nothing went public until Matt approved it with
two-factor authentication, and then someone re-ran the workflow to tag it and
make the GitHub release. Matt found it hadn't caught anything: every staged
version was approved as built, so it added a manual step and lag for no gain. It also meant Claude's
sessions couldn't finish a release. seedkin, Matt's other npm package, has
published straight from its release workflow since its ADR 0016 (merging the
release PR is the approval), with no problems.

## Decision

`release.yml` publishes with `npm publish --provenance` through npm trusted
publishing when a merge to `main` changes the package's version, then tags it
`inlaytrace@x.y.z` and makes the GitHub release in the same run. Merging the
`npm run version-packages` PR is the approval: Claude opens it and merges it
only on Matt's go. Changesets stay.

## Consequences

A release is one merge, and Claude can carry it end to end. The gate is now
procedural, not a second factor: anyone who can merge a version bump to `main`
publishes, so a version bump belongs only in a version-packages PR. The trusted
publisher on npmjs.com has to allow publishing, not only staging. If a gate
inside GitHub is wanted again, a `release` environment with Matt as required
reviewer can be added to the job (and named on the trusted publisher).
