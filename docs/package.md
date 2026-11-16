---
order: 5
---

# The package

Inlay is also a library, `inlaytrace`: the same tracer the app uses, for your
own code. Pure TypeScript with no DOM and no WebAssembly, so it runs in
browsers, Web Workers and Node. MIT licensed.

It's on npm as [`inlaytrace`](https://www.npmjs.com/package/inlaytrace)
(`npm install inlaytrace`). Versions are 0.x while the API settles; the
[changelog](https://github.com/mtblck/inlaytrace/blob/main/packages/inlay/CHANGELOG.md)
says what changed.

- [Getting started](package/getting-started.md): install, and a first trace
  in the browser and in Node.
- [Options](package/options.md): every mode and setting, and what to start
  with for logos, illustrations, line art and pixel art.
- [API reference](package/api.md): every export.

## Versions

Until 1.0, a minor version (0.3 → 0.4) may change the API, and the changelog
says how. From 1.0 on, versions follow these rules.

A tracer gets better by changing what it draws, so "the same image gives the
same SVG" is not the promise. What a version number promises is the API, and
that the traces don't get worse.

- **Major (2.0):** renaming or removing an export, an option or a preset;
  changing a result type; changing what an option means; raising the minimum
  Node version or dropping a browser.
- **Minor (1.1):** a new option, preset or export; changes to the traced
  output, such as different paths, colours or shape counts, as long as the
  measured quality (`npm run score`, error against the source and node count)
  doesn't get worse.
- **Patch (1.0.1):** bug fixes. A fix that changes output on the images it
  was broken for is a patch.

Supported: Node 20 or newer, current browsers and Web Workers, ESM only. An
export the [API reference](package/api.md) doesn't list isn't part of the API.
If you need byte-identical output, pin an exact version.

