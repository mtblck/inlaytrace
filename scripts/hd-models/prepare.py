"""
Fetch, convert and try HD mode's models, on a GitHub Actions runner (the dev
sandbox can't reach the model hosts). Writes:

  models/   the ONNX files and manifest.json (name, bytes, sha256, source, licence)
  report/   README.md and side-by-side sheets: BiRefNet against remove.bg, and
            Real-ESRGAN x4plus against the in-browser x4v3

Run by .github/workflows/hd-models.yml. Env: GITHUB_TOKEN (to list releases),
REMOVE_BG_KEY (optional: without it the comparison is skipped),
BIREFNET_ASSETS (optional: comma-separated release asset names to try).
"""
import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import requests
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "models"
REPORT = ROOT / "report"
SHEETS = REPORT / "sheets"
for d in (MODELS, REPORT, SHEETS):
    d.mkdir(parents=True, exist_ok=True)

GH = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get("GITHUB_TOKEN") else {}
notes: list[str] = []


def log(msg: str):
    print(msg, flush=True)
    notes.append(msg)


def download(url: str, dest: Path, headers=None) -> Path:
    if dest.exists():
        return dest
    log(f"Downloading {url}")
    with requests.get(url, headers=headers or {}, stream=True, timeout=600, allow_redirects=True) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return dest


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---- Test images ---------------------------------------------------------------

def test_images() -> dict[str, Image.Image]:
    """scikit-image's sample photos (CC0 / public domain), plus our two logo fixtures drawn on a coloured ground."""
    from skimage import data

    imgs = {
        "astronaut": Image.fromarray(data.astronaut()),
        "coffee": Image.fromarray(data.coffee()),
        "chelsea": Image.fromarray(data.chelsea()),
        "rocket": Image.fromarray(data.rocket()),
    }
    try:
        import cairosvg

        for name in ("emblem", "pinwheel"):
            png = cairosvg.svg2png(url=str(ROOT / "scripts/fixtures" / f"{name}.svg"), output_width=800)
            fg = Image.open(io.BytesIO(png)).convert("RGBA")
            bg = Image.new("RGBA", fg.size, (226, 214, 190, 255))
            imgs[name] = Image.alpha_composite(bg, fg).convert("RGB")
    except Exception as e:  # noqa: BLE001
        log(f"Skipped the logo fixtures: {e}")
    return {k: v.convert("RGB") for k, v in imgs.items()}


def checker(size, sq=16) -> Image.Image:
    img = Image.new("RGB", size, (255, 255, 255))
    d = ImageDraw.Draw(img)
    for y in range(0, size[1], sq):
        for x in range(0, size[0], sq):
            if (x // sq + y // sq) % 2:
                d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(220, 220, 220))
    return img


def on_checker(rgba: Image.Image) -> Image.Image:
    base = checker(rgba.size).convert("RGBA")
    return Image.alpha_composite(base, rgba).convert("RGB")


def sheet(name: str, panels: list[tuple[str, Image.Image]], height=360) -> str:
    scaled = [(label, p.resize((round(p.width * height / p.height), height), Image.LANCZOS)) for label, p in panels]
    w = sum(p.width for _, p in scaled) + 12 * (len(scaled) - 1)
    out = Image.new("RGB", (w, height + 28), (255, 255, 255))
    d = ImageDraw.Draw(out)
    x = 0
    for label, p in scaled:
        out.paste(p, (x, 28))
        d.text((x + 4, 6), label, fill=(20, 20, 20))
        x += p.width + 12
    path = SHEETS / f"{name}.png"
    out.save(path)
    return f"sheets/{name}.png"


# ---- BiRefNet ------------------------------------------------------------------

