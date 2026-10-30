// Globe mode. The flat map is read as a Mercator chart (like the web map it is drawn on) and wrapped round a sphere:
// the full-width polar ice sheet closes into a ring, which is why the world width is 1950 px (-800 .. 1150) = 2*pi*R.
// The same GeoJSON is painted once into a big Mercator texture; a shader un-projects it onto the sphere.
// Names are HTML labels projected from the sphere, so they stay crisp and click through to the side pane like the map's.
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

const atlas = window.atlas;
const { PALETTE, TERRAIN_FILL, SYMBOL_SCALE, symbolFor, drawIcon } = atlas;

// ---- geometry of the chart ----
const X0 = -800, WORLD_W = 1950; // map px of the left edge and the width of one full turn
const R = WORLD_W / (2 * Math.PI); // map px per radian
const XC = X0 + WORLD_W / 2; // map x that faces the camera at longitude 0
const Y49 = 262; // Sellador's centre, taken as 49 degrees north (matches the 7.9 px/degree calibration closely)
const M49 = Math.log(Math.tan(Math.PI / 4 + (49 * Math.PI) / 360));
const EQUATOR_Y = Y49 + M49 * R; // map y of 0 degrees latitude (about 567)
const M_HI = 2.45, M_LO = -2.5; // Mercator span held by the texture; beyond it the edge rows (ice / deep sea) are stretched
const TW = 5120;
const TH = Math.round(((M_HI - M_LO) * TW) / (2 * Math.PI));
const K = TW / WORLD_W; // texture px per map px
const ROW0 = (M_HI - M49) * K * R - Y49 * K;
const tx = (x) => (x - X0) * K;
const ty = (y) => y * K + ROW0;
const geoPx = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];
// map px -> point on the unit sphere
function mapToSphere(x, y, out = new THREE.Vector3()) {
  const lon = (x - XC) / R;
  const m = M49 + (Y49 - y) / R;
  const lat = 2 * Math.atan(Math.exp(m)) - Math.PI / 2;
  return out.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
}

const fetchJSON = (n) => fetch(`data/${n}.geojson`).then((r) => r.json());

