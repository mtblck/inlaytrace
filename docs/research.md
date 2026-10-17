---
order: 90
---

# Research: image → SVG (October 2026)

Survey done before any code was written, to decide what to build on. Versions
and licenses below were checked against npm/crates/docs on 2026-10-16; items
marked *unverified* could not be confirmed and should be re-checked before
they become load-bearing.

## The headline

**No downloadable AI model beats a good classical tracer at image → SVG.** In
the OmniSVG paper's own benchmark, VTracer matches or beats every learned model
on icons (DINO 0.993) and clearly beats them on illustrations (0.994 vs 0.899
for OmniSVG, worse still for StarVector-8B). The learned models need a 16 GB+
GPU and take 10–80 s per image. Where AI genuinely helps is *around* the
tracer: removing backgrounds, upscaling low-res JPEG logos, segmenting regions
— and those models run in the browser.

So the plan is a classical tracer in the browser, AI preprocessing in the
browser, and an optional paid "HD" mode behind a server function with a cap.

## Classical tracers

| Engine | License | Browser | Notes |
| --- | --- | --- | --- |
| **VTracer** (visioncortex) | MIT OR Apache-2.0 | Yes (WASM) | Colour + B/W, stacked or cutout shapes, spline/polygon/pixel modes. 1.0.0-alpha.4 (2026-08-29) adds `simplify`, fixed `palette` (OKLab matching), `maxColors`, adaptive threshold, presets. **Best base.** |
| `vtracer-wasm` (jsscheller) | MIT | Yes, ESM | 0.1.0, ~59 KB gzipped wasm, wraps the older 0.8.8 engine — classic settings only. Fastest way to start. |
| `@visioncortex/vtracer` | MIT OR Apache-2.0 | **No, as published** | Official 1.0 package loads its wasm with `fs.readFileSync` (Node only). Rebuild the repo's crate with `wasm-pack --target web` to get 1.0 features in the browser. |
| Potrace / `esm-potrace-wasm` | **GPL-2.0** | Yes | B/W only (colour via posterize + layering). Smooth curves. Bundling it into the client makes the shipped bundle GPL. Avoid unless the repo goes GPL, or run it server-side. |
| imagetracerjs | Unlicense | Yes | Unmaintained since 2020; noisier, larger output than VTracer. |
| Open Vectorizer (vardirhq) | MIT | Yes (Rust/WASM, ~150 KB) | New. Sub-pixel edges via anti-aliasing, recovers real `<circle>/<rect>/<ellipse>`. Logos only, no gradients, 2048 px cap. *npm availability unverified.* Worth a look as a second "geometric" engine. |
| AutoTrace | GPL / LGPL | No maintained WASM | Has **centerline** tracing (useful for line art / plotters). Server-side only. |
| Inkscape CLI | GPL | — | Trace doesn't work headless. Not viable. |

Supporting pieces: **SVGO 4.1** (MIT, `svgo/browser`, ~195 KB gz — lazy-load),
**image-q** (MIT, quantizers; probably redundant once on VTracer 1.0's
`maxColors`), **OpenCV.js** (Apache-2.0 but 3.8 MB gz — too heavy for what we
need; canvas filters suffice).

## AI models

**Image → SVG code models** (all need a CUDA GPU, none run in a browser):

- **StarVector 1B/8B** — Apache-2.0 code and weights. Good on icons, its own
  README says it does not work on illustrations or photos. Hosted only on fal
  (`fal-ai/star-vector`, ~$0.10/MP).
- **OmniSVG 1.1 (4B/8B)** — Apache-2.0 weights (training data is CC BY-NC-SA).
  ~16 GB VRAM, 18–83 s per image. HF Space demo only.
- **InternSVG-8B** — Apache-2.0 code, weights license unclear.
- VFig, VectorArk, LayerPeeler — papers without released weights yet.

**Vision LLMs writing SVG** (Claude, GPT, Gemini): semantically clean output —
real shapes, text kept as `<text>`, small files — but geometry only
approximates the source. Good for simple logos and diagrams, poor for detailed
art. In SVGenius, Claude 3.7 Sonnet led the easy tier. Roughly $0.01–0.06 per
image (*estimate*).

**Optimization methods** (DiffVG, LIVE, SuperSVG): high fidelity, research-grade.
LIVE is hours per image; DiffVG minutes. Not product-viable.

**Preprocessing that runs in the browser** (transformers.js / ONNX Runtime Web,
WebGPU in Chromium; partial elsewhere):

| Model | Job | License |
| --- | --- | --- |
| BiRefNet_lite (ONNX) | Background removal | MIT |
| SlimSAM-77 / SAM 2.1 tiny | Click-to-select regions | Apache-2.0 (*SAM2 from memory*) |
| Real-ESRGAN (x4 / general) | Upscale + denoise low-res logos before tracing | BSD-3 (*from memory*) |

