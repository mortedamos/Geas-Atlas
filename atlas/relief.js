// Relief mode: the map as a three.js landscape you can fly over. Heights come from data/relief.bin (tools/relief.mjs) and are relative:
// 1.0 is the highest peak. The ground is coloured like the flat map, or tinted by elevation with contour lines.
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const atlas = window.atlas;
const { PALETTE, TERRAIN_FILL } = atlas;
const HU = 22; // world px of height for a relative height of 1.0 at exaggeration 1
const STEP = 2; // one mesh vertex per STEP height cells
const geoPx = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];
const fetchJSON = (n) => fetch(`data/${n}.${n === 'relief' ? 'json' : 'geojson'}`).then((r) => r.json());

let started = null;
let renderer, scene, camera, controls, host, labelLayer, ring, mesh, panel, readout;
let running = false, items = [];
let G = null; // {x0, y0, cell, w, h, heights}
let exag = 1.6, showNames = true, tint = false;
let mapTex, tintTex;

const hAt = (x, z) => { // relative height at a world point (bilinear)
  const gx = (x - G.x0) / G.cell, gz = (z - G.y0) / G.cell;
  if (gx < 0 || gz < 0 || gx >= G.w - 1 || gz >= G.h - 1) return -0.34;
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, H = G.heights, w = G.w, k = j * w + i;
  return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fz) + (H[k + w] * (1 - fx) + H[k + w + 1] * fx) * fz;
};
const groundY = (x, z) => Math.max(0, hAt(x, z)) * HU * exag; // the sea is drawn flat at 0; the sea floor only shapes the shading

