---
order: 7
---

# Export

The bottom of the panel, with live **Paths**, **Nodes** and **Size**.

| Button | Gives you |
| --- | --- |
| **Download SVG** | `<name>.svg`, optimised |
| **Copy SVG** | The same markup on the clipboard |
| **Layers (.zip)** | One SVG per colour, plus the background and the whole drawing |

## What's in the SVG

- A `viewBox` at the traced size, so it scales cleanly.
- The background first (if set), then every visible shape, largest first.
- Removed colours are simply absent, so those areas are truly transparent.
- No editor furniture: overlays, selection and the mirror axis are never part
  of it.

It's optimised with SVGO (`preset-default`, multipass, two decimals) in the
background after each change. The numbers in the panel come from that
optimised file, so they're the numbers you download. SVGO may write the
background rectangle as a path.

## The layers zip

For screen printing, vinyl cutting or anything else that wants one file per
colour:

| File | Contains |
| --- | --- |
| `<name>-00-background-<hex>.svg` | The background alone, if set |
| `<name>-01-<hex>.svg`, `-02-…` | Each remaining colour, most-used first, named by its *shown* colour |
| `<name>-all.svg` | The whole drawing |

With the flat-art presets, neighbouring layers share their edges exactly, so
they register perfectly when printed or cut.