// ---- paint the texture ----
async function paintTexture() {
  const [land, bands, terrain, lakes, rivers, icons, currents] = await Promise.all(
    ['land', 'water_bands', 'terrain', 'lakes', 'rivers', 'icons', 'currents'].map(fetchJSON));
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const g = cv.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.fillStyle = PALETTE.deep; g.fillRect(0, 0, TW, TH);

  const WRAPS = [-WORLD_W, 0, WORLD_W];
  const polys = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  const tracePolys = (feats, ox) => {
    g.beginPath();
    for (const f of feats) for (const poly of polys(f)) for (const ring of poly) {
      ring.forEach((c, i) => { const [x, y] = geoPx(c); i ? g.lineTo(tx(x + ox), ty(y)) : g.moveTo(tx(x + ox), ty(y)); });
      g.closePath();
    }
  };
  // outlines skip the straight cut at the left/right edge of the chart: those two edges meet on the globe and are not a coast
  const flatEdge = (a, b, y) => (y < 0 ? a[1] < y + 6 && b[1] < y + 6 : a[1] > y - 6 && b[1] > y - 6); // the polar sheets are cut off flat at the top / bottom of the chart: not coasts either
  const onSeam = (a, b) => flatEdge(a, b, -140) || flatEdge(a, b, 1480) || (Math.abs(a[0] - X0) < 2 && Math.abs(b[0] - X0) < 2) || (Math.abs(a[0] - X0 - WORLD_W) < 2 && Math.abs(b[0] - X0 - WORLD_W) < 2);
  const strokePolys = (feats, ox) => {
    g.beginPath();
    for (const f of feats) for (const poly of polys(f)) for (const ring of poly) {
      const pts = ring.map(geoPx);
      for (let i = 0; i < pts.length - 1; i++) {
        if (onSeam(pts[i], pts[i + 1])) continue;
        g.moveTo(tx(pts[i][0] + ox), ty(pts[i][1])); g.lineTo(tx(pts[i + 1][0] + ox), ty(pts[i + 1][1]));
      }
    }
    g.stroke();
  };
  const fillPolys = (feats, color, alpha = 1) => {
    g.fillStyle = color; g.globalAlpha = alpha;
    for (const ox of WRAPS) { tracePolys(feats, ox); g.fill('evenodd'); }
    g.globalAlpha = 1;
  };
  const traceLine = (coords, ox) => {
    g.beginPath();
    coords.forEach((c, i) => { const [x, y] = geoPx(c); i ? g.lineTo(tx(x + ox), ty(y)) : g.moveTo(tx(x + ox), ty(y)); });
  };
  const lines = (f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates);

  // sea: depth bands, shallowest on top (same order as the map's layers)
  for (const band of ['coast', 'shelf', 'shallows']) fillPolys(bands.features.filter((f) => f.properties.band === band), PALETTE[band]);
  // warm current
  g.strokeStyle = '#b8452a'; g.globalAlpha = 0.5; g.lineWidth = 7 * K / 2;
  for (const f of currents.features) for (const l of lines(f)) for (const ox of WRAPS) { traceLine(l, ox); g.stroke(); }
  g.strokeStyle = '#e6bd62'; g.globalAlpha = 0.85; g.lineWidth = 1.6 * K / 2; g.setLineDash([6 * K, 6 * K]);
  for (const f of currents.features) for (const l of lines(f)) for (const ox of WRAPS) { traceLine(l, ox); g.stroke(); }
  g.setLineDash([]); g.globalAlpha = 1;
  // land shadow, land, terrain
  g.strokeStyle = '#2a1a0c'; g.globalAlpha = 0.35; g.lineWidth = 9 * K; g.filter = 'blur(5px)';
  for (const ox of WRAPS) strokePolys(land.features, ox);
  g.filter = 'none'; g.globalAlpha = 1;
  fillPolys(land.features, PALETTE.land);
  for (const [kind, [color, opacity]] of Object.entries(TERRAIN_FILL)) fillPolys(terrain.features.filter((f) => f.properties.kind === kind), color, opacity);
  // the sheet runs off the top of the chart: above its flat edge there is only more ice (solid colour = land under ice, so no seam)
  {
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), L = hex(PALETTE.land), I = hex(TERRAIN_FILL.ice[0]), t = TERRAIN_FILL.ice[1];
    g.fillStyle = `rgb(${L.map((v, i) => Math.round(v * (1 - t) + I[i] * t)).join(',')})`;
    g.fillRect(0, 0, TW, ty(-125));
  }
  fillPolys(lakes.features, PALETTE.water);
  g.strokeStyle = PALETTE.landEdge; g.lineWidth = 1.2 * K;
  for (const ox of WRAPS) { tracePolys(lakes.features, ox); g.stroke(); }
  // rivers
  g.strokeStyle = PALETTE.water;
  for (const f of rivers.features) {
    g.lineWidth = Math.max(1.2, (f.properties.w ?? 1) * 1.1) * K / 2;
    for (const l of lines(f)) for (const ox of WRAPS) { traceLine(l, ox); g.stroke(); }
  }
  // coastline
  g.strokeStyle = PALETTE.landEdge; g.lineWidth = 1.6 * K;
  for (const ox of WRAPS) strokePolys(land.features, ox);

  // the equator: where the Mercator chart reads 0 degrees (y = EQUATOR_Y)
  g.strokeStyle = '#9a2f1c'; g.globalAlpha = 0.9; g.lineWidth = 1.6 * K; g.setLineDash([9 * K, 6 * K]);
  g.beginPath(); g.moveTo(0, ty(EQUATOR_Y)); g.lineTo(TW, ty(EQUATOR_Y)); g.stroke();
  g.setLineDash([]); g.globalAlpha = 1;

  // terrain symbols (first two density tiers, sized like the map at roughly zoom 6)
  const ICON = { forest: 'tree', newgrowth: 'sapling', ruins: 'ruinfield', marsh: 'marsh', desert: 'desert', hills: 'hill', mountain: 'mtn' };
  const ZREF = 6.2, SCREEN_PER_MAPPX = 2 ** ZREF / 36;
  const lerpScale = (kind) => { const [a, b] = SYMBOL_SCALE[kind]; return a + (b - a) * ((ZREF - 5) / 3); };
  const cache = new Map();
  const imgFor = (id) => {
    if (cache.has(id)) return cache.get(id);
    let v;
    const sym = symbolFor(id);
    if (sym) v = { img: sym.bitmap, pr: sym.pixelRatio };
    else {
      const { data, pixelRatio } = drawIcon(id);
      const c = document.createElement('canvas'); c.width = data.width; c.height = data.height;
      c.getContext('2d').putImageData(data, 0, 0);
      v = { img: c, pr: pixelRatio };
    }
    cache.set(id, v);
    return v;
  };
  const symbols = icons.features.filter((f) => f.properties.tier <= 1 && ICON[f.properties.kind]).sort((a, b) => a.properties.sk - b.properties.sk);
  g.globalAlpha = 1;
  for (const f of symbols) {
    const p = f.properties;
    const { img, pr } = imgFor(`${ICON[p.kind]}-${p.v}`);
    const wTex = 0.7 * (img.width / pr) * p.s * lerpScale(p.kind) / SCREEN_PER_MAPPX * K;
    const hTex = wTex * (img.height / img.width);
    const [x, y] = geoPx(f.geometry.coordinates);
    g.globalAlpha = p.kind === 'forest' ? 0.92 : p.kind === 'ruins' ? 0.55 : 1;
    for (const ox of WRAPS) {
      const X = tx(x + ox);
      if (X < -hTex || X > TW + hTex) continue;
      g.drawImage(img, X - wTex / 2, ty(y) - hTex, wTex, hTex);
    }
  }
  g.globalAlpha = 1;
  return cv;
}