Avoid: **RMBG-1.4 / 2.0** (Bria, non-commercial), **`@imgly/background-removal`**
and **`@imgly/vectorizer`** (AGPL-3.0).

## Hosted APIs (for an optional "HD" mode)

| Service | Price | Notes |
| --- | --- | --- |
| **Recraft Vectorize** | $0.01/image | Direct, or via fal / Picsart. 256–4096 px. No colour-count control. Inputs train their models by default (opt-out). Cheapest good option. |
| **Vectorizer.ai** | $0.05–0.20/image | Most controls (`max_colors`, palette, stacked/cutout, SVG/EPS/PDF/DXF). Free watermarked `test` mode for building the integration. Commercial terms *unverified*. |
| fal StarVector | ~$0.10/MP | Icons only. |
| Adobe Image Trace API | Beta, enterprise-ish | Not realistic for a hobby project. |
| Vector Magic | No public API | — |

## Platform constraints

- **Vercel Functions:** 4.5 MB request/response body on every plan (413 above
  it) — downscale in the browser before sending. Hobby: 300 s max, 2 GB.
  **Hobby is non-commercial** — fine for a portfolio piece; ads or paid
  features would need Pro.
- **Supabase Edge Functions:** 2 s CPU per request, 256 MB. Fine as an API
  proxy, unusable for tracing itself. Not needed: a Vercel Function in this
  project covers the proxy case without a new Supabase project.

## Where the gaps are

The good server tools (Vectorizer.ai, Vector Magic, vectorizer.io) charge for
downloads; the free browser tools (SVGcode, VTracer's demo) have thin controls
and no palette editing. Nothing surveyed offered:

1. **Free + private** with an editable palette and region recolour — images never leave the device.
2. **A real diff view** — split slider or overlay with a per-pixel error heatmap.
3. **Live complexity budget** — path, node and byte counts as you drag, with a target file size.
4. **Per-colour layer export** — one group or file per colour, for screen printing and vinyl cutting.
5. **Purpose presets** — logo, line art, pixel art, poster/photo; centerline for line art.

## Recommended architecture

1. **Core, free, client-only.** VTracer in a Web Worker (start on
   `vtracer-wasm`, move to a `wasm-pack --target web` build of 1.0 for
   `simplify`/`palette`/`maxColors`) → SVGO. Presets, diff view, palette
   editing, layer export.
2. **AI assist, still client-only.** Lazy-loaded BiRefNet_lite background
   removal and Real-ESRGAN upscale, models cached in OPFS. Only MIT/BSD/Apache
   weights.
3. **Optional HD mode, server.** A Vercel Function proxying Recraft ($0.01) with
   a per-IP daily cap and a global spend cap — or a vision-LLM "semantic SVG"
   mode for logos with text, scored against the input in the browser and
   falling back to VTracer when it loses.

Skip self-hosting StarVector/OmniSVG: GPU cost, 10–80 s latency, and no
quality win over VTracer.

## Sources

- VTracer: https://github.com/visioncortex/vtracer · https://www.npmjs.com/package/@visioncortex/vtracer · https://www.npmjs.com/package/vtracer-wasm
- Potrace: https://potrace.sourceforge.net/ · https://www.npmjs.com/package/esm-potrace-wasm
- imagetracerjs: https://github.com/jankovicsandras/imagetracerjs
- Open Vectorizer: https://github.com/vardirhq/open-vectorizer
- SVGcode: https://github.com/tomayac/SVGcode
- SVGO: https://www.npmjs.com/package/svgo
- StarVector: https://huggingface.co/starvector/starvector-8b-im2svg · https://fal.ai/models/fal-ai/star-vector/llms.txt
- OmniSVG: https://huggingface.co/OmniSVG/OmniSVG1.1_4B · https://arxiv.org/html/2504.06263v3
- InternSVG: https://github.com/hmwang2002/InternSVG
- SVGenius: https://arxiv.org/pdf/2506.03139
- SuperSVG: https://github.com/sjtuplayer/SuperSVG
- BiRefNet ONNX: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX
- RMBG-2.0 license: https://github.com/Bria-AI/RMBG-2.0
- @imgly/background-removal: https://www.npmjs.com/package/@imgly/background-removal
- Recraft: https://www.recraft.ai/docs/api-reference/tools/vectorize · https://www.recraft.ai/docs/api-reference/pricing
- Vectorizer.ai: https://vectorizer.ai/pricing · https://vectorizer.ai/api/documentation
- Adobe Image Trace: https://developer.adobe.com/firefly-services/docs/illustrator/guides/image-trace/
- Vercel limits: https://vercel.com/docs/functions/limitations · https://vercel.com/docs/limits/fair-use-guidelines
- Supabase limits: https://supabase.com/docs/guides/functions/limits
