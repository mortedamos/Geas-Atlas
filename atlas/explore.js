// Finding things and getting between them: a search box, a filter by kind, a "nearby" list on every card, and a journey planner.
// Runs after map.js and uses what it shares in window.atlas. Everything here reads the same GeoJSON the map draws.
const startExplore = () => {
  const atlas = window.atlas, map = atlas.map, esc = atlas.esc;
  const px = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2]; // lng/lat -> world px (1/51.2 degree)
  const ll = ([x, y]) => [(x - 512) / 51.2, (512 - y) / 51.2];
  let MPP = 8.724; // miles per world px; data/scale.json holds the calibration
  fetch('data/scale.json', { cache: 'no-store' }).then((r) => r.json()).then((s) => { if (s.milesPerWorldPx) MPP = s.milesPerWorldPx; }).catch(() => {});

  const viewMode = () => (document.body.classList.contains('globe') ? 'globe' : document.body.classList.contains('relief') ? 'relief' : 'map');
  const isGlobe = () => viewMode() !== 'map'; // true for either three.js view: the flat map's planner and clicks do not apply
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const KIND_LABEL = { village: 'village', town: 'town', city: 'city', port: 'port', fort: 'fort', tower: 'tower', temple: 'temple', mine: 'mine', ruin: 'ruin', region: 'region', forest: 'forest', island: 'island', lake: 'lake', mountain: 'mountains', marsh: 'marsh' };

  // ---------- data ----------
  let places = [], regions = [];
  const take = (out) => { places = out.places.features; regions = out.regions.features; };
  const ready = Promise.all(['places', 'regions'].map((n) => fetch(`data/${n}.geojson`).then((r) => r.json()))).then(([p, r]) => take({ places: p, regions: r }));
  atlas.dataListeners.add(take);

  async function goTo(f) {
    atlas.showCard(f);
    if (viewMode() === 'globe') { const g = await import('./globe.js'); g.debug.flyTo(f); return; }
    if (viewMode() === 'relief') { const r = await import('./relief.js'); r.flyTo(f); return; }
    map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), f.properties.rank === 1 ? 5 : 7.3), essential: true });
  }

  // ---------- search ----------
  const input = document.getElementById('find'), box = document.getElementById('find-results');
  let hits = [], cur = -1;
  function search(q) {
    const n = norm(q).trim();
    if (!n) return [];
    const out = [];
    for (const f of [...places, ...regions]) {
      const p = f.properties, name = norm(p.name), aka = p.aka ? norm(p.aka) : '';
      let s = name.startsWith(n) ? 0 : name.split(/[\s'’-]+/).some((w) => w.startsWith(n)) ? 1 : name.includes(n) ? 2 : aka.includes(n) ? 3 : norm(p.kind || '') === n ? 4 : -1;
      if (s < 0) continue;
      out.push({ f, s, r: p.rank || 3 });
    }
    return out.sort((a, b) => a.s - b.s || a.r - b.r || a.f.properties.name.localeCompare(b.f.properties.name)).slice(0, 14).map((o) => o.f);
  }
  function showHits() {
    if (!input.value.trim()) { box.hidden = true; return; }
    hits = search(input.value); cur = hits.length ? 0 : -1;
    box.innerHTML = hits.length
      ? hits.map((f, i) => `<div class="find-item${i === cur ? ' on' : ''}" data-i="${i}"><span>${esc(f.properties.name)}</span><small>${esc(KIND_LABEL[f.properties.kind] || f.properties.kind || '')}</small></div>`).join('')
      : '<div class="find-none">Nothing by that name.</div>';
    box.hidden = false;
  }
  function pick(i) {
    const f = hits[i]; if (!f) return;
    box.hidden = true; input.blur();
    goTo(f);
  }
  const mark = () => box.querySelectorAll('.find-item').forEach((el, i) => el.classList.toggle('on', i === cur));
  input.addEventListener('input', async () => { await ready; showHits(); });
  input.addEventListener('focus', async () => { await ready; if (input.value.trim()) showHits(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) { cur = (cur + 1) % hits.length; mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && hits.length) { cur = (cur - 1 + hits.length) % hits.length; mark(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(cur);
    else if (e.key === 'Escape') { box.hidden = true; input.value = ''; input.blur(); }
  });
  box.addEventListener('mousedown', (e) => { const el = e.target.closest('.find-item'); if (el) { e.preventDefault(); pick(Number(el.dataset.i)); } });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.finder')) box.hidden = true; });

  // ---------- filter by kind ----------
  const PLACE_KINDS = ['village', 'town', 'city', 'port', 'fort', 'tower', 'temple', 'mine', 'ruin'];
  const REGION_KINDS = ['region', 'forest', 'island', 'lake', 'mountain', 'marsh'];
  try { for (const k of JSON.parse(localStorage.getItem('atlas-hidden-kinds') || '[]')) atlas.hiddenKinds.add(k); } catch { /* ignore */ }
  function applyKindFilter() {
    const hid = [...atlas.hiddenKinds];
    const vis = hid.length ? ['!', ['in', ['get', 'kind'], ['literal', hid]]] : null;
    const set = (id, base) => { if (map.getLayer(id)) map.setFilter(id, vis ? (base ? ['all', base, vis] : vis) : base); };
    set('poi-icons', null);
    for (const r of [1, 2, 3]) { set(`places-${r}`, ['==', ['get', 'rank'], r]); set(`regions-${r}`, ['==', ['get', 'rank'], r]); }
    try { localStorage.setItem('atlas-hidden-kinds', JSON.stringify(hid)); } catch { /* ignore */ }
  }
  {
    const d = document.createElement('details');
    d.className = 'kind-filter';
    const grid = (kinds) => `<div class="kf-grid">${kinds.map((k) => `<label><input type="checkbox" data-kind="${k}" ${atlas.hiddenKinds.has(k) ? '' : 'checked'}> ${KIND_LABEL[k]}</label>`).join('')}</div>`;
    d.innerHTML = `<summary>Show by kind</summary><div class="kf-group">Places</div>${grid(PLACE_KINDS)}<div class="kf-group">Names</div>${grid(REGION_KINDS)}`;
    d.addEventListener('change', (e) => {
      const k = e.target.dataset.kind; if (!k) return;
      if (e.target.checked) atlas.hiddenKinds.delete(k); else atlas.hiddenKinds.add(k);
      applyKindFilter();
    });
    document.getElementById('layers').appendChild(d);
    if (map.loaded()) applyKindFilter(); else map.once('load', applyKindFilter);
  }

  // ---------- nearby places on a card ----------
  const COMPASS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  const bearing = (a, b) => COMPASS[Math.round(((Math.atan2(-(b[1] - a[1]), b[0] - a[0]) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
  const miles = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * MPP;
  const fmtMi = (m) => (m < 10 ? m.toFixed(1) : String(Math.round(m / (m < 100 ? 1 : 5) * (m < 100 ? 1 : 5)))) + ' mi';
  let nearList = [];
  atlas.selectionListeners.add((feature) => {
    if (!feature) return;
    const body = document.getElementById('pane-body');
    const here = px(feature.geometry.coordinates), p = feature.properties;
    const near = places
      .filter((f) => !(f.properties.name === p.name && f.properties.kind === p.kind))
      .map((f) => ({ f, d: miles(here, px(f.geometry.coordinates)) }))
      .sort((a, b) => a.d - b.d).slice(0, 6);
    nearList = near.map((n) => n.f);
    let h = `<div class="trip-actions"><button type="button" data-trip="from">Journey from here</button><button type="button" data-trip="add">Add as a stop</button></div>`;
    if (near.length) {
      h += `<div class="nearby"><h4>Nearby</h4>${near.map((n, i) => `<div class="nb" data-i="${i}"><span>${esc(n.f.properties.name)}</span><small>${fmtMi(n.d)} ${bearing(here, px(n.f.geometry.coordinates))}</small></div>`).join('')}</div>`;
    }
    const wrap = document.createElement('div');
    wrap.className = 'explore-extra';
    wrap.innerHTML = h;
    body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const nb = e.target.closest('.nb');
      if (nb) { goTo(nearList[Number(nb.dataset.i)]); return; }
      const b = e.target.closest('[data-trip]');
      if (!b) return;
      trip.open();
      if (b.dataset.trip === 'from') trip.clear();
      trip.add(stopOf(feature));
    });
  });

  // ---------- journey planner ----------
  const stopOf = (f) => { const [x, y] = px(f.geometry.coordinates); return { name: f.properties.name, x, y }; };
  const B = { x0: -720, y0: -120, x1: 1080, y1: 1345 }; // the world, in px
  // terrain codes in the grid, and how much each slows a traveller (1 = open ground)
  const CODE = { plain: 1, forest: 2, hills: 3, mountain: 4, marsh: 5, desert: 6, ice: 7, waste: 8, ruins: 9, newgrowth: 10, lake: 11 };
  const NAME = { 1: 'open ground', 2: 'forest', 3: 'hills', 4: 'mountains', 5: 'marsh', 6: 'desert', 7: 'ice', 8: 'wasteland', 9: 'ruins', 10: 'woodland', 11: 'lake', 12: 'road' };
  const ROAD = 12, ROAD_MULT = 0.7;
  const PACES = [
    { id: 'foot', label: 'On foot', mpd: 24, m: [0, 1, 1.5, 1.4, 2.6, 2.3, 1.7, 2.2, 1.6, 1.3, 1.2] },
    { id: 'horse', label: 'On horseback', mpd: 48, m: [0, 1, 1.6, 1.5, 3, 2.6, 1.9, 2.6, 1.8, 1.4, 1.3] },
    { id: 'wagon', label: 'By wagon', mpd: 15, m: [0, 1, 2.3, 1.9, 6, 3.2, 2.2, 3.5, 2.5, 1.5, 1.4] }, // 15 miles a day is the pace the map was calibrated on
  ];
  const SHIP_MPD = 72; // 8.25 px a day in the calibration

  let geo = null;
  async function loadGeo() {
    geo ??= Promise.all(['land', 'terrain', 'lakes', 'roads'].map((n) => fetch(`data/${n}.geojson`).then((r) => r.json()))).then(([land, terrain, lakes, roads]) => ({ land, terrain, lakes, roads }));
    return geo;
  }
  const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

  // paint the land, terrain, lakes and roads of a window into a grid of cells (a cell is `cell` world px across)
  async function buildGrid(x0, y0, x1, y1, cell) {
    const { land, terrain, lakes, roads } = await loadGeo();
    const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((y1 - y0) / cell);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const T = new Uint8Array(w * h), road = new Uint8Array(w * h);
    const at = (lng, lat) => { const [x, y] = px([lng, lat]); return [(x - x0) / cell, (y - y0) / cell]; };
    const paint = (features, test) => {
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#000'; ctx.beginPath();
      for (const f of features) for (const poly of polysOf(f.geometry)) for (const ring of poly) {
        ring.forEach((c, i) => { const [x, y] = at(c[0], c[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.closePath();
      }
      ctx.fill('evenodd');
      const a = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < T.length; i++) if (a[i * 4 + 3] > 127) test(i);
    };
    paint(land.features, (i) => { T[i] = 1; });
    for (const kind of ['forest', 'newgrowth', 'ruins', 'waste', 'ice', 'desert', 'hills', 'marsh', 'mountain']) {
      const fs = terrain.features.filter((f) => f.properties.kind === kind);
      if (fs.length) paint(fs, (i) => { if (T[i]) T[i] = CODE[kind]; });
    }
    paint(lakes.features, (i) => { if (T[i]) T[i] = CODE.lake; });
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1.6, 1.4 / cell); ctx.lineJoin = 'round';
    for (const f of roads.features) {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const line of lines) { ctx.beginPath(); line.forEach((c, i) => { const [x, y] = at(c[0], c[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); }
    }
    const a = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < road.length; i++) if (a[i * 4 + 3] > 60 && T[i] && T[i] !== CODE.lake) road[i] = 1;
    return { x0, y0, cell, w, h, T, road };
  }

  // nearest passable cell to a world point, searching outward
  function snap(g, x, y, ok, maxR) {
    const cx = Math.min(g.w - 1, Math.max(0, Math.floor((x - g.x0) / g.cell))), cy = Math.min(g.h - 1, Math.max(0, Math.floor((y - g.y0) / g.cell)));
    const R = Math.ceil(maxR / g.cell);
    for (let r = 0; r <= R; r++) {
      let best = -1, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || !ok(g.T[ny * g.w + nx])) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = ny * g.w + nx; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // A* over the grid: `ok` says which cells can be entered, `mult` is the slow-down of each terrain code (road cells use ROAD_MULT)
  function astar(g, s, t, ok, mult, hMul) {
    const { w, h, T, road } = g, N = w * h;
    const cost = new Float32Array(N);
    for (let i = 0; i < N; i++) cost[i] = road[i] ? ROAD_MULT : (mult[T[i]] ?? 1);
    const gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const hf = [], hi = [];
    const push = (f, i) => { let k = hf.length; hf.push(f); hi.push(i); while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hi[k] = hi[p]; k = p; } hf[k] = f; hi[k] = i; };
    const pop = () => {
      const top = hi[0], lf = hf.pop(), li = hi.pop(), n = hf.length;
      if (n) { let k = 0; for (;;) { let c = 2 * k + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1] < hf[c]) c++; if (hf[c] >= lf) break; hf[k] = hf[c]; hi[k] = hi[c]; k = c; } hf[k] = lf; hi[k] = li; }
      return top;
    };
    const tx = t % w, ty = (t / w) | 0;
    gs[s] = 0; push(0, s);
    let steps = 0;
    while (hf.length) {
      const i = pop();
      if (i === t) break;
      if (done[i]) continue;
      done[i] = 1;
      if (++steps > 9e6) return null;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (done[j] || !ok(T[j])) continue;
        const ng = gs[i] + (dx && dy ? 1.41421 : 1) * (cost[i] + cost[j]) / 2;
        if (ng < gs[j]) { gs[j] = ng; from[j] = i; push(ng + hMul * Math.hypot(tx - nx, ty - ny), j); }
      }
    }
    if (from[t] < 0 && s !== t) return null;
    const path = [t];
    for (let i = t; i !== s; ) { i = from[i]; path.push(i); }
    return path.reverse();
  }

  const dp = (pts, tol) => { // Douglas-Peucker
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let md = 0, mi = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };

  // one leg between two world points; resolves to {pts (world px), miles by terrain, crow} or {error}
  async function routeLeg(a, b, sea) {
    const crow = Math.hypot(a.x - b.x, a.y - b.y);
    const ok = sea ? (c) => c === 0 : (c) => c !== 0 && c !== CODE.lake;
    const mult = sea ? [] : PACES[0].m;
    const attempts = [Math.max(sea ? 30 : 14, crow * (sea ? 0.8 : 0.5)), Infinity];
    for (const pad of attempts) {
      const x0 = pad === Infinity ? B.x0 : Math.max(B.x0, Math.min(a.x, b.x) - pad), x1 = pad === Infinity ? B.x1 : Math.min(B.x1, Math.max(a.x, b.x) + pad);
      const y0 = pad === Infinity ? B.y0 : Math.max(B.y0, Math.min(a.y, b.y) - pad), y1 = pad === Infinity ? B.y1 : Math.min(B.y1, Math.max(a.y, b.y) + pad);
      const cell = Math.max(0.4, Math.sqrt(((x1 - x0) * (y1 - y0)) / 2.8e6));
      const g = await buildGrid(x0, y0, x1, y1, cell);
      const reach = sea ? 12 : 6;
      const s = snap(g, a.x, a.y, ok, reach), t = snap(g, b.x, b.y, ok, reach);
      if (s < 0 || t < 0) return { error: `${s < 0 ? a.name : b.name} is not ${sea ? 'on the coast' : 'on land'}.` };
      const path = astar(g, s, t, ok, mult, sea ? 1 : ROAD_MULT);
      if (!path) { if (pad === Infinity) break; continue; }
      const world = path.map((i) => [g.x0 + ((i % g.w) + 0.5) * g.cell, g.y0 + (((i / g.w) | 0) + 0.5) * g.cell]);
      const slim = dp(world, g.cell * 0.9);
      let raw = 0, fine = 0;
      const per = new Float64Array(13), perPace = PACES.map(() => 0);
      for (let k = 1; k < path.length; k++) {
        const len = Math.hypot(world[k][0] - world[k - 1][0], world[k][1] - world[k - 1][1]) * MPP;
        const c = path[k], code = g.road[c] ? ROAD : g.T[c];
        raw += len; per[code] += len;
        PACES.forEach((p, pi) => { perPace[pi] += len * (g.road[c] ? ROAD_MULT : (p.m[code] ?? 1)); });
      }
      for (let k = 1; k < slim.length; k++) fine += Math.hypot(slim[k][0] - slim[k - 1][0], slim[k][1] - slim[k - 1][1]) * MPP;
      const f = raw > 0 ? Math.min(1, fine / raw) : 1; // the grid's staircase overstates a diagonal; scale back to the smoothed line
      return { pts: [[a.x, a.y], ...slim, [b.x, b.y]], miles: raw * f, per: Array.from(per, (v) => v * f), perPace: perPace.map((v) => v * f), crow: crow * MPP };
    }
    return { error: sea ? `There is no sea route between ${a.name} and ${b.name}.` : `No overland route from ${a.name} to ${b.name}: water lies between them. Try By sea.`, };
  }

  // ----- panel + map layers -----
  const stage = document.getElementById('stage');
  const panel = document.createElement('div');
  panel.className = 'trip'; panel.hidden = true;
  panel.innerHTML = `<div class="trip-head"><strong>Journey planner</strong><button type="button" class="trip-x" title="Close">×</button></div>
    <div class="trip-hint">Click places or open ground on the map, or search below, to set the stops in order.</div>
    <span class="seg"><button type="button" data-mode="land" class="on">Overland</button><button type="button" data-mode="sea">By sea</button></span>
    <ol class="trip-stops"></ol>
    <input class="trip-add" list="trip-names" placeholder="Add a stop by name…" autocomplete="off">
    <datalist id="trip-names"></datalist>
    <div class="trip-actions"><button type="button" class="trip-rev">Reverse</button><button type="button" class="trip-clear">Clear</button></div>
    <div class="trip-out"></div>`;
  stage.appendChild(panel);
  const q = (s) => panel.querySelector(s);
  const toggle = document.createElement('button');
  toggle.className = 'trip-toggle'; toggle.textContent = 'Plan a journey';
  document.getElementById('layers').appendChild(toggle);

  const T_SRC = 'trip';
  function ensureLayers() {
    if (map.getSource(T_SRC)) return;
    map.addSource(T_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'trip-casing', type: 'line', source: T_SRC, filter: ['==', ['get', 'k'], 'route'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f3e8c8', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 9, 8], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'trip-line', type: 'line', source: T_SRC, filter: ['==', ['get', 'k'], 'route'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9a2f1c', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 9, 3.6], 'line-dasharray': [2, 1.2] } });
    map.addLayer({ id: 'trip-stop', type: 'circle', source: T_SRC, filter: ['==', ['get', 'k'], 'stop'], paint: { 'circle-radius': 10, 'circle-color': '#9a2f1c', 'circle-stroke-color': '#f3e8c8', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'trip-num', type: 'symbol', source: T_SRC, filter: ['==', ['get', 'k'], 'stop'], layout: { 'text-field': ['get', 'n'], 'text-font': ['Cinzel SemiBold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#f6e9c6' } });
  }
  if (map.loaded()) ensureLayers(); else map.once('load', ensureLayers);

  let mode = 'land', stops = [], legs = [], seq = 0, isOpen = false;
  const fmtDays = (d) => (d < 0.95 ? `about ${Math.max(1, Math.round(d * 8))} hours` : d < 10 ? `${d.toFixed(1).replace(/\.0$/, '')} days` : `${Math.round(d)} days`);
  const fmtM = (m) => `${m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString('en-US')} mi`;

  function drawRoute() {
    ensureLayers();
    const feats = [];
    for (const l of legs) if (l && l.pts) feats.push({ type: 'Feature', properties: { k: 'route' }, geometry: { type: 'LineString', coordinates: l.pts.map(ll) } });
    stops.forEach((s, i) => feats.push({ type: 'Feature', properties: { k: 'stop', n: String(i + 1) }, geometry: { type: 'Point', coordinates: ll([s.x, s.y]) } }));
    map.getSource(T_SRC).setData({ type: 'FeatureCollection', features: feats });
  }
  function renderStops() {
    q('.trip-stops').innerHTML = stops.map((s, i) => `<li><span title="${esc(s.name)}">${esc(s.name)}</span><button type="button" data-rm="${i}" title="Remove">×</button></li>`).join('');
    q('.trip-hint').hidden = stops.length > 1;
  }
  async function recompute() {
    const my = ++seq;
    drawRoute(); renderStops();
    const out = q('.trip-out');
    legs = [];
    if (stops.length < 2) { out.innerHTML = ''; drawRoute(); return; }
    out.innerHTML = '<div class="trip-leg">Finding the way…</div>';
    await new Promise((r) => setTimeout(r, 20));
    const sea = mode === 'sea';
    for (let i = 1; i < stops.length; i++) {
      const leg = await routeLeg(stops[i - 1], stops[i], sea);
      if (my !== seq) return;
      legs.push(leg);
      if (leg.error) break;
    }
    drawRoute();
    const bad = legs.find((l) => l.error);
    let h = '';
    const good = legs.filter((l) => !l.error);
    const total = good.reduce((a, l) => a + l.miles, 0), crow = good.reduce((a, l) => a + l.crow, 0);
    if (good.length) {
      h += `<div class="tot"><b>${fmtM(total)}</b> by ${sea ? 'sea' : 'the way found'}${crow ? ` <span class="trip-leg">(${fmtM(crow)} in a straight line)</span>` : ''}</div><table>`;
      if (sea) h += `<tr><td>By ship, ${SHIP_MPD} mi a day</td><td>${fmtDays(total / SHIP_MPD)}</td></tr>`;
      else PACES.forEach((p, pi) => { const eff = good.reduce((a, l) => a + l.perPace[pi], 0); h += `<tr><td>${p.label}, ${p.mpd} mi a day</td><td>${fmtDays(eff / p.mpd)}</td></tr>`; });
      h += '</table>';
      if (!sea) {
        const per = good.reduce((a, l) => l.per.map((v, i) => v + (a[i] || 0)), []);
        const rough = per.map((v, c) => [c, v]).filter(([c, v]) => c !== 1 && c !== 0 && v >= 3).sort((a, b) => b[1] - a[1]);
        if (rough.length) h += `<div class="trip-leg">Passes through ${rough.slice(0, 4).map(([c, v]) => `${Math.round(v)} mi of ${NAME[c]}`).join(', ')}. Times allow for the going.</div>`;
      }
      if (good.length > 1 || bad) h += good.map((l, i) => `<div class="trip-leg">${i + 1} → ${i + 2}: ${esc(stops[i].name)} to ${esc(stops[i + 1].name)}, ${fmtM(l.miles)}</div>`).join('');
    }
    if (bad) h += `<div class="warn">${esc(bad.error)}</div>`;
    out.innerHTML = h;
  }

  const trip = {
    open() { isOpen = true; panel.hidden = false; atlas.cardHook = (f) => { if (!isOpen || isGlobe()) return false; trip.add(stopOf(f)); return true; }; },
    close() { isOpen = false; panel.hidden = true; atlas.cardHook = null; },
    clear() { stops = []; legs = []; seq++; q('.trip-out').innerHTML = ''; drawRoute(); renderStops(); },
    add(s) { stops.push(s); recompute(); },
  };
  toggle.addEventListener('click', () => (isOpen ? trip.close() : trip.open()));
  q('.trip-x').addEventListener('click', () => trip.close());
  q('.trip-clear').addEventListener('click', () => trip.clear());
  q('.trip-rev').addEventListener('click', () => { stops.reverse(); recompute(); });
  panel.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    mode = b.dataset.mode;
    panel.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    recompute();
  });
  q('.trip-stops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    stops.splice(Number(b.dataset.rm), 1); recompute();
  });
  const names = q('#trip-names'), addIn = q('.trip-add');
  ready.then(() => { names.innerHTML = [...places, ...regions].map((f) => `<option value="${esc(f.properties.name)}">`).join(''); });
  addIn.addEventListener('change', () => {
    const n = norm(addIn.value).trim(); if (!n) return;
    const f = [...places, ...regions].find((x) => norm(x.properties.name) === n);
    if (f) { trip.add(stopOf(f)); addIn.value = ''; } else addIn.select();
  });
  // a click on open map adds a stop there (clicks on a place go through the card hook instead)
  const CLICK_LAYERS = ['poi-icons', 'places-1', 'places-2', 'places-3', 'regions-1', 'regions-2', 'regions-3'];
  map.on('click', (e) => {
    if (!isOpen || isGlobe()) return;
    const r = 10;
    if (map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: CLICK_LAYERS.filter((id) => map.getLayer(id)) }).length) return;
    const [x, y] = px([e.lngLat.lng, e.lngLat.lat]);
    let name = `(${Math.round(x)}, ${Math.round(y)})`, best = 60 / MPP * MPP;
    for (const f of places) { const [fx, fy] = px(f.geometry.coordinates); const d = Math.hypot(fx - x, fy - y); if (d < best / MPP * 1 && d * MPP < 60) { best = d * MPP; name = `near ${f.properties.name}`; } }
    trip.add({ name, x, y });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen && document.activeElement === document.body) trip.close(); });

  atlas.explore = { goTo, trip, search, routeLeg };
};
// map.js finishes setting up window.atlas after its symbols have loaded
(function wait() { if (window.atlas) startExplore(); else setTimeout(wait, 30); })();
