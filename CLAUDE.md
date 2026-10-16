# img-to-svg

Browser-based raster → SVG converter. Portfolio piece and personal tool, served
at https://mattblack.space/tools/img-to-svg/. Follow the `portfolio-tool` skill
for stack, hosting and portfolio-listing conventions.

## Load-bearing decisions

- **Client-only by default.** Tracing and AI preprocessing run in the browser
  (Web Worker + WASM/WebGPU). Images never leave the device unless the user picks
  an explicitly labelled server mode.
- **Engine: VTracer** (MIT/Apache). Do **not** bundle Potrace
  (GPL) or anything `@imgly/*` (AGPL) into the client. AI weights must be
  MIT/BSD/Apache — RMBG-1.4/2.0 are non-commercial.
- **Paths:** Vite `base: '/tools/img-to-svg/'`, `build.outDir:
  'dist/tools/img-to-svg'`, so the build works identically on its own Vercel
  deployment and proxied through mb-portfolio.
- **No Supabase.** A server step (paid "HD" API proxy) is a Vercel Function in
  this project, with per-IP and global spend caps. Never put API keys in client code.
- Vercel Functions cap bodies at 4.5 MB: downscale before sending.

Background and the evidence for all of the above: `docs/research.md`.
