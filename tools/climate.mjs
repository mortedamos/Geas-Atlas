// A small climate model run on the atlas's actual geography.
//  1. The chart is read as Mercator (as on the globe): world width 1950 px = one turn, Sellador's centre y=262 = 49 N.
//  2. Prevailing winds from the three-cell circulation (trades / westerlies / polar easterlies), shifted with the season.
//  3. Wind-driven ocean currents: a Stommel-type gyre solve (wind-stress curl + beta effect + bottom friction) on the real
//     coastlines -> western boundary currents, gyres, circumpolar flow.
//  4. Sea-surface temperature = latitude climate + heat carried by those currents (advected, relaxed back).
//  5. Air temperature and moisture carried along the winds over land: marine influence, rain-out on windward slopes, rain shadows.
// Outputs: atlas/data/climate.json (grids for a viewer overlay) and source/climate_report.md (numbers per region).
// usage: node climate.mjs ../atlas/data
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.argv[2] || '../atlas/data');
// MODE: natural = winds + wind-driven gyres only; author = natural + the author's Mild Current (warm water prescribed along its path);
//       west = natural + a hypothetical western continent (source/climate_scenarios.json): does a Gulf-Stream-like current appear by itself?
const MODE = process.env.MODE || 'author';
const SUFFIX = MODE === 'author' ? '' : `_${MODE}`;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')).features;
const MPP = JSON.parse(fs.readFileSync(path.join(dataDir, 'scale.json'), 'utf8')).milesPerWorldPx;

// ---- grid ----
const X0 = -800, W = 1950, Y0 = -140, Y1 = 1340, H = 6;
const NX = Math.round(W / H), NY = Math.round((Y1 - Y0) / H);
const R = W / (2 * Math.PI), M49 = Math.log(Math.tan(Math.PI / 4 + (49 * Math.PI) / 360));
const cx = (i) => X0 + H * (i + 0.5), cy = (j) => Y0 + H * (j + 0.5);
const latOf = (y) => 2 * Math.atan(Math.exp(M49 + (262 - y) / R)) - Math.PI / 2; // radians
const lat = Float64Array.from({ length: NY }, (_, j) => latOf(cy(j)));
const deg = (r) => (r * 180) / Math.PI;
const IDX = (i, j) => j * NX + ((i % NX) + NX) % NX;
const toPx = ([lng, la]) => [lng * 51.2 + 512, 512 - la * 51.2];

// ---- rasterise land and elevation ----
function raster(features, value, combine) {
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const v = value(f);
    if (v == null) continue;
    for (const poly of polys) {
      const rings = poly.map((r) => r.map(toPx));
      for (let j = 0; j < NY; j++) {
        const y = cy(j), xs = [];
        for (const ring of rings) for (let k = 0; k < ring.length - 1; k++) {
          const [xa, ya] = ring[k], [xb, yb] = ring[k + 1];
          if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) / (yb - ya)) * (xb - xa));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (let i = Math.ceil((xs[k] - X0) / H - 0.5); i < (xs[k + 1] - X0) / H - 0.5; i++) if (i >= 0 && i < NX) combine(IDX(i, j), v);
        }
      }
    }
  }
}
const land = new Uint8Array(NX * NY), elev = new Float32Array(NX * NY); // elev in km
raster(rd('land.geojson'), () => 1, (k) => { land[k] = 1; });
for (let i = 0; i < NX; i++) { land[IDX(i, NY - 1)] = 1; land[IDX(i, 0)] = 1; }
for (let k = 0; k < land.length; k++) if (land[k]) elev[k] = 0.15;
const ELEV = { mountain: 3.2, hills: 0.9, ice: 1.2, waste: 0.4, desert: 0.3 };
raster(rd('terrain.geojson'), (f) => ELEV[f.properties.kind] ?? null, (k, v) => { if (land[k]) elev[k] = Math.max(elev[k], v); });
// smooth the elevation a little so ranges act as ramps, not walls
for (let it = 0; it < 2; it++) {
  const e2 = Float32Array.from(elev);
  for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX; i++) { const k = IDX(i, j); if (!land[k]) continue; e2[k] = 0.5 * elev[k] + 0.125 * (elev[IDX(i - 1, j)] + elev[IDX(i + 1, j)] + elev[IDX(i, j - 1)] + elev[IDX(i, j + 1)]); }
  elev.set(e2);
}
if (MODE !== 'author' && MODE !== 'natural') {
  const sc = JSON.parse(fs.readFileSync('source/climate_scenarios.json', 'utf8'))[MODE];
  const asFeature = (poly) => ({ geometry: { type: 'Polygon', coordinates: [poly.map(([x, y]) => [(x - 512) / 51.2, (512 - y) / 51.2])] } });
  for (const poly of sc.polys) raster([asFeature(poly)], () => 1, (k) => { land[k] = 1; elev[k] = Math.max(elev[k], sc.elev ?? 0.35); });
  for (const m of sc.mountains || []) raster([asFeature(m)], () => 1, (k) => { elev[k] = Math.max(elev[k], 2.2); });
}

