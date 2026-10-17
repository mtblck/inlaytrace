---
order: 6
---

# Undo and the edit model

## Undo and redo

*Undo* and *Redo* in the Edit tab, or ⌘/Ctrl + Z and ⇧⌘Z / Ctrl + Y. Up to 100
steps.

One step is one thing you meant to do: a whole node drag, one session in a
colour picker, one mirror. Adding a background and then choosing its colour are
two steps.

## What survives a re-trace

The document is three things (`src/lib/doc.ts`):

| Part | Holds | On re-trace |
| --- | --- | --- |
| `inks` | Colour replacements and removals, keyed by traced colour | Kept |
| `background` | The background colour, or none | Kept |
| `doc` | Your edited shapes, or nothing | See below |

`doc` stays empty, meaning "whatever the tracer produces", until your first
shape edit (a node drag, a delete, a mirror). That edit copies the trace into an
editable document, and the Edit tab gets a dot to show it.

From then on, changing a trace setting or opening another image would throw
those edits away, so it asks first:

- **Changing a setting:** *Discard edits and re-trace* or *Keep editing*. If you
  discard, Undo brings the edited shapes back.
- **Opening another image:** this one *can't* be undone, and the prompt says so.

## How it works

Undo stores whole snapshots rather than inverse operations. Every edit already
makes a new immutable document, unchanged shapes are shared between snapshots,
and there's no inverse of a boolean union to get wrong. A key on each edit
coalesces bursts (a drag sends dozens of updates) into one step, and every edit
is computed from the latest state, so an edit that finishes late (a mirror
waiting for paper.js to load) never reverts changes made in the meantime.