// ---- scene ----
const SPHERE_VERT = /* glsl */ `
  varying vec3 vObj; varying vec3 vN;
  void main() { vObj = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SPHERE_FRAG = /* glsl */ `
  uniform sampler2D map; uniform float mLo; uniform float mHi;
  varying vec3 vObj; varying vec3 vN;
  const float PI = 3.14159265359;
  void main() {
    vec3 n = normalize(vObj);
    float lon = atan(n.x, n.z);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float m = log(tan(PI * 0.25 + lat * 0.5));
    float u = lon / (2.0 * PI) + 0.5;
    float v = clamp((m - mLo) / (mHi - mLo), 0.0, 1.0);
    // atan() jumps at the date line; take the texture gradient from whichever u is continuous there
    float uB = fract(u + 0.5) - 0.5;
    vec2 a = vec2(u, v), b = vec2(uB, v);
    bool useA = fwidth(u) <= fwidth(uB);
    vec2 gx = useA ? dFdx(a) : dFdx(b), gy = useA ? dFdy(a) : dFdy(b);
    vec3 col = textureGrad(map, a, gx, gy).rgb;
    float diff = dot(vN, normalize(vec3(-0.45, 0.55, 0.7)));
    float shade = 0.62 + 0.5 * clamp(diff, 0.0, 1.0) - 0.22 * pow(1.0 - vN.z, 2.0);
    gl_FragColor = vec4(col * shade, 1.0);
    #include <colorspace_fragment>
  }`;
const ATMO_VERT = /* glsl */ `varying vec3 vN; void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ATMO_FRAG = /* glsl */ `varying vec3 vN; void main() { float i = pow(max(0.0, 0.68 - dot(vN, vec3(0.0, 0.0, 1.0))), 2.6); gl_FragColor = vec4(0.45, 0.68, 0.92, 1.0) * i * 1.5; }`;

let started = null;
let renderer, scene, camera, controls, host, labelLayer, ring;
let items = []; // {el, feature, rank, pos(Vector3), kind}
let running = false;