// warm water prescribed along the author's Mild Current (adjustments.json: currents)
const authorAnomaly = new Float32Array(NX * NY);
if (MODE === 'author') {
  const adj = JSON.parse(fs.readFileSync('source/adjustments.json', 'utf8'));
  for (const c of adj.currents.filter((c) => c.warm)) {
    const seg = c.pts.slice(0, -1).map((a, i) => [...a, ...c.pts[i + 1]]);
    const total = seg.reduce((a, [x0, y0, x1, y1]) => a + Math.hypot(x1 - x0, y1 - y0), 0);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = IDX(i, j);
      if (land[k]) continue;
      const px = cx(i), py = cy(j);
      let best = 1e9, bt = 0, run = 0;
      for (const [x0, y0, x1, y1] of seg) {
        const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, len = Math.sqrt(l2);
        let t = ((px - x0) * dx + (py - y0) * dy) / l2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
        if (d < best) { best = d; bt = (run + t * len) / total; }
        run += len;
      }
      authorAnomaly[k] = 9 * Math.min(1, bt / 0.3) * Math.exp(-((best / 48) ** 2)); // +9 C at the core, like the North Atlantic Drift
    }
  }
}
console.log(`grid ${NX}x${NY} (cell ${H} px = ${(H * MPP).toFixed(0)} mi), land cells ${land.reduce((a, b) => a + b, 0)}`);

// ---- winds: three-cell surface circulation, shifted toward the summer hemisphere ----
const SEASONS = [{ name: 'January', s: -1 }, { name: 'July', s: 1 }];
function wind(j, s) {
  const phi = lat[j] - s * 0.09; // the belts follow the sun by ~5 degrees
  const a = Math.abs(phi);
  const u = -Math.sin(6 * a); // east-west: easterly, westerly, easterly
  const v = 0.5 * u * Math.sign(phi || 1); // equatorward in the trades/polar cells, poleward in the westerlies
  return [u, v];
}

// ---- ocean currents: Stommel gyres (beta*psi_x + r*lap(psi) = curl tau) ----
function solveCurrents() {
  const tau = Float64Array.from({ length: NY }, (_, j) => { const [u] = wind(j, 0); return u * Math.abs(u); });
  const F = Float64Array.from({ length: NY }, (_, j) => -((tau[Math.max(0, j - 1)] - tau[Math.min(NY - 1, j + 1)]) / 2) * 0.35);
  const psi = new Float64Array(NX * NY);
  const beta = 1, r = 1.1, omega = 1.45;
  for (let it = 0; it < 9000; it++) {
    let delta = 0;
    for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX; i++) {
      const k = IDX(i, j);
      if (land[k]) continue;
      const E = psi[IDX(i + 1, j)], Wst = psi[IDX(i - 1, j)], N = psi[k - NX], S = psi[k + NX];
      const t = (r * (E + Wst + N + S) + (beta * (E - Wst)) / 2 - F[j]) / (4 * r);
      const d = omega * (t - psi[k]);
      psi[k] += d; delta = Math.max(delta, Math.abs(d));
    }
    if (it % 1500 === 0) console.log(`  gyre solve ${it}: max change ${delta.toExponential(2)}`);
    if (delta < 1e-7) break;
  }
  const cu = new Float32Array(NX * NY), cv = new Float32Array(NX * NY);
  let vmax = 0;
  for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX; i++) {
    const k = IDX(i, j);
    if (land[k]) continue;
    cu[k] = -(psi[k - NX] - psi[k + NX]) / 2; // east
    cv[k] = (psi[IDX(i + 1, j)] - psi[IDX(i - 1, j)]) / 2; // north
    vmax = Math.max(vmax, Math.hypot(cu[k], cv[k]));
  }
  // normalise so the strongest western boundary current is 1
  const sorted = Array.from(cu, (u, k) => Math.hypot(u, cv[k])).sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.995)] || 1;
  for (let k = 0; k < cu.length; k++) { cu[k] /= ref; cv[k] /= ref; }
  return { psi, cu, cv };
}
const cur = solveCurrents();

