// Generate MapLibre SDF glyph PBFs from OFL fonts so labels work offline.
// usage: node make_glyphs.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';
// Minimal protobuf writer (varint / zigzag / length-delimited) — all the glyph format needs.
class Pbf {
  constructor() { this.bytes = []; }
  varint(n) { n = Number(n); while (n > 127) { this.bytes.push((n & 127) | 128); n = Math.floor(n / 128); } this.bytes.push(n); }
  tag(field, type) { this.varint(field * 8 + type); }
  writeVarintField(f, n) { this.tag(f, 0); this.varint(n); }
  writeSVarintField(f, n) { this.tag(f, 0); this.varint(n < 0 ? -n * 2 - 1 : n * 2); }
  writeBytesField(f, buf) { this.tag(f, 2); this.varint(buf.length); for (const b of buf) this.bytes.push(b); }
  writeStringField(f, s) { this.writeBytesField(f, Buffer.from(s, 'utf8')); }
  writeMessage(f, fn, arg) { const inner = new Pbf(); fn(arg, inner); this.writeBytesField(f, inner.bytes); }
  finish() { return Uint8Array.from(this.bytes); }
}

const outDir = path.resolve(process.argv[2]);
const FONTS = [
  ['IM Fell English Regular', 'node_modules/@fontsource/im-fell-english/files/im-fell-english-latin-400-normal.woff'],
  ['IM Fell English Italic', 'node_modules/@fontsource/im-fell-english/files/im-fell-english-latin-400-italic.woff'],
  ['Cinzel Regular', 'node_modules/@fontsource/cinzel/files/cinzel-latin-400-normal.woff'],
  ['Cinzel SemiBold', 'node_modules/@fontsource/cinzel/files/cinzel-latin-600-normal.woff'],
];
const RANGES = [[0, 255], [256, 511], [8192, 8447]];
const SIZE = 24, BUFFER = 3, RADIUS = 8, CUTOFF = 0.25;
const TOP_OFFSET = Number(process.env.TOP_OFFSET ?? 17); // baseline calibration against MapLibre's shaping offset

function flatten(path) {
  const segs = []; // [x0,y0,x1,y1]
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const N = 8;
  for (const c of path.commands) {
    if (c.type === 'M') { cx = sx = c.x; cy = sy = c.y; }
    else if (c.type === 'L') { segs.push([cx, cy, c.x, c.y]); cx = c.x; cy = c.y; }
    else if (c.type === 'Q') {
      let px = cx, py = cy;
      for (let i = 1; i <= N; i++) { const t = i / N, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t; const x = a * cx + b * c.x1 + d * c.x, y = a * cy + b * c.y1 + d * c.y; segs.push([px, py, x, y]); px = x; py = y; }
      cx = c.x; cy = c.y;
    } else if (c.type === 'C') {
      let px = cx, py = cy;
      for (let i = 1; i <= N; i++) { const t = i / N, u = 1 - t; const x = u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, y = u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y; segs.push([px, py, x, y]); px = x; py = y; }
      cx = c.x; cy = c.y;
    } else if (c.type === 'Z') { if (cx !== sx || cy !== sy) segs.push([cx, cy, sx, sy]); cx = sx; cy = sy; }
  }
  return segs;
}

function distSeg(px, py, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - s[0]) * dx + (py - s[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

function winding(px, py, segs) {
  let w = 0;
  for (const s of segs) {
    if (s[1] <= py) { if (s[3] > py && (s[2] - s[0]) * (py - s[1]) - (px - s[0]) * (s[3] - s[1]) > 0) w++; }
    else if (s[3] <= py && (s[2] - s[0]) * (py - s[1]) - (px - s[0]) * (s[3] - s[1]) < 0) w--;
  }
  return w;
}

function renderGlyph(font, code) {
  const g = font.charToGlyph(String.fromCodePoint(code));
  if (!g || g.index === 0 && code !== 0) return null;
  const advance = Math.round((g.advanceWidth / font.unitsPerEm) * SIZE);
  const p = g.getPath(0, 0, SIZE);
  const segs = flatten(p);
  if (!segs.length) return { id: code, width: 0, height: 0, left: 0, top: 0, advance, bitmap: Buffer.alloc(0) };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of segs) { x1 = Math.min(x1, s[0], s[2]); x2 = Math.max(x2, s[0], s[2]); y1 = Math.min(y1, s[1], s[3]); y2 = Math.max(y2, s[1], s[3]); }
  const left = Math.floor(x1), topY = Math.floor(y1);
  const width = Math.ceil(x2) - left, height = Math.ceil(y2) - topY;
  const bw = width + BUFFER * 2, bh = height + BUFFER * 2;
  const bitmap = Buffer.alloc(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const px = left - BUFFER + x + 0.5, py = topY - BUFFER + y + 0.5;
      let d = Infinity;
      for (const s of segs) { const dd = distSeg(px, py, s); if (dd < d) d = dd; }
      const signed = winding(px, py, segs) !== 0 ? -d : d;
      bitmap[y * bw + x] = Math.max(0, Math.min(255, Math.round(255 - 255 * (signed / RADIUS + CUTOFF))));
    }
  }
  return { id: code, width, height, left, top: -topY - TOP_OFFSET, advance, bitmap };
}

function writeGlyph(glyph, pbf) {
  pbf.writeVarintField(1, glyph.id);
  if (glyph.bitmap.length) pbf.writeBytesField(2, glyph.bitmap);
  pbf.writeVarintField(3, glyph.width);
  pbf.writeVarintField(4, glyph.height);
  pbf.writeSVarintField(5, glyph.left);
  pbf.writeSVarintField(6, glyph.top);
  pbf.writeVarintField(7, glyph.advance);
}

for (const [name, file] of FONTS) {
  const buf = fs.readFileSync(file);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [a, b] of RANGES) {
    const glyphs = [];
    for (let code = a; code <= b; code++) { if (code < 32 && code !== 0) continue; const g = renderGlyph(font, code); if (g) glyphs.push(g); }
    const pbf = new Pbf();
    pbf.writeMessage(1, (_, p) => {
      p.writeStringField(1, name);
      p.writeStringField(2, `${a}-${b}`);
      for (const g of glyphs) p.writeMessage(3, writeGlyph, g);
    });
    fs.writeFileSync(path.join(dir, `${a}-${b}.pbf`), Buffer.from(pbf.finish()));
  }
  console.log(name, 'ok');
}