function buildLabels(features, isRegion) {
  for (const f of features) {
    const p = f.properties;
    const el = document.createElement('div');
    el.className = `gl ${isRegion ? 'gl-region' : 'gl-place'} gl-${p.kind} gl-r${p.rank || 3}${p.tier ? ` gl-t${p.tier}` : ''}`;
    el.style.display = 'none';
    el.innerHTML = `${isRegion ? '' : '<i></i>'}<span>${atlas.esc(p.name)}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); atlas.showCard(f); flyTo(f); });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    labelLayer.appendChild(el);
    const [x, y] = geoPx(f.geometry.coordinates);
    items.push({ el, feature: f, rank: p.rank || 3, region: isRegion, pos: mapToSphere(x, y), w: p.name.length * (isRegion ? 9 : 6.5) + 14, shown: false });
  }
}

// ---- latitude / longitude grid ----
// point on the unit sphere for a latitude / longitude in degrees (longitude 0 faces the camera at the chart's centre line)
const llToSphere = (latDeg, lonDeg, r = 1, out = new THREE.Vector3()) => {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  return out.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)).multiplyScalar(r);
};
let gridGroup = null;
function buildGridLines() {
  const pos = [];
  const seg = (a, b) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const R_GRID = 1.0012;
  for (let lat = -80; lat <= 80; lat += 10) {
    if (lat === 0) continue; // the equator is already drawn on the texture
    for (let lon = 0; lon < 360; lon += 3) seg(llToSphere(lat, lon, R_GRID), llToSphere(lat, lon + 3, R_GRID));
  }
  for (let lon = 0; lon < 360; lon += 15) {
    for (let lat = -82; lat < 82; lat += 3) seg(llToSphere(lat, lon, R_GRID), llToSphere(Math.min(lat + 3, 82), lon, R_GRID));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const grp = new THREE.Group();
  grp.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x4a2f16, transparent: true, opacity: 0.5 })));
  return grp;
}
// Degrees are shown only for the line under the pointer.
let gridTip = null, hoverLine = null, hoverMesh = null;
const RAY = new THREE.Raycaster(), NDC = new THREE.Vector2();
const fmtLat = (l) => (l === 0 ? 'Equator' : `${Math.abs(l)}° ${l > 0 ? 'N' : 'S'}`);
const fmtLon = (d) => { const v = ((((d + 180) % 360) + 360) % 360) - 180; return v === 0 ? '0°' : Math.abs(v) === 180 ? '180°' : `${Math.abs(v)}° ${v > 0 ? 'E' : 'W'}`; };
function setHoverLine(points) {
  const arr = new Float32Array(points.length * 3);
  points.forEach((p, i) => arr.set([p.x, p.y, p.z], i * 3));
  hoverLine.geometry.dispose();
  hoverLine.geometry = new THREE.BufferGeometry();
  hoverLine.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  hoverLine.visible = true;
}
function onGridHover(e) {
  const hide = () => { gridTip.hidden = true; hoverLine.visible = false; };
  if (!atlas.isGridOn() || e.buttons) return hide();
  const rect = host.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  NDC.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
  RAY.setFromCamera(NDC, camera);
  const hit = RAY.intersectObject(hoverMesh, false)[0];
  if (!hit) return hide();
  const n = hit.point.clone().normalize();
  const lat = (Math.asin(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI, lon = (Math.atan2(n.x, n.z) * 180) / Math.PI;
  // pixels on screen -> degrees on the surface here
  const pxPerRad = host.clientHeight / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(0.05, camera.position.length() - 1));
  const tolDeg = ((5 / pxPerRad) * 180) / Math.PI;
  const nearLat = Math.round(lat / 10) * 10, nearLon = Math.round(lon / 15) * 15;
  const dLat = Math.abs(lat - nearLat), dLon = Math.abs(lon - nearLon) * Math.cos((lat * Math.PI) / 180);
  if (Math.abs(nearLat) > 80 && dLat > tolDeg) return hide();
  let label, pts = [];
  if (dLat <= tolDeg && dLat <= dLon) {
    label = fmtLat(nearLat);
    for (let d = 0; d <= 360; d += 3) pts.push(llToSphere(nearLat, d, 1.002));
  } else if (dLon <= tolDeg) {
    label = fmtLon(nearLon);
    for (let l = -82; l <= 82; l += 3) pts.push(llToSphere(l, nearLon, 1.002));
  } else return hide();
  setHoverLine(pts);
  gridTip.textContent = label; gridTip.hidden = false;
  gridTip.style.transform = `translate(${px + 14}px, ${py + 14}px)`;
}

let tween = null;
function flyTo(feature) {
  const [x, y] = geoPx(feature.geometry.coordinates);
  const to = mapToSphere(x, y).normalize();
  const from = camera.position.clone();
  const dist = from.length();
  const start = from.clone().normalize();
  const t0 = performance.now();
  tween = (now) => {
    const t = Math.min(1, (now - t0) / 700), e = t * t * (3 - 2 * t);
    camera.position.copy(start).lerp(to, e).normalize().multiplyScalar(dist);
    if (t >= 1) tween = null;
  };
}

const V = new THREE.Vector3();
function project(pos, out) {
  V.copy(pos).project(camera);
  out.x = (V.x * 0.5 + 0.5) * host.clientWidth;
  out.y = (-V.y * 0.5 + 0.5) * host.clientHeight;
  return V.z < 1;
}
function updateLabels() {
  const dist = camera.position.length();
  const maxRank = dist > 4.2 ? 1 : dist > 2.4 ? 2 : 3;
  const pt = { x: 0, y: 0 };
  const taken = [];
  const sel = atlas.getSelected();
  const isSel = (it) => it.feature && it.feature === sel || (sel && it.feature && it.feature.properties.name === sel.properties.name && it.feature.properties.kind === sel.properties.kind);
  const order = items.slice().sort((a, b) => (isSel(a) ? -1 : a.rank) - (isSel(b) ? -1 : b.rank));
  for (const it of order) {
    let visible = (it.rank <= maxRank || isSel(it)) && !(it.feature && atlas.hiddenKinds.has(it.feature.properties.kind)) && it.pos.dot(camera.position) > 1.02 && project(it.pos, pt);
    if (visible) {
      const r = it.region
        ? { x0: pt.x - it.w / 2, x1: pt.x + it.w / 2, y0: pt.y - 8, y1: pt.y + 8 }
        : { x0: pt.x - 5, x1: pt.x + it.w, y0: pt.y - 8, y1: pt.y + 8 };
      if (taken.some((t) => r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0)) visible = false;
      else taken.push(r);
    }
    if (visible) { it.el.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`; }
    if (visible !== it.shown) { it.el.style.display = visible ? '' : 'none'; it.shown = visible; }
  }
  if (sel) {
    const [x, y] = geoPx(sel.geometry.coordinates);
    const p = mapToSphere(x, y);
    if (p.dot(camera.position) > 1.02 && project(p, pt)) { ring.style.display = 'block'; ring.style.transform = `translate(${pt.x - 13}px, ${pt.y - 13}px)`; }
    else ring.style.display = 'none';
  } else ring.style.display = 'none';
}