// ---------- ground colours ----------
async function paintMapColours(maxTex) {
  const SC = Math.min(2, Math.floor(maxTex / (G.w * G.cell)) || 1);
  const cv = document.createElement('canvas'); cv.width = G.w * G.cell * SC; cv.height = G.h * G.cell * SC;
  const ctx = cv.getContext('2d');
  const [land, bands, terrain, lakes, rivers] = await Promise.all(['land', 'water_bands', 'terrain', 'lakes', 'rivers'].map(fetchJSON));
  const at = (c) => { const [x, y] = geoPx(c); return [(x - G.x0) * SC / G.cell, (y - G.y0) * SC / G.cell]; };
  const path = (features) => {
    ctx.beginPath();
    for (const f of features) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) for (const ring of poly) { ring.forEach((c, i) => { const [x, y] = at(c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
    }
  };
  ctx.fillStyle = PALETTE.deep; ctx.fillRect(0, 0, cv.width, cv.height);
  for (const band of ['coast', 'shelf', 'shallows']) { path(bands.features.filter((f) => f.properties.band === band)); ctx.fillStyle = PALETTE[band]; ctx.fill('evenodd'); }
  path(land.features); ctx.fillStyle = PALETTE.land; ctx.fill('evenodd');
  for (const [kind, [color, opacity]] of Object.entries(TERRAIN_FILL)) {
    path(terrain.features.filter((f) => f.properties.kind === kind)); ctx.globalAlpha = opacity; ctx.fillStyle = color; ctx.fill('evenodd');
  }
  ctx.globalAlpha = 1;
  path(lakes.features); ctx.fillStyle = PALETTE.water; ctx.fill('evenodd');
  ctx.strokeStyle = PALETTE.water; ctx.lineCap = ctx.lineJoin = 'round';
  for (const f of rivers.features) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    ctx.lineWidth = SC * (0.55 + 0.2 * Math.min(4, f.properties.w || 1));
    for (const line of lines) { ctx.beginPath(); line.forEach((c, i) => { const [x, y] = at(c); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
  }
  path(land.features); ctx.strokeStyle = PALETTE.landEdge; ctx.lineWidth = 0.9 * SC; ctx.stroke();
  return cv;
}

// elevation tint: sea deepens to blue, land goes green > tan > brown > grey > white, with a faint line every 0.1
const RAMP = [[-0.34, [38, 78, 98]], [-0.12, [70, 118, 132]], [0, [128, 172, 172]], [0.006, [118, 158, 92]], [0.08, [166, 180, 104]], [0.16, [214, 200, 140]], [0.3, [200, 164, 104]], [0.5, [160, 120, 82]], [0.7, [128, 104, 90]], [0.85, [206, 200, 192]], [1.0, [255, 255, 255]]];
function rampColour(h) {
  if (h <= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    if (h <= RAMP[i][0]) { const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], t = (h - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]; }
  }
  return RAMP[RAMP.length - 1][1];
}
function paintTint() {
  const { w, h, heights } = G, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  const band = (v) => (v > 0 ? Math.floor(v * 10) : -1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i, v = heights[k];
      let [r, g, b] = rampColour(v);
      if (v > 0 && ((i + 1 < w && band(heights[k + 1]) !== band(v)) || (j + 1 < h && band(heights[k + w]) !== band(v)))) { r *= 0.72; g *= 0.72; b *= 0.72; }
      d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------- terrain mesh ----------
function buildMesh() {
  const { w, h, heights, x0, y0, cell } = G;
  const nx = Math.floor((w - 1) / STEP) + 1, nz = Math.floor((h - 1) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const at = (i, j) => heights[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = i * STEP, gj = j * STEP, v = j * nx + i;
      pos[v * 3] = x0 + gi * cell; pos[v * 3 + 1] = Math.max(0, heights[Math.min(h - 1, gj) * w + Math.min(w - 1, gi)]); pos[v * 3 + 2] = y0 + gj * cell;
      // slope from the full-resolution heights; the sea floor is drawn flat so its shading is left level
      const sea = pos[v * 3 + 1] <= 0;
      const dx = sea ? 0 : (at(gi + 1, gj) - at(gi - 1, gj)) / (2 * cell), dz = sea ? 0 : (at(gi, gj + 1) - at(gi, gj - 1)) / (2 * cell);
      const l = Math.hypot(dx, 1, dz);
      nor[v * 3] = -dx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -dz / l;
      uv[v * 2] = gi / (w - 1); uv[v * 2 + 1] = 1 - gj / (h - 1);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.set([a, c, b, b, c, d], o); o += 6; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// ---------- names ----------
function buildLabels(features, isRegion) {
  for (const f of features) {
    const p = f.properties, el = document.createElement('div');
    el.className = `gl ${isRegion ? 'gl-region' : 'gl-place'} gl-${p.kind} gl-r${p.rank || 3}${p.tier ? ` gl-t${p.tier}` : ''}`;
    el.style.display = 'none';
    el.innerHTML = `${isRegion ? '' : '<i></i>'}<span>${atlas.esc(p.name)}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); atlas.showCard(f); flyTo(f); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    labelLayer.appendChild(el);
    const [x, z] = geoPx(f.geometry.coordinates);
    items.push({ el, feature: f, rank: p.rank || 3, region: isRegion, x, z, w: p.name.length * (isRegion ? 9 : 6.5) + 14, shown: false });
  }
}
const V = new THREE.Vector3();
function project(x, y, z, out) {
  V.set(x, y, z).project(camera);
  out.x = (V.x * 0.5 + 0.5) * host.clientWidth; out.y = (-V.y * 0.5 + 0.5) * host.clientHeight;
  return V.z < 1 && V.z > -1;
}
function updateLabels() {
  const dist = camera.position.distanceTo(controls.target);
  const maxRank = dist > 1000 ? 1 : dist > 480 ? 2 : 3;
  const pt = { x: 0, y: 0 }, taken = [], sel = atlas.getSelected();
  const isSel = (it) => sel && it.feature && it.feature.properties.name === sel.properties.name && it.feature.properties.kind === sel.properties.kind;
  const order = items.slice().sort((a, b) => (isSel(a) ? -1 : a.rank) - (isSel(b) ? -1 : b.rank));
  for (const it of order) {
    let visible = showNames && (it.rank <= maxRank || isSel(it)) && !atlas.hiddenKinds.has(it.feature.properties.kind) && project(it.x, groundY(it.x, it.z) + 2, it.z, pt);
    if (visible) {
      const r = it.region ? { x0: pt.x - it.w / 2, x1: pt.x + it.w / 2, y0: pt.y - 8, y1: pt.y + 8 } : { x0: pt.x - 5, x1: pt.x + it.w, y0: pt.y - 8, y1: pt.y + 8 };
      if (taken.some((t) => r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0)) visible = false; else taken.push(r);
    }
    if (visible) it.el.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
    if (visible !== it.shown) { it.el.style.display = visible ? '' : 'none'; it.shown = visible; }
  }
  if (sel) {
    const [x, z] = geoPx(sel.geometry.coordinates);
    if (project(x, groundY(x, z) + 2, z, pt)) { ring.style.display = 'block'; ring.style.transform = `translate(${pt.x - 13}px, ${pt.y - 13}px)`; } else ring.style.display = 'none';
  } else ring.style.display = 'none';
}

// ---------- camera ----------
let tween = null;
export function flyTo(feature) {
  const [x, z] = geoPx(feature.geometry.coordinates);
  const to = new THREE.Vector3(x, groundY(x, z), z);
  const off = camera.position.clone().sub(controls.target);
  off.setLength(Math.min(off.length(), 260));
  const fromT = controls.target.clone(), fromC = camera.position.clone(), toC = to.clone().add(off), t0 = performance.now();
  tween = (now) => {
    const t = Math.min(1, (now - t0) / 800), e = t * t * (3 - 2 * t);
    controls.target.copy(fromT).lerp(to, e); camera.position.copy(fromC).lerp(toC, e);
    if (t >= 1) tween = null;
  };
}
function resetView() {
  const to = new THREE.Vector3(170, 0, 330), toC = new THREE.Vector3(170, 250, 690);
  const fromT = controls.target.clone(), fromC = camera.position.clone(), t0 = performance.now();
  tween = (now) => { const t = Math.min(1, (now - t0) / 800), e = t * t * (3 - 2 * t); controls.target.copy(fromT).lerp(to, e); camera.position.copy(fromC).lerp(toC, e); if (t >= 1) tween = null; };
}

// what the pointer is over: march the ray down to the ground
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function readHeight(ev) {
  const r = host.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let t = 0, hit = null;
  for (let n = 0; n < 500 && t < 6000; n++) {
    const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t, gy = groundY(px, pz);
    if (py <= gy + 0.02) { hit = [px, pz]; break; }
    t += Math.max(0.6, ((py - gy) * 0.5) / Math.max(0.06, -d.y));
  }
  if (!hit) { readout.hidden = true; return; }
  const h = hAt(hit[0], hit[1]);
  readout.hidden = false;
  readout.textContent = `x ${hit[0].toFixed(0)}  y ${hit[1].toFixed(0)}  ·  ${h > 0.006 ? `height ${(h / 0.99 * 100).toFixed(0)}% of the highest peak` : `sea, ${(-h / 0.34 * 100).toFixed(0)}% of the deepest`}`;
}

// ---------- panel ----------
function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'relief-panel';
  panel.innerHTML = `<strong>Relief</strong>
    <span class="seg"><button type="button" data-tint="0" class="on">Map colours</button><button type="button" data-tint="1">Elevation</button></span>
    <label class="rp-row">Height <input type="range" class="rp-exag" min="0.25" max="4" step="0.05" value="1.6"><span class="rp-val">1.6×</span></label>
    <label class="rp-row"><input type="checkbox" class="rp-names" checked> Names</label>
    <button type="button" class="rp-reset">Reset view</button>
    <div class="rp-note">Heights are relative, drawn from the mountains and hills of the map. Right-drag or arrow keys to pan.</div>`;
  document.getElementById('stage').appendChild(panel);
  panel.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tint]'); if (!b) return;
    tint = b.dataset.tint === '1';
    panel.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    mesh.material.map = tint ? tintTex : mapTex; mesh.material.needsUpdate = true;
  });
  const val = panel.querySelector('.rp-val');
  panel.querySelector('.rp-exag').addEventListener('input', (e) => { exag = Number(e.target.value); mesh.scale.y = HU * exag; val.textContent = `${exag.toFixed(2).replace(/\.?0+$/, '')}×`; });
  panel.querySelector('.rp-names').addEventListener('change', (e) => { showNames = e.target.checked; });
  panel.querySelector('.rp-reset').addEventListener('click', resetView);
}

async function init() {
  host = document.getElementById('relief');
  const meta = await fetchJSON('relief');
  const buf = await (await fetch('data/relief.bin')).arrayBuffer();
  const raw = new Uint16Array(buf), heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = meta.hMin + (raw[i] / 65535) * (meta.hMax - meta.hMin);
  G = { x0: meta.x0, y0: meta.y0, cell: meta.cell, w: meta.w, h: meta.h, heights };

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.prepend(renderer.domElement);
  const maxTex = Math.min(8192, renderer.capabilities.maxTextureSize);

  mapTex = new THREE.CanvasTexture(await paintMapColours(maxTex));
  tintTex = new THREE.CanvasTexture(paintTint());
  for (const t of [mapTex, tintTex]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 1, 8000);
  mesh = new THREE.Mesh(buildMesh(), new THREE.MeshStandardMaterial({ map: mapTex, roughness: 1, metalness: 0 }));
  mesh.scale.y = HU * exag;
  scene.add(mesh);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.6); sun.position.set(-500, 600, -300); scene.add(sun); // low from the north-west, as on a drawn map
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x4a3a28, 1.15));

  camera.position.set(170, 250, 690);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(170, 0, 330);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.screenSpacePanning = false;
  controls.minDistance = 25; controls.maxDistance = 2200; controls.maxPolarAngle = 1.4;
  host.tabIndex = 0;
  controls.listenToKeyEvents(host); controls.keyPanSpeed = 14;
  host.addEventListener('pointerdown', () => host.focus({ preventScroll: true }));

  labelLayer = document.createElement('div'); labelLayer.className = 'globe-labels'; host.appendChild(labelLayer);
  ring = document.createElement('div'); ring.className = 'sel-ring globe-ring'; ring.style.display = 'none'; labelLayer.appendChild(ring);
  const [places, regions] = await Promise.all([fetchJSON('places'), fetchJSON('regions')]);
  buildLabels(regions.features, true); buildLabels(places.features, false);
  atlas.dataListeners.add((fresh) => {
    items = items.filter((it) => { it.el.remove(); return false; });
    buildLabels(fresh.regions.features, true); buildLabels(fresh.places.features, false);
  });

  readout = document.createElement('div'); readout.className = 'relief-read'; readout.hidden = true; document.getElementById('stage').appendChild(readout);
  host.addEventListener('pointermove', (e) => { if (e.buttons === 0) readHeight(e); });
  host.addEventListener('pointerleave', () => { readout.hidden = true; });
  buildPanel();

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();
}

function frame(now) {
  if (!running) return;
  if (tween) tween(now);
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
}

export async function enter() {
  started ??= init();
  await started;
  running = true;
  renderer.setAnimationLoop(frame);
}
export function leave() {
  running = false;
  if (renderer) renderer.setAnimationLoop(null);
}
export const debug = { get camera() { return camera; }, get controls() { return controls; }, hAt, flyTo, get mesh() { return mesh; } };
