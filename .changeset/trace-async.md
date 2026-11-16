---
'inlaytrace': minor
---

New `traceAsync(image, { signal, onProgress, …options })`: the same trace as `trace`, but it pauses between stages to report progress, gives the thread time to do other work, and stops when its `AbortSignal` aborts.