// ---- temperature ----
const sin = Math.sin;
const Tsea = (phi, s) => { const p = phi - s * 0.1; return 29 - 38 * sin(p) ** 2 - 20 * sin(p) ** 8; };
const sh = (j, s) => s * Math.sign(lat[j] || 1); // +1 in the summer hemisphere
const Tland = (j, s) => Tsea(lat[j], s) + 17 * sh(j, s) * Math.abs(sin(lat[j])) ** 0.8;

function bilerp(a, x, y) { // a: Float64/32 array, x in cells (periodic), y in cells (clamped)
  y = Math.max(0, Math.min(NY - 1.001, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  return (a[IDX(x0, y0)] * (1 - fx) + a[IDX(x0 + 1, y0)] * fx) * (1 - fy) + (a[IDX(x0, y0 + 1)] * (1 - fx) + a[IDX(x0 + 1, y0 + 1)] * fx) * fy;
}

function simulate(season) {
  const { s } = season;
  // sea-surface temperature: advected by the currents, relaxed to the latitude climate
  const sst = new Float64Array(NX * NY), clim = new Float64Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = IDX(i, j); clim[k] = Math.max(-1.8, Tsea(lat[j], s) + authorAnomaly[k]); sst[k] = clim[k]; }
  for (let it = 0; it < 260; it++) {
    const next = Float64Array.from(sst);
    for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX; i++) {
      const k = IDX(i, j);
      if (land[k]) continue;
      const adv = bilerp(sst, i - cur.cu[k] * 0.55, j + cur.cv[k] * 0.55); // semi-Lagrangian: north = -j
      const lap = (sst[IDX(i + 1, j)] + sst[IDX(i - 1, j)] + sst[k - NX] + sst[k + NX] - 4 * sst[k]);
      next[k] = Math.max(-1.8, adv + 0.12 * lap - (adv - clim[k]) / 55);
    }
    for (let k = 0; k < next.length; k++) if (land[k]) next[k] = clim[k]; // land cells just hold the climate (not used)
    sst.set(next);
  }
  // air temperature and moisture carried by the wind
  const Ta = new Float64Array(NX * NY), q = new Float64Array(NX * NY), P = new Float64Array(NX * NY);
  for (let k = 0; k < Ta.length; k++) { Ta[k] = land[k] ? 0 : sst[k]; q[k] = 0.6; }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = IDX(i, j); if (land[k]) Ta[k] = Tland(j, s); }
  const qs = (T) => Math.max(0.06, Math.exp(0.062 * (T - 20)));
  const steps = 700, spin = 350;
  for (let it = 0; it < steps; it++) {
    const T2 = Float64Array.from(Ta), q2 = Float64Array.from(q);
    for (let j = 1; j < NY - 1; j++) {
      const [u, v] = wind(j, s);
      const phi = Math.abs(lat[j] - s * 0.09);
      const dphi = deg(phi);
      // where air rises it rains: ITCZ, mid-latitude storm tracks; where it sinks (subtropical highs) it does not
      const k0 = 0.012 + 0.07 * Math.exp(-((dphi / 9) ** 2)) + 0.03 * Math.exp(-(((dphi - 55) / 13) ** 2));
      const dry = 1 - 0.85 * Math.exp(-(((dphi - 28) / 8) ** 2));
      for (let i = 0; i < NX; i++) {
        const k = IDX(i, j);
        const fromX = i - u, fromY = j + v; // v northward = -j, so the source is south of a northward wind: j + v
        let T = bilerp(Ta, fromX, fromY), qq = bilerp(q, fromX, fromY);
        if (land[k]) {
          T += (Tland(j, s) - 6.2 * elev[k] - T) / 22; // continents take up the local climate over ~20 cells (~1000 mi)
          // orographic lift: wind climbing the slope rains out
          const dhx = (elev[IDX(i + 1, j)] - elev[IDX(i - 1, j)]) / 2, dhy = (elev[k - NX] - elev[k + NX]) / 2; // dh/dx, dh/dNorth
          const up = Math.max(0, u * dhx + v * dhy);
          const rate = Math.min(0.6, k0 * dry + 1.1 * up);
          const rain = qq * rate;
          qq = qq - rain + 0.004 * qs(T); // a little recycling from the ground
          if (it >= spin) P[k] += rain;
        } else {
          T += (sst[k] - T) / 3;
          qq += (qs(sst[k]) * 0.95 - qq) * 0.35; // evaporation from the sea
          if (it >= spin) P[k] += qq * k0 * dry * 0.3;
        }
        T2[k] = T; q2[k] = Math.min(2, qq);
      }
    }
    Ta.set(T2); q.set(q2);
  }
  const anomaly = new Float32Array(NX * NY);
  for (let k = 0; k < anomaly.length; k++) if (!land[k]) anomaly[k] = sst[k] - clim[k];
  return { Ta, P: Float32Array.from(P, (v) => v / (steps - spin)), sst, anomaly };
}
const seasonal = SEASONS.map((s) => ({ ...s, ...simulate(s) }));
// scale rain so the wettest ~5% of land reads ~3000 mm a year (a relative index: the sim has no absolute calibration)
const allP = [];
for (let k = 0; k < land.length; k++) if (land[k]) allP.push(seasonal[0].P[k] + seasonal[1].P[k]);
allP.sort((a, b) => a - b);
const MM = 3000 / (allP[Math.floor(allP.length * 0.95)] || 1);
console.log('rain scale', MM.toFixed(0));

