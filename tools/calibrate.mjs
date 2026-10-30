// Work out the map's scale from a known trip and write tools/source/calibration.json (+ atlas/data/scale.json).
// The trip: a party took `days` days to travel by wagon between two places (distance measured as the straight line
// between their pins). Miles per world pixel = days * wagon pace / straight-line pixels. Ship travel then follows
// from the ship's pace. Edit tools/source/calibration_input.json to change the trip or the paces.
// usage: node calibrate.mjs
import fs from 'node:fs';
import { loadMapDefs, lonlatFor } from './lib_maps.mjs';

const input = JSON.parse(fs.readFileSync('source/calibration_input.json', 'utf8'));
const defs = loadMapDefs();
const toWorld = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];

function worldPosition(name) {
  // map-drawn names first (regions and places), then first-pass placements
  for (const m of ['free-nations', 'sellador', 'tel-tenauril', 'argusund', 'curmeah', 'lochlainn']) {
    const d = defs[m];
    for (const p of [...(d.places || []), ...(d.regions || [])]) if (p.name === name) return toWorld(lonlatFor(d)([p.x, p.y]));
  }
  return null;
}
const auto = JSON.parse(fs.readFileSync('source/auto_placements.json', 'utf8')).placements;
const objs = JSON.parse(fs.readFileSync('../original_data/db/objects.json', 'utf8'));
function positionOf(name) {
  const o = objs.find((x) => x.type === 'place' && x.name === name);
  const a = o && auto.find((p) => p.id === o.id);
  if (a) return toWorld(lonlatFor(defs[a.map])([a.x, a.y]));
  return worldPosition(name);
}

const [a, b] = [positionOf(input.from), positionOf(input.to)];
if (!a || !b) throw new Error(`could not find positions for ${input.from} / ${input.to}`);
const px = Math.hypot(a[0] - b[0], a[1] - b[1]);
const miles = input.days * input.wagonMilesPerDay;
const milesPerPx = miles / px;
const out = {
  from: input.from, to: input.to, days: input.days, wagonMilesPerDay: input.wagonMilesPerDay, shipMilesPerDay: input.shipMilesPerDay,
  straightLinePx: +px.toFixed(2), tripMiles: miles, milesPerPx: +milesPerPx.toFixed(3),
  shipPxPerDay: +(input.shipMilesPerDay / milesPerPx).toFixed(2), worldWidthMiles: Math.round(1024 * milesPerPx),
};
fs.writeFileSync('source/calibration.json', JSON.stringify(out, null, 1));
fs.mkdirSync('../atlas/data', { recursive: true });
fs.writeFileSync('../atlas/data/scale.json', JSON.stringify({ milesPerWorldPx: out.milesPerPx, wagonTrip: `${input.from} to ${input.to}` }));
console.log(out);