def birefnet_assets() -> list[tuple[str, str]]:
    """The release assets to try: BIREFNET_ASSETS (comma-separated names) if set, else the lightest general-purpose ONNX."""
    r = requests.get("https://api.github.com/repos/ZhengPeng7/BiRefNet/releases?per_page=100", headers=GH, timeout=60)
    r.raise_for_status()
    assets = [(a["name"], a["browser_download_url"], a["size"]) for rel in r.json() for a in rel["assets"] if a["name"].endswith(".onnx")]
    log("BiRefNet ONNX assets: " + ", ".join(f"{n} ({s / 1e6:.0f} MB)" for n, _, s in assets))
    want = [w.strip() for w in os.environ.get("BIREFNET_ASSETS", "").split(",") if w.strip()]
    if want:
        found = [(n, u) for w in want for n, u, _ in assets if n == w]
        if len(found) != len(want):
            sys.exit(f"Not all of {want} are release assets")
        return found
    general = [a for a in assets if "general" in a[0].lower() and "lite" in a[0].lower() and "2k" not in a[0].lower()]
    pick = min(general or assets, key=lambda a: a[2])
    return [(pick[0], pick[1])]


def birefnet_mask(sess: ort.InferenceSession, img: Image.Image) -> Image.Image:
    size = sess.get_inputs()[0].shape[-1]
    size = size if isinstance(size, int) else 1024
    x = np.asarray(img.resize((size, size), Image.BILINEAR), dtype=np.float32) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    out = sess.run(None, {sess.get_inputs()[0].name: x})[-1]
    m = out.reshape(out.shape[-2], out.shape[-1])
    if m.min() < 0 or m.max() > 1:
        m = 1 / (1 + np.exp(-m))
    return Image.fromarray((m * 255).clip(0, 255).astype(np.uint8)).resize(img.size, Image.BILINEAR)