// ---- sampling ----
const cell = (x, y) => [Math.max(0, Math.min(NX - 1, Math.floor((x - X0) / H))), Math.max(1, Math.min(NY - 2, Math.floor((y - Y0) / H)))];
function sample(x, y, rad = 1) {
  const [ci, cj] = cell(x, y);
  const ks = [];
  for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const k = IDX(ci + di, cj + dj); if (cj + dj >= 0 && cj + dj < NY) ks.push(k); }
  const here = IDX(ci, cj);
  const L = land[here] ? ks.filter((k) => land[k]) : ks;
  const mean = (arr, f) => arr.reduce((a, k) => a + f(k), 0) / arr.length;
  const Jan = seasonal[0], Jul = seasonal[1];
  const tj = (S, k) => S.Ta[k] - (land[k] ? 0 : 0);
  const tJan = mean(L, (k) => tj(Jan, k)), tJul = mean(L, (k) => tj(Jul, k));
  const pJan = mean(L, (k) => Jan.P[k]) * MM, pJul = mean(L, (k) => Jul.P[k]) * MM;
  const phi = lat[cell(x, y)[1]];
  const [uJ, vJ] = wind(cell(x, y)[1], -1), [uL, vL] = wind(cell(x, y)[1], 1);
  const marine = (() => { // how far to the nearest sea, in miles
    let best = 1e9;
    for (let r2 = 1; r2 < 60 && best === 1e9; r2++) for (let dj = -r2; dj <= r2; dj++) for (let di = -r2; di <= r2; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r2) continue; const jj = cj0(y) + dj; if (jj < 0 || jj >= NY) continue; if (!land[IDX(ci + di, jj)]) best = Math.min(best, Math.hypot(di, dj)); }
    return best * H * MPP;
  })();
  return {
    latDeg: deg(phi), tJan, tJul, tAnn: (tJan + tJul) / 2, rainJan: pJan, rainJul: pJul, rain: pJan + pJul, elev: elev[here],
    wind: { jan: [uJ, vJ], jul: [uL, vL] }, seaMi: marine,
    sstAnomaly: Math.max(Jan.anomaly[IDX(ci, cj)], Jul.anomaly[IDX(ci, cj)], 0) || (Jan.anomaly[IDX(ci, cj)] + Jul.anomaly[IDX(ci, cj)]) / 2,
  };
}
const cj0 = (y) => cell(0, y)[1];

// ---- climate description ----
function koppen(c, lat) {
  const north = lat >= 0;
  const warm = north ? c.tJul : c.tJan, cold = north ? c.tJan : c.tJul;
  const rainWarm = north ? c.rainJul : c.rainJan, rainCold = north ? c.rainJan : c.rainJul;
  const dryThresh = 20 * (c.tAnn + (rainWarm > 2 * rainCold ? 14 : rainCold > 2 * rainWarm ? 0 : 7)) * 0.9;
  if (warm < 0) return 'ice cap';
  if (warm < 10) return 'tundra';
  if (c.rain < dryThresh * 0.5) return 'desert';
  if (c.rain < dryThresh) return 'steppe / semi-arid';
  if (cold >= 17) return rainCold < 0.35 * rainWarm || rainWarm < 0.35 * rainCold ? 'tropical savanna (wet and dry seasons)' : 'tropical rainforest';
  if (cold > -3) {
    if (rainCold > 2.5 * rainWarm) return 'mediterranean (dry summers, wet winters)';
    return warm >= 21 ? 'humid subtropical' : 'mild oceanic (cool summers, mild wet winters)';
  }
  return warm >= 18 ? 'continental (hot summers, hard winters)' : 'subarctic (short summers, long frozen winters)';
}
const windName = ([u, v], la) => {
  const ns = v > 0.05 ? 'south' : v < -0.05 ? 'north' : '';
  const ew = u > 0.05 ? 'west' : u < -0.05 ? 'east' : '';
  if (!ew && !ns) return 'calm';
  // wind direction is where it blows FROM: eastward flow = westerly
  const from = `${v > 0.05 ? 'south' : v < -0.05 ? 'north' : ''}${u > 0.05 ? 'west' : u < -0.05 ? 'east' : ''}`;
  return `${from}erly`;
};

