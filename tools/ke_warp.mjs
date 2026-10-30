// Make room for the Kharse desert: the author wants the mountains and the Valley of Ertrugol a little further east, so the desert can
// run from the north coast to the south coast and end at the mountains. The drawing is stretched sideways in a band (nothing moves
// at the west edge or east of Boddendell's woods, so the coasts still meet the rest of the world there):
//   dx(x) = 0 for x <= X0, rises to DX at X1, stays DX to X2, falls back to 0 at X3 (all drawing px; smooth-stepped).
// Everything in source/kharse_ertrugol.json (coasts, land, terrain, lakes, river, places, labels) is warped from the untouched
// copy kept under "base", so this can be rerun with other numbers.   usage: node ke_warp.mjs [deltaWorldPx]   (default 10)
import fs from 'node:fs';

const F = 'source/kharse_ertrugol.json';
const j = JSON.parse(fs.readFileSync(F, 'utf8'));
const delta = Number(process.argv[2] ?? 10);
if (!j.transform) throw new Error('run ke_fit.mjs --write first');
const DX = delta / j.transform.scale; // drawing px
const X0 = 400, X1 = 700, X2 = 900, X3 = 1700;
const smooth = (t) => t * t * (3 - 2 * t);
const dx = (x) => (x <= X0 ? 0 : x < X1 ? DX * smooth((x - X0) / (X1 - X0)) : x <= X2 ? DX : x < X3 ? DX * smooth((X3 - x) / (X3 - X2)) : 0);
const wp = ([x, y]) => [+(x + dx(x)).toFixed(1), y];

const KEYS = ['north', 'south', 'land', 'features', 'lakes', 'rivers', 'places', 'regions'];
if (!j.base) { j.base = {}; for (const k of KEYS) if (j[k]) j.base[k] = JSON.parse(JSON.stringify(j[k])); }
const b = j.base;
j.north = b.north.map(wp); j.south = b.south.map(wp); j.land = b.land.map(wp);
j.features = (b.features || []).map((f) => ({ ...f, poly: f.poly.map(wp) }));
j.lakes = (b.lakes || []).map((l) => { const [x, y] = wp([l.x, l.y]); const sx = 1 + (dx(l.x + 1) - dx(l.x - 1)) / 2; return { ...l, x, y, rx: +(l.rx * Math.max(0.5, sx)).toFixed(1) }; });
j.rivers = (b.rivers || []).map((r) => ({ ...r, pts: r.pts.map(wp) }));
j.places = (b.places || []).map((p) => { const [x, y] = wp([p.x, p.y]); return { ...p, x, y }; });
j.regions = (b.regions || []).map((p) => { const [x, y] = wp([p.x, p.y]); return { ...p, x, y }; });
j.warp = { deltaWorldPx: delta, driftPx: +DX.toFixed(1), band: [X0, X1, X2, X3], note: 'dx(x) added to every x of the base drawing; see tools/ke_warp.mjs' };
fs.writeFileSync(F, JSON.stringify(j, null, 1));
const t = j.transform, c = Math.cos(t.rot), s = Math.sin(t.rot);
const world = ([x, y]) => [+(t.ox + t.scale * (c * x - s * y)).toFixed(1), +(t.oy + t.scale * (s * x + c * y)).toFixed(1)];
console.log(`warped by up to ${delta} world px (${DX.toFixed(0)} drawing px)`);
console.log('Valley of Ertrugol label now at world', world(wp([1000, 690])), '(was', world([1000, 690]) + ')');
const mw = j.features.find((f) => f.name === 'Kharse Mountains');
console.log('mountains west foot (world x):', Math.min(...mw.poly.map((p) => world(p)[0])).toFixed(1), 'to', Math.max(...mw.poly.slice(0, 4).map((p) => world(p)[0])).toFixed(1));

// keep the Valley of Ertrugol pin on the drawing's own label (placements.json, dbId 221)
{
  const pf = 'source/placements.json', pj = JSON.parse(fs.readFileSync(pf, 'utf8'));
  const pin = pj.placements.find((q) => q.dbId === 221);
  if (pin) {
    const [wx, wy] = world(wp([1000, 690]));
    pin.lng = +((wx - 512) / 51.2).toFixed(5); pin.lat = +((512 - wy) / 51.2).toFixed(5);
    fs.writeFileSync(pf, JSON.stringify(pj, null, 1));
    console.log('Valley Of Ertrugol pin set to world', wx, wy);
  }
}