async function init() {
  host = document.getElementById('globe');
  const tex = new THREE.CanvasTexture(await paintTexture());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.flipY = true;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.prepend(renderer.domElement);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
  const globe = hoverMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, mLo: { value: M_LO }, mHi: { value: M_HI } },
    vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
  }));
  scene.add(globe);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.07, 64, 48), new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  })));
  // stars
  const pts = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20);
    pts.set([v.x, v.y, v.z], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8e6, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

  // start facing the middle of the known world, tilted toward the pole
  const mid = mapToSphere(300, 300).normalize();
  camera.position.copy(mid.multiplyScalar(2.8));
  camera.lookAt(0, 0, 0);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 1.3; controls.maxDistance = 6;
  controls.zoomSpeed = 0.8;
  // slower drags when zoomed in
  controls.addEventListener('change', () => { controls.rotateSpeed = Math.max(0.12, Math.min(1, (camera.position.length() - 1) * 0.5)); });

  labelLayer = document.createElement('div'); labelLayer.className = 'globe-labels'; host.appendChild(labelLayer);
  ring = document.createElement('div'); ring.className = 'sel-ring globe-ring'; ring.style.display = 'none'; labelLayer.appendChild(ring);
  for (let k = 0; k < 4; k++) {
    const el = document.createElement('div');
    el.className = 'gl gl-region gl-equator'; el.style.display = 'none'; el.innerHTML = '<span>Equator</span>';
    labelLayer.appendChild(el);
    items.push({ el, feature: null, rank: 1, region: true, pos: mapToSphere(XC + (k * WORLD_W) / 4, EQUATOR_Y), w: 70, shown: false, inert: true });
  }
  const [places, regions] = await Promise.all([fetchJSON('places'), fetchJSON('regions')]);
  buildLabels(regions.features, true);
  buildLabels(places.features, false);
  // pins edited in the side pane: drop the old labels and build them again from the fresh data
  atlas.dataListeners.add((fresh) => {
    items = items.filter((it) => { if (it.feature) it.el.remove(); return !it.feature; });
    buildLabels(fresh.regions.features, true);
    buildLabels(fresh.places.features, false);
  });

  // latitude / longitude grid: parallels every 10 degrees, meridians every 15, drawn as lines just above the surface
  gridGroup = buildGridLines();
  gridGroup.visible = atlas.isGridOn();
  scene.add(gridGroup);
  hoverLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9a2f1c }));
  hoverLine.visible = false; hoverLine.frustumCulled = false; scene.add(hoverLine);
  gridTip = document.createElement('div'); gridTip.className = 'grid-tip'; gridTip.hidden = true; host.appendChild(gridTip);
  host.addEventListener('pointermove', onGridHover);
  host.addEventListener('pointerleave', () => { gridTip.hidden = true; hoverLine.visible = false; });
  window.addEventListener('atlas-grid', () => { gridGroup.visible = atlas.isGridOn(); if (!gridGroup.visible) { gridTip.hidden = true; hoverLine.visible = false; } });

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    // keep the whole disc in view when the stage is taller than wide
    camera.fov = w >= h ? 36 : (2 * Math.atan(Math.tan((36 * Math.PI) / 360) * (h / w)) * 180) / Math.PI;
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
// for testing from the console
export const debug = { get camera() { return camera; }, get controls() { return controls; }, mapToSphere, flyTo };
