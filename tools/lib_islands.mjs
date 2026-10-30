// The small islands (source/islands.json): where each one sits on the world map.
//  - the western chain (isle, Prios, Thanatos, Agrea): each is `sailDays` of sailing (pxPerDay world px per day)
//    west of the previous one, coast to coast, with its own latitude (`yCenter`);
//  - islands with `at: [x, y]` (e.g. Baratoria) are simply centred on that world position.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'source');

export function loadIslands() {
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'islands.json'), 'utf8'));
  // a calibrated scale (tools/calibrate.mjs) turns sailing days into map distance; otherwise use the placeholder
  const calFile = path.join(SRC, 'calibration.json');
  const cal = fs.existsSync(calFile) ? JSON.parse(fs.readFileSync(calFile, 'utf8')) : null;
  if (cal) cfg.pxPerDay = cal.shipPxPerDay;
  // sizes: the author says the party could sail all the way around Agrea in 4 days, so its coastline is
  // (days * ship pace) long; the other chain islands are a fixed fraction of Agrea's scale (`sizeRatio`)
  const perimeter = (ring) => ring.reduce((s, p, i) => s + Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]), 0);
  const ref = cfg.islands.find((i) => i.circumnavigateDays);
  if (ref) {
    const ownScale = (ref.circumnavigateDays * cfg.pxPerDay) / perimeter(ref.coast);
    const refScale = cfg.refScale ?? ownScale; // refScale pins the other islands' sizes when the reference island is redrawn
    for (const isl of cfg.islands) if (isl === ref) isl.scale = ownScale; else if (isl.sizeRatio) isl.scale = refScale * isl.sizeRatio;
  }
  let westX = cfg.start.x;
  const islands = cfg.islands.map((isl) => {
    const xs = isl.coast.map((p) => p[0]), ys = isl.coast.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    if (isl.at) {
      const ox = isl.at[0] - (isl.scale * (minX + maxX)) / 2, oy = isl.at[1] - (isl.scale * (minY + maxY)) / 2;
      return { ...isl, ox, oy, rot: 0, eastX: ox + isl.scale * maxX, westX: ox + isl.scale * minX };
    }
    const east = westX - isl.sailDays * cfg.pxPerDay;
    const ox = east - isl.scale * maxX, oy = isl.yCenter - (isl.scale * (minY + maxY)) / 2;
    westX = ox + isl.scale * minX;
    return { ...isl, ox, oy, rot: 0, eastX: east, westX };
  });
  return { cfg, islands };
}