def u2net_mask(sess: ort.InferenceSession, img: Image.Image) -> Image.Image:
    """The free in-browser model (U²-Net small), preprocessed as apps/app/src/engine/prepCore.ts does."""
    small = np.asarray(img.resize((320, 320), Image.BILINEAR), dtype=np.float32)
    x = (small / max(1.0, small.max()) - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    pred = sess.run(None, {sess.get_inputs()[0].name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0].reshape(320, 320)
    pred = (pred - pred.min()) / max(1e-9, pred.max() - pred.min())
    return Image.fromarray((pred * 255).round().astype(np.uint8)).resize(img.size, Image.BILINEAR)


def remove_bg(img: Image.Image) -> Image.Image | None:
    key = os.environ.get("REMOVE_BG_KEY")
    if not key:
        return None
    buf = io.BytesIO()
    img.save(buf, "PNG")
    r = requests.post(
        "https://api.remove.bg/v1.0/removebg",
        headers={"X-Api-Key": key},
        files={"image_file": ("image.png", buf.getvalue(), "image/png")},
        data={"size": "auto", "format": "png"},
        timeout=120,
    )
    if r.status_code != 200:
        log(f"remove.bg answered {r.status_code}: {r.text[:200]}")
        return None
    return Image.open(io.BytesIO(r.content)).convert("RGBA").resize(img.size, Image.BILINEAR)


# ---- Real-ESRGAN -----------------------------------------------------------------

def export_x4plus() -> Path:
    import torch

    sys.path.insert(0, str(Path(__file__).parent))
    from rrdbnet import RRDBNet

    pth = download("https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth", MODELS / "RealESRGAN_x4plus.pth")
    net = RRDBNet()
    state = torch.load(pth, map_location="cpu", weights_only=True)
    net.load_state_dict(state.get("params_ema", state.get("params", state)), strict=True)
    net.eval()
    out = MODELS / "realesrgan-x4plus.onnx"
    torch.onnx.export(
        net, torch.rand(1, 3, 64, 64), out, input_names=["input"], output_names=["output"],
        dynamic_axes={"input": {2: "h", 3: "w"}, "output": {2: "h4", 3: "w4"}}, opset_version=17, dynamo=False,
    )
    pth.unlink()
    return out


def upscale(sess: ort.InferenceSession, img: Image.Image) -> Image.Image:
    x = (np.asarray(img, dtype=np.float32) / 255.0).transpose(2, 0, 1)[None]
    y = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
    return Image.fromarray((y.transpose(1, 2, 0).clip(0, 1) * 255).round().astype(np.uint8))


# ---- Run ---------------------------------------------------------------------------

def main():
    images = test_images()
    manifest = []
    md = ["# HD models: report", "", "Made by `scripts/hd-models/prepare.py` on a GitHub Actions runner (CPU only).", ""]

    # Background removal: each chosen BiRefNet model against remove.bg (called once per image).
    chosen = birefnet_assets()
    sessions = []
    for name, url in chosen:
        short = name.removesuffix(".onnx")
        path = download(url, MODELS / f"birefnet-{short}.onnx")
        manifest.append({"file": path.name, "asset": name, "source": url, "licence": "MIT (BiRefNet)", "bytes": path.stat().st_size, "sha256": sha256(path)})
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        log(f"BiRefNet {name}: {path.stat().st_size / 1e6:.0f} MB, input {sess.get_inputs()[0].shape}, outputs {[o.shape for o in sess.get_outputs()]}")
        sessions.append((short, sess))
    # The free in-browser model, for what HD adds over it.
    u2 = ort.InferenceSession(str(ROOT / "apps/app/public/models/u2netp.onnx"), providers=["CPUExecutionProvider"])
    sessions.insert(0, ("free U2-Netp", u2))
    md += ["## Background removal: BiRefNet against remove.bg", "",
           "Mask difference: the mean absolute difference between the two alpha masks, and the share of pixels on opposite sides of 50%.", "",
           "| Image | Size | " + " | ".join(f"{s} time | {s} vs remove.bg" for s, _ in sessions) + " |",
           "| --- | --- | " + " | ".join("--- | ---" for _ in sessions) + " |"]
    rows, figs = [], []
    for key, img in images.items():
        theirs = remove_bg(img)
        panels = [("Original", img)]
        cells = []
        for short, sess in sessions:
            t = time.perf_counter()
            mask = u2net_mask(sess, img) if short.startswith("free") else birefnet_mask(sess, img)
            secs = time.perf_counter() - t
            ours = img.convert("RGBA")
            ours.putalpha(mask)
            panels.append((short, on_checker(ours)))
            diff = "n/a"
            if theirs is not None:
                a = np.asarray(mask, dtype=np.float32) / 255
                b = np.asarray(theirs.getchannel("A"), dtype=np.float32) / 255
                diff = f"{np.abs(a - b).mean() * 100:.2f}% / {(np.abs(a - b) > 0.5).mean() * 100:.2f}%"
            cells += [f"{secs:.1f} s", diff]
        if theirs is not None:
            panels.append(("remove.bg", on_checker(theirs)))
        rows.append(f"| {key} | {img.width} × {img.height} | " + " | ".join(cells) + " |")
        figs.append(f"### {key}\n\n![{key}]({sheet('bg-' + key, panels)})\n")
    md += rows + [""] + figs

    # Upscaling
    xpath = export_x4plus()
    manifest.append({"file": "realesrgan-x4plus.onnx", "source": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth (converted to ONNX, opset 17)", "licence": "BSD-3-Clause (Real-ESRGAN)", "bytes": xpath.stat().st_size, "sha256": sha256(xpath)})
    plus = ort.InferenceSession(str(xpath), providers=["CPUExecutionProvider"])
    v3 = ort.InferenceSession(str(ROOT / "apps/app/public/models/realesr-general-x4v3.onnx"), providers=["CPUExecutionProvider"])
    md += ["## Upscaling: Real-ESRGAN x4plus (server) against general-x4v3 (in the browser today)", "",
           "| Image | Input | x4plus time | x4v3 time |", "| --- | --- | --- | --- |"]
    figs = []
    for key in ("chelsea", "coffee"):
        src = images[key]
        crop = src.crop((0, 0, min(256, src.width), min(256, src.height)))
        t = time.perf_counter(); a = upscale(plus, crop); ta = time.perf_counter() - t
        t = time.perf_counter(); b = upscale(v3, crop); tb = time.perf_counter() - t
        md.append(f"| {key} | {crop.width} × {crop.height} | {ta:.1f} s | {tb:.1f} s |")
        figs.append(f"### {key}\n\n![{key}]({sheet('up-' + key, [('Input, scaled up plainly', crop.resize(a.size, Image.BICUBIC)), ('x4plus', a), ('x4v3', b)], height=512)})\n")
    md += [""] + figs

    (MODELS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    md += ["## Models", "", "```json", json.dumps(manifest, indent=2), "```", "", "## Log", ""] + [f"- {n}" for n in notes]
    (REPORT / "README.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