// ---- report for regions and notable places ----
const regions = rd('regions.geojson').filter((f) => f.properties.rank <= 2 && !/Pole/.test(f.properties.name));
const places = rd('places.geojson').filter((f) => ['city', 'capital'].includes(f.properties.kind) || f.properties.rank === 1);
const rows = [];
for (const f of [...regions, ...places]) {
  const [x, y] = toPx(f.geometry.coordinates);
  const c = sample(x, y, 2);
  rows.push({ magic: f.properties.magicKind ? `${f.properties.magicLabel}${f.properties.magicFrom ? ` (via ${f.properties.magicFrom})` : ''}` : '', name: f.properties.name, kind: f.properties.kind, rank: f.properties.rank, x: +x.toFixed(0), y: +y.toFixed(0), dbId: f.properties.dbId, ...c, zone: koppen(c, deg(lat[cell(x, y)[1]])), isLand: !!land[IDX(...cell(x, y).map((v, k) => v) )] });
}
let md = `# Climate simulation of the current world\n\nGenerated by tools/climate.mjs (${new Date().toISOString().slice(0, 10)}). A coarse model, not meteorology: Mercator reading of the chart (Sellador = 49 N, equator at world y~567), three-cell winds, Stommel-type ocean gyres solved on the real coastlines, heat and moisture carried along the winds. Temperatures in C at sea level (mountains are ~6 C colder per km); rain is a relative index scaled so the wettest 5% of land is ~3000 mm a year.\n\n`;
md += `| Place | kind | lat | Jan C | Jul C | rain mm/yr | wet season | wind (Jan / Jul) | sea within | climate | magic |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows.sort((a, b) => b.latDeg - a.latDeg)) {
  const wet = r.rainJul > 1.4 * r.rainJan ? 'July-side' : r.rainJan > 1.4 * r.rainJul ? 'January-side' : 'even';
  md += `| ${r.name} | ${r.kind} | ${r.latDeg.toFixed(0)}° | ${r.tJan.toFixed(0)} | ${r.tJul.toFixed(0)} | ${Math.round(r.rain / 50) * 50} | ${wet} | ${windName(r.wind.jan)} / ${windName(r.wind.jul)} | ${Math.round(r.seaMi / 10) * 10} mi | ${r.zone} | ${r.magic || ''} |\n`;
}
fs.writeFileSync(`source/climate_report${SUFFIX}.md`, md);
fs.writeFileSync(`source/climate_rows${SUFFIX}.json`, JSON.stringify(rows, null, 1));

// ---- grids for an overlay ----
const q1 = (a, f = 10) => Array.from(a, (v) => Math.round(v * f));
fs.writeFileSync(path.join(dataDir, `climate${SUFFIX}.json`), JSON.stringify({
  x0: X0, y0: Y0, cell: H, nx: NX, ny: NY, rainScale: MM, tempFactor: 10, rainFactor: 1,
  land: Array.from(land),
  tJan: q1(seasonal[0].Ta), tJul: q1(seasonal[1].Ta),
  sstJan: q1(seasonal[0].sst), sstJul: q1(seasonal[1].sst),
  rain: Array.from(seasonal[0].P, (v, k) => Math.round((v + seasonal[1].P[k]) * MM)),
  cu: q1(cur.cu, 100), cv: q1(cur.cv, 100), anomaly: q1(seasonal[0].anomaly.map((v, k) => (v + seasonal[1].anomaly[k]) / 2)),
}));
// quick text map of the currents' direction and the rain, for eyeballing in the terminal
const ramp = ' .:-=+*#%@';
let txt = '';
for (let j = 0; j < NY; j += 4) {
  let a = '';
  for (let i = 0; i < NX; i += 3) { const k = IDX(i, j); a += land[k] ? ramp[Math.min(9, Math.floor(((seasonal[0].P[k] + seasonal[1].P[k]) * MM) / 330))] : '~'; }
  txt += a + '\n';
}
fs.writeFileSync(`source/climate_rain${SUFFIX}.txt`, txt);
console.log(`mode ${MODE}: rows`, rows.length, `-> source/climate_report${SUFFIX}.md`);
