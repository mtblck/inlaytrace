/* Inlay's hero: a pixel image becomes an SVG whose shapes fit together exactly.
   One gantry does the work: its bar sweeps the card to find the palette (noisy pixels snap to four
   colours, a chip lights for each), then its pen traces each edge between two colours once, then the
   pixels give way to four cut pieces that lift apart and drop back in flush, like inlaid wood.

   The 'inlay' look is the vector look in inlaytrace.com's own colours: green-tinted paper and ink from the
   site's tokens, with the brand's green (light) or yellow (dark) as the one accent. */
ISOGRAM.addLook('inlay', Object.assign({}, ISOGRAM.LOOKS.vector, {
  label: 'Inlay', default: 'dark',
  themes: {
    // on the site's white print card: tones a step darker than the stock vector look, so the machine
    // doesn't fade into the white; ink and accent are the site's --ink and --link-on-white
    light: { glow: false, bg: '#ffffff', panel: '#ffffff', line: '#d2d9d4', edge: '#b3c0b8', edgeHi: '#8d9a93', detail: '#b3c0b8',
      recess: '#cdd6d0', glass: '#16201c', ink: '#4a5a53', inkHi: '#16201c', wire: '#9fb0a6', term: '#7f9187', shadow: '#16201c', shadowA: 0.16,
      face: { lo: ['#dbe3de', '#c4cfc8', '#b2bfb7'], mid: ['#ecf0ed', '#d5ddd8', '#c3cdc6'], hi: ['#f8faf8', '#e4eae6', '#d3dbd6'] },
      accent: '#23614c', accentHi: '#4f9c80', glassOn: 0.25, halo: 0.16, rim: '#ffffff' },
    // on the page itself (#131e1a): the site's deep mat green, with the yellow mark as the accent
    dark: { glow: false, bg: '#131e1a', panel: '#1b352d', line: '#2c3d35', edge: '#3d5a50', edgeHi: '#557a6d', detail: '#34504a',
      recess: '#14251f', glass: '#0e1814', ink: '#9fb2a9', inkHi: '#eef2ee', wire: '#3e5d52', term: '#55786c', shadow: '#000000', shadowA: 0.35,
      face: { lo: ['#2a4a40', '#223d35', '#1c332c'], mid: ['#36594e', '#2b4a41', '#243f37'], hi: ['#456a5e', '#37574d', '#2e4a42'] },
      accent: '#f2c230', accentHi: '#f7dc7d', glassOn: 0.25, halo: 0.2, rim: '#5f8275' },
  },
}));

