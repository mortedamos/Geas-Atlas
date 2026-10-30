// Source-map coordinate helpers shared by the build scripts: pixel position on a transcribed map -> lon/lat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'source');
const WORLD = 1024, SPAN = 20;

export function loadMapDefs() {
  const read = (n) => JSON.parse(fs.readFileSync(path.join(SRC, `${n}.json`), 'utf8'));
  const fnRaw = read('free-nations');
  const keRaw = read('kharse_ertrugol');
  const bhRaw = read('berhagen');
  return {
    'tel-tenauril': read('tel-tenauril'),
    sellador: read('sellador'),
    curmeah: read('curmeah'),
    lochlainn: read('lochlainn'),
    world: { scale: 1, ox: 0, oy: 0, rot: 0 }, // positions given directly in world pixels (1024 px = 20 degrees)
    argusund: read('argusund'),
    'free-nations': { ...fnRaw, ...fnRaw.transform },
    'kharse-ertrugol': { ...keRaw, ...keRaw.transform },
    berhagen: { ...bhRaw, ...bhRaw.transform },
  };
}

export function lonlatFor(def) {
  return ([x, y]) => {
    const c = Math.cos(def.rot || 0), s = Math.sin(def.rot || 0);
    const u = def.ox + def.scale * (c * x - s * y), v = def.oy + def.scale * (s * x + c * y);
    return [((u - WORLD / 2) * SPAN) / WORLD, (-(v - WORLD / 2) * SPAN) / WORLD];
  };
}
