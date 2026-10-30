// Ports (and any settlement pinned in the sea) belong on the shore. The coast is traced at about a map pixel (8-9 miles), so pins that
// were placed by eye often sit a few miles inland or off the coast, where no harbour can be drawn at street zoom (towns.mjs).
// This moves each such pin to the nearest shore as a hand edit in source/place_edits.json (lng / lat), which attach_notes.mjs applies.
//   usage:  node snap_ports.mjs [--write]      (prints what it would move; --write saves the edits; then run attach_notes.mjs and towns.mjs)
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('../atlas/data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const MPP = rd('scale.json').milesPerWorldPx;
const px = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];
const ll = ([x, y]) => [(x - 512) / 51.2, (512 - y) / 51.2];
const PORT_MAX = 60, SEA_MAX = 14, INLAND = 0.008; // miles for the first two, world px for the last (about 370 feet)

const g = rd('land.geojson').features[0].geometry;
const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p.map((r) => r.map(px)));
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const inLand = (x, y) => polys.some((p) => inRing(p[0], x, y) && !p.slice(1).some((h) => inRing(h, x, y)));
const segs = polys.flatMap((p) => p.flatMap((r) => r.slice(0, -1).map((a, i) => [a[0], a[1], r[i + 1][0], r[i + 1][1]])));
function nearest(x, y) {
  let best = { d: Infinity };
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-12))), qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(qx - x, qy - y);
    if (d < best.d) best = { d, qx, qy };
  }
  return best;
}

const editsFile = path.resolve('source/place_edits.json');
const store = JSON.parse(fs.readFileSync(editsFile, 'utf8'));
const SETTLEMENTS = new Set(['village', 'town', 'city', 'port']);
const moves = [], left = [];
for (const f of rd('places.geojson').features) {
  const p = f.properties;
  if (!SETTLEMENTS.has(p.kind) || !p.editKey) continue;
  const [x, y] = px(f.geometry.coordinates), land = inLand(x, y), c = nearest(x, y), mi = c.d * MPP;
  const wantsShore = p.kind === 'port' ? mi <= PORT_MAX : !land && mi <= SEA_MAX;
  if (!wantsShore) { if ((p.kind === 'port' && mi > PORT_MAX) || (!land && mi > SEA_MAX)) left.push(`${p.name} (${p.kind}): ${land ? 'inland' : 'in the sea'}, ${mi.toFixed(0)} mi from the coast`); continue; }
  if (land && mi < 0.8) continue; // already on the shore
  // inland direction: from the shore point toward the pin when the pin is on land, from the pin to the shore point when it is at sea
  const ux = land ? (x - c.qx) / (c.d || 1) : (c.qx - x) / (c.d || 1), uy = land ? (y - c.qy) / (c.d || 1) : (c.qy - y) / (c.d || 1);
  const [lng, lat] = ll([c.qx + ux * INLAND, c.qy + uy * INLAND]);
  if (!inLand(c.qx + ux * INLAND, c.qy + uy * INLAND)) { left.push(`${p.name}: could not find land beside the shore`); continue; }
  moves.push({ key: p.editKey, name: p.name, mi, lng: +lng.toFixed(5), lat: +lat.toFixed(5) });
}
for (const m of moves) console.log(`${m.name.padEnd(22)} ${m.mi.toFixed(1).padStart(5)} mi -> shore`);
if (left.length) console.log('left where they are:\n  ' + left.join('\n  '));
if (process.argv.includes('--write')) {
  for (const m of moves) store.edits[m.key] = { ...(store.edits[m.key] || {}), lng: m.lng, lat: m.lat };
  fs.writeFileSync(editsFile, JSON.stringify(store, null, 1));
  console.log(`wrote ${moves.length} edits to source/place_edits.json`);
}