ISOGRAM.define({
  id: 'inlay',
  title: 'Pixels in, shapes out',
  aria: 'Isometric diagram of Inlay turning a pixel image into SVG: the image rides in on a belt, a gantry scans it and finds its four colours, its pen traces each edge between two colours once, the pixels give way to four cut shapes that lift apart and drop back in flush, and the card rolls out as an SVG.',
  look: 'inlay',
  theme: 'dark',
  duration: 12000,
  still: 6000,
  aspect: 800 / 614,
  beats: [
    { at: 0,    id: 'in',    caption: 'A pixel image goes in',     show: 1300 },
    { at: 1500, id: 'scan',  caption: 'Find its colours',           show: 2900 },
    { at: 3500, id: 'trace', caption: 'Trace each edge once',       show: 6000 },
    { at: 7000, id: 'fit',   caption: 'Cut the shapes to fit',      show: 8000 },
    { at: 9400, id: 'out',   caption: 'Out comes an SVG',           show: 10600 },
  ],
  draw(g, k) {
    const t = k.t, PI = Math.PI, D = k.duration;
    const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    // ---- model ----
    const tIn = k.at('in'), tScan = k.at('scan'), tTrace = k.at('trace'), tFit = k.at('fit'), tOut = k.at('out');
    const CW = 88, CD = 66, CELL = 11, CY = 70, CZ = 12, TOP = CZ + 2;           // the card: 8 × 6 pixels of 11
    const XIN = -46, XA = 20, XOUT = 132;                                          // card x: arriving, at the gantry, out
    const cardX = t < tTrace ? XIN + (XA - XIN) * k.ramp(tIn + 150, tIn + 1300, k.easeInOut)
      : XA + (XOUT - XA) * k.ramp(tOut, tOut + 1100, k.easeInOut);
    const cardOp = k.ramp(0, 350) * (1 - k.ramp(D - 650, D - 80));
    const P = (u, v, dz = 0) => [cardX + u, CY + v, TOP + dz];
    // the picture: sky, a mountain, ground under the horizon, a sun
    const SUN = [64, 17, 9.5], PEAK = [35, 15], MB = [8, 64], HOR = 46;
    const region = (u, v) => Math.hypot(u - SUN[0], v - SUN[1]) < SUN[2] ? 'sun'
      : v >= HOR ? 'ground' : v >= PEAK[1] + Math.abs(u - PEAK[0]) * (HOR - PEAK[1]) / (PEAK[0] - MB[0]) ? 'mountain' : 'sky';
    const ORDER = ['sky', 'mountain', 'ground', 'sun'];
    // sky as pale paper (the silhouette ink), mountain dark, ground light, the sun in the accent
    const LOOK = { sky: { role: 'silhouette' }, mountain: { tone: 'lo' }, ground: { tone: 'hi' }, sun: { tone: 'hi', lit: 1 } };
    // scan: the gantry sweeps once; cells it has passed snap to their colour; a chip lights per colour found
    const scanU = k.ramp(tScan + 100, tScan + 1600, x => x) * (CW + 8) - 4;
    const scanning = t > tScan && t < tScan + 1700;
    const found = c => t > tScan + 250 + ORDER.indexOf(c) * 380;
    const nFound = ORDER.filter(found).length;
    // trace: one route with pen-up moves; each edge between two colours is drawn once
    const circ = Array.from({ length: 29 }, (_, i) => { const a = -PI / 2 + i / 28 * 2 * PI; return [SUN[0] + SUN[2] * Math.cos(a), SUN[1] + SUN[2] * Math.sin(a)]; });
    const HOME = [CW + 10, CD / 2];
    const segs = [
      { down: false, pts: [HOME, [0, HOR]] },
      { down: true, pts: [[0, HOR], [CW, HOR]] },                        // horizon: ground below, sky and mountain above
      { down: false, pts: [[CW, HOR], [MB[1], HOR]] },
      { down: true, pts: [[MB[1], HOR], PEAK, [MB[0], HOR]] },             // mountain: mountain inside, sky outside
      { down: false, pts: [[MB[0], HOR], circ[0]] },
      { down: true, pts: circ },                                         // sun: sun inside, sky outside
      { down: false, pts: [circ[0], HOME] },
    ].map(s => { let L = 0; for (let i = 1; i < s.pts.length; i++) L += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); return { ...s, L }; });
    const total = segs.reduce((a, s) => a + s.L, 0);
    const traceS = k.ramp(tTrace + 200, tFit - 300, x => x) * total;
    const along = (pts, d) => { for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (d <= l) { const f = l ? d / l : 0; return { p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f], i }; } d -= l; }
      return { p: pts[pts.length - 1], i: pts.length - 1 }; };
    let rem = traceS, pen = HOME, penDown = false; const drawn = [];
    for (const s of segs) { if (rem <= 0) break; const r = along(s.pts, Math.min(rem, s.L)); pen = r.p;
      if (s.down) { drawn.push([...s.pts.slice(0, r.i), r.p]); penDown = rem < s.L; } rem -= s.L; }
    if (t < tTrace + 200 || t > tFit - 300) penDown = false;
    const edgesDone = segs.filter((s, i) => s.down && segs.slice(0, i + 1).reduce((a, q) => a + q.L, 0) <= traceS).length;
    // fit: pixels fade, the four pieces lift apart (cut free), then drop back in flush
    const pixOp = 1 - k.ramp(tFit + 50, tFit + 600);
    const lift = c => { const i = ORDER.indexOf(c);
      return k.ramp(tFit + 100, tFit + 700, k.easeInOut) * (1 - k.ramp(tFit + 1200 + i * 220, tFit + 1750 + i * 220, x => 1 - (1 - x) ** 3)) * (4 + i * 9); };
    const settled = ORDER.filter(c => t > tFit + 1750 + ORDER.indexOf(c) * 220).length;
    const shapes = t > tFit + 50;
    const lineOp = 1 - k.ramp(tFit + 2400, tFit + 3000);
    // gantry: the bar rides with the scan, then with the pen; the carriage rides the bar
    const PARK = cardX + CW + 12;
    const barX = scanning ? XA + scanU : t > tTrace && t < tFit ? XA + pen[0] : XA + CW + 12;
    const carY = t > tTrace && t < tFit ? CY + pen[1] : CY + CD / 2;
    const RX0 = XA - 10, RX1 = XA + CW + 18;

    // ---- floor, belt, tags ----
    g.plate(-54, 44, 0, 292, 128, 8, { r: 12 });
    const belt = g.box(-50, 66, 8, 284, 74, 4, { r: 3, tone: 'mid' });
    belt.top.slits(8, 278, 14, 3, 71, true, { op: 0.3 });
    belt.front.slits(4, 280, 6, 1, 3, true, { op: 0.35 });
    const tag = (x, str, lit) => g.box(x, 150, 8, 34, 15, 3, { r: 2, tone: 'hi' }).top.text(17, 10.5, str, { size: 7.5, align: 'center', lit });
    tag(-46, 'PNG', k.env(0, tIn + 1300, 150, 400));
    tag(XOUT + CW - 34, 'SVG', t > tOut + 900 ? 1 - k.ramp(D - 650, D - 80) : 0);

    // ---- gantry: back rail and post ----
    g.box(RX0, 54, 8, RX1 - RX0, 6, 5, { r: 1, tone: 'lo' });
    g.box(barX - 3.5, 53, 13, 7, 8, 30, { r: 1.5, tone: 'mid' });

    // ---- the card ----
    if (cardOp > 0.01) {
      const card = g.box(cardX, CY, CZ, CW, CD, 2, { r: 1.5, tone: 'lo', op: cardOp });
      if (pixOp > 0.01) for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) {
        const u = (i + 0.5) * CELL, v = (j + 0.5) * CELL, c = region(u, v);
        const snapped = (scanning && scanU > u) || t > tScan + 1600;
        const noisy = ['lo', 'mid', 'hi'][Math.floor(hash(i * 13 + j * 7) * 3)];
        const right = hash(i + j * 9) < 0.5;
        const L = snapped || right ? LOOK[c] : { tone: noisy, lit: c === 'sun' ? 0.4 : 0 };
        card.top.rect(i * CELL + 0.6, j * CELL + 0.6, CELL - 1.2, CELL - 1.2, { role: L.role, tone: L.tone, lit: L.lit || 0, op: cardOp * pixOp });
      }
      if (shapes) {
        const op = cardOp * k.ramp(tFit + 50, tFit + 500), z = c => 0.25 + lift(c);
        const quad = (a, b, c) => [P(a[0], a[1], c), P(b[0], a[1], c), P(b[0], b[1], c), P(a[0], b[1], c)];
        g.poly(quad([0, 0], [CW, CD], z('sky')), { role: 'silhouette', op });
        g.poly([P(MB[0], HOR, z('mountain')), P(PEAK[0], PEAK[1], z('mountain')), P(MB[1], HOR, z('mountain'))], { role: 'top', tone: 'lo', op });
        g.poly(quad([0, HOR], [CW, CD], z('ground')), { role: 'top', tone: 'hi', op });
        g.poly(circ.map(([u, v]) => P(u, v, z('sun'))), { role: 'top', tone: 'hi', lit: 1, op });
      }
      // the traced edges: lit while drawn, then quiet seams between the pieces
      drawn.forEach(pts => g.line(pts.map(([u, v]) => P(u, v, 0.5 + (shapes ? 0 : 0))), { role: 'wire', lit: lineOp, w: 1.8, op: cardOp * (0.35 + 0.65 * lineOp) }));
      if (scanning && scanU > 0 && scanU < CW) {
        const a = P(scanU, 0, 0.3), b = P(scanU, CD, 0.3);
        g.poly([[barX, CY - 2, 42], [barX, CY + CD + 2, 42], b, a], { role: 'led', lit: 0.7, op: 0.2 });
        g.line([a, b], { role: 'wire', lit: 1, w: 2.2 });
        g.bloom(P(scanU, CD / 2), 30, 0.6);
      }
    }

    // ---- gantry: bar, carriage and pen, front post and rail ----
    g.box(barX - 4, 53, 42, 8, CD + 24, 6, { r: 1.5, tone: 'mid' });
    const penZ = penDown ? TOP + 0.4 : TOP + 7;
    g.line([[barX, carY, penZ], [barX, carY, 42]], { role: 'detail', w: 2.2 });
    const car = g.box(barX - 6, carY - 6, 42, 12, 12, 8, { r: 2.5, material: 'silhouette' });
    car.front.led(6, 3, 1.4, penDown ? 1 : scanning ? 0.6 : 0);
    if (penDown) { g.term([barX, carY, TOP + 0.6], 1, 2.2); g.bloom([barX, carY, TOP], 18, 0.7); }
    g.box(barX - 3.5, CY + CD + 5, 13, 7, 8, 30, { r: 1.5, tone: 'mid' });
    g.box(RX0, CY + CD + 6, 8, RX1 - RX0, 6, 5, { r: 1, tone: 'lo' });

    // ---- palette console: a chip per colour found ----
    const con = g.box(XA + 6, 150, 8, 66, 16, 8, { r: 2, tone: 'hi' });
    ORDER.forEach((c, i) => {
      const on = found(c) ? 1 - k.ramp(D - 650, D - 80) : 0;
      con.top.rect(6 + i * 14.5, 3.5, 10, 9, { r: 1.5, role: LOOK[c].role, tone: LOOK[c].tone, lit: (LOOK[c].lit || 0) * on, op: 0.2 + 0.8 * on });
      con.front.led(11 + i * 14.5, 4, 1.4, on * k.env(tScan + 250 + i * 380, D - 80, 150, 600));
    });
    void PARK;

    g.readout(t < tScan ? 'image.png · 8 x 6 px'
      : t < tTrace ? 'colours · ' + nFound + ' / 4'
      : t < tFit ? 'edges · ' + edgesDone + ' / 3'
      : t < tOut ? 'shapes · ' + settled + ' / 4'
      : 'image.svg · 4 paths');
  },
});
