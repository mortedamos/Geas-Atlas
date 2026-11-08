// Paint terrain (local copy only). Pick a kind of ground, drag over the map to paint it in colour, then "Fill in symbols": the strokes are
// saved on the dev server (tools/source/terrain_paint.json), the terrain is cut and merged, and trees / mountains / dunes / ... are
// scattered over the painted ground. The published atlas has no editing API, so none of this appears there.
(() => {
  const KINDS = [
    ['forest', 'Forest'], ['jungle', 'Jungle'], ['plains', 'Plains'], ['newgrowth', 'New growth'], ['mountain', 'Mountains'], ['hills', 'Hills'], ['marsh', 'Marsh'],
    ['desert', 'Desert'], ['ruins', 'Ruins'], ['waste', 'Wasteland'], ['ice', 'Ice'], ['erase', 'Bare land (erase)'],
  ];
  const start = async () => {
    const atlas = window.atlas, map = atlas.map;
    let saved;
    try { const r = await fetch('/api/terrain-paint'); if (!r.ok) return; saved = await r.json(); } catch { return; }

    const darker = (hex, k = 0.8) => '#' + hex.slice(1).match(/../g).map((h) => Math.round(parseInt(h, 16) * k).toString(16).padStart(2, '0')).join('');
    const colour = (kind) => (kind === 'erase' ? '#fffdf2' : darker(atlas.TERRAIN_FILL[kind][0], kind === 'ice' ? 0.9 : 0.8));

    let kind = 'forest', brushPx = 28, active = false, busy = false;
    const pending = []; // strokes drawn but not saved yet: {kind, r (world px), pts (chart lng/lat)}
    let cur = null, panning = false, lastPx = null;

    // ---- panel ----
    const panel = document.createElement('div');
    panel.className = 'placer painter docked'; panel.hidden = true;
    panel.innerHTML = `<div class="placer-head"><strong>Paint terrain</strong><button class="placer-close" title="Close">×</button></div>
      <div class="placer-hint painter-hint">Pick a ground, then drag on the map to paint it. Right-drag moves the map; scroll zooms.</div>
      <div class="painter-kinds">${KINDS.map(([k, n]) => `<button type="button" data-kind="${k}"><i style="background:${colour(k)}"></i>${n}</button>`).join('')}</div>
      <label class="painter-brush">Brush <input type="range" min="6" max="110" value="${brushPx}"><span></span></label>
      <div class="painter-row"><button type="button" class="painter-undo" disabled>Undo stroke</button><button type="button" class="painter-fill" disabled>Fill in symbols</button></div>
      <div class="painter-saved"></div>
      <div class="painter-status"></div>`;
    document.body.appendChild(panel);
    const $ = (s) => panel.querySelector(s);
    const hint = $('.painter-hint'), status = $('.painter-status'), fillBtn = $('.painter-fill'), undoBtn = $('.painter-undo');
    const savedEl = $('.painter-saved'), slider = $('.painter-brush input'), sliderOut = $('.painter-brush span');
    const toggle = document.createElement('button');
    toggle.className = 'placer-toggle'; toggle.textContent = 'Paint terrain'; toggle.dataset.menu = 'paint';
    document.getElementById('layers').appendChild(toggle);

    // ---- overlay: pending strokes in colour, translucent as a whole ----
    const cv = document.createElement('canvas');
    cv.className = 'paint-canvas'; cv.style.pointerEvents = 'none';
    map.getContainer().appendChild(cv);
    const ctx = cv.getContext('2d');
    const cursor = document.createElement('div');
    cursor.className = 'brush-cursor'; cursor.hidden = true;
    map.getContainer().appendChild(cursor);

    const toScreen = (c) => { const p = map.project(AP.aToW(c)); return [p.x, p.y]; };
    // screen px per world px here (the chart's own pixel; 1 degree = 51.2 of them)
    const scale = () => { const c = map.getCenter(), a = AP.wToA(c.toArray()), p = toScreen(a), q = toScreen([a[0] + 1 / 51.2, a[1]]); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
    const flat = () => !document.body.classList.contains('globe');

    function redraw() {
      const w = map.getContainer().clientWidth, h = map.getContainer().clientHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const list = cur ? [...pending, cur] : pending;
      if (!list.length || !flat()) return;
      const s = scale();
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const st of list) {
        ctx.strokeStyle = ctx.fillStyle = colour(st.kind);
        ctx.lineWidth = Math.max(1, 2 * st.r * s);
        const pts = st.pts.map(toScreen);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    }
    map.on('move', redraw); map.on('resize', redraw); map.on('render', () => { if (pending.length || cur) redraw(); });

    // ---- panel state ----
    function ui() {
      for (const b of panel.querySelectorAll('.painter-kinds button')) b.classList.toggle('on', b.dataset.kind === kind);
      sliderOut.textContent = `${brushPx} px`;
      undoBtn.disabled = busy || !pending.length;
      fillBtn.disabled = busy || !pending.length;
      fillBtn.textContent = busy ? 'Working…' : pending.length ? `Fill in symbols (${pending.length})` : 'Fill in symbols';
      savedEl.innerHTML = saved.batches ? `Saved: ${saved.batches} fill${saved.batches === 1 ? '' : 's'} · <button type="button" data-do="undo">Undo last fill</button> <button type="button" data-do="clear">Remove all painting</button>` : '';
      cursor.style.width = cursor.style.height = `${brushPx * 2}px`;
      cursor.style.borderColor = kind === 'erase' ? '#9a2f1c' : darker(colour(kind), 0.6);
    }
    function setActive(on) {
      active = on; panel.hidden = !on; atlas.painting = on;
      document.body.classList.toggle('painting-tool', on); // the panel takes the details pane's place (index.html)
      cursor.hidden = true;
      if (on) { map.dragPan.disable(); map.getCanvas().style.cursor = 'none'; } else { map.dragPan.enable(); map.getCanvas().style.cursor = ''; }
      if (!on) { cur = null; }
      redraw(); ui();
    }
    toggle.addEventListener('click', () => (active ? setActive(false) : setActive(true)));
    $('.placer-close').addEventListener('click', () => setActive(false));
    panel.querySelector('.painter-kinds').addEventListener('click', (e) => { const b = e.target.closest('button[data-kind]'); if (b) { kind = b.dataset.kind; ui(); } });
    slider.addEventListener('input', () => { brushPx = Number(slider.value); ui(); });
    undoBtn.addEventListener('click', () => { pending.pop(); redraw(); ui(); });
    document.addEventListener('keydown', (e) => {
      if (!active || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && document.activeElement.type !== 'range') return;
      if (e.key === 'Escape') setActive(false);
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { pending.pop(); redraw(); ui(); e.preventDefault(); }
    });

    // ---- painting ----
    const chartAt = (e) => AP.wToA(e.lngLat.toArray()).map((v) => +v.toFixed(4));
    map.getContainer().addEventListener('contextmenu', (e) => { if (active) e.preventDefault(); });
    map.on('mousedown', (e) => {
      if (!active || busy) return;
      if (e.originalEvent.button === 2) { panning = true; return; }
      if (e.originalEvent.button !== 0) return;
      if (!flat()) { hint.textContent = 'Zoom in to the flat map to paint.'; return; }
      const s = scale();
      cur = { kind, r: Math.max(0.2, +(brushPx / s).toFixed(2)), pts: [chartAt(e)] };
      lastPx = [e.point.x, e.point.y];
      redraw();
    });
    map.on('mousemove', (e) => {
      if (!active) return;
      cursor.hidden = false;
      cursor.style.transform = `translate(${e.point.x - brushPx}px, ${e.point.y - brushPx}px)`;
      if (panning) { map.panBy([-e.originalEvent.movementX, -e.originalEvent.movementY], { animate: false }); return; }
      if (!cur) return;
      if (Math.hypot(e.point.x - lastPx[0], e.point.y - lastPx[1]) < 3) return;
      lastPx = [e.point.x, e.point.y];
      cur.pts.push(chartAt(e));
      redraw();
    });
    const finish = () => {
      panning = false;
      if (!cur) return;
      pending.push(cur); cur = null; redraw(); ui();
      hint.textContent = 'Keep painting, or press “Fill in symbols” when you are done.';
    };
    map.on('mouseup', finish);
    window.addEventListener('mouseup', finish);
    map.on('mouseout', () => { cursor.hidden = true; });

    // ---- saving ----
    async function refreshTerrain() {
      const stamp = Date.now();
      const [terrain, icons] = await Promise.all(['terrain', 'icons'].map(async (n) => (await fetch(`data/${n}.geojson?${stamp}`)).json()));
      map.getSource('terrain').setData(terrain);
      map.getSource('icons').setData(icons);
    }
    async function send(body, working) {
      busy = true; status.textContent = working; ui();
      try {
        const res = await (await fetch('/api/terrain-paint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
        if (res.error) throw new Error(res.error);
        saved = { batches: res.batches };
        if (!res.ok) status.textContent = 'Saved, but the rebuild reported a problem.';
        await refreshTerrain();
        if (res.ok) status.textContent = `Done. ${(res.report || []).join(' · ')}`.trim();
        return true;
      } catch (err) { status.textContent = `Could not save: ${err.message}`; return false; } finally { busy = false; ui(); }
    }
    fillBtn.addEventListener('click', async () => {
      if (!pending.length) return;
      const strokes = pending.map((s) => ({ kind: s.kind, r: s.r, pts: s.pts }));
      if (await send({ strokes }, 'Cutting the terrain and scattering symbols…')) { pending.length = 0; redraw(); ui(); hint.textContent = 'Pick a ground, then drag on the map to paint it.'; }
    });
    savedEl.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-do]'); if (!b || busy) return;
      if (b.dataset.do === 'clear' && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Click again to remove all painting'; return; }
      await send(b.dataset.do === 'clear' ? { clear: true } : { undo: true }, 'Rebuilding the terrain…');
    });
    ui();
  };
  (function wait() { if (window.atlas) start(); else setTimeout(wait, 30); })();
})();
