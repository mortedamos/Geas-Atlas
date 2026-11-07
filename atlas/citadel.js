// The Burroughs of Citadel: a section through the mountain, shown on the cards of Citadel and of the places on the author's drawing.
// Citadel is a city in three dimensions: its cities lie under the mountain, some under others, joined by stairs and shafts, so a flat
// map can only pin each at the spot above it. This draws what a plan cannot: the data/citadel_section.json graph, after the
// author's hand-drawn page (tools/source/citadel_section.json). Not to scale. Clicking a burrough that has a pin opens its card.
const startCitadel = () => {
  const atlas = window.atlas, esc = atlas.esc;
  let sec = null, places = [];
  const ready = Promise.all([
    fetch('data/citadel_section.json').then((r) => r.json()),
    fetch('data/places.geojson').then((r) => r.json()),
  ]).then(([s, p]) => { sec = s; places = p.features; }).catch(() => {});
  atlas.dataListeners.add((out) => { if (out.places) places = out.places.features; });

  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
  const f1 = (n) => n.toFixed(1);
  // a cavern: an ellipse with a hand-drawn wobble, closed with smooth curves
  function blob(n) {
    const k = 30, pts = [], a = hash(n.id) * 6.28, b = hash(n.id + 'b') * 6.28, c = hash(n.id + 'c') * 6.28;
    for (let i = 0; i < k; i++) {
      const t = (i / k) * Math.PI * 2, w = 1 + 0.07 * Math.sin(3 * t + a) + 0.05 * Math.sin(5 * t + b) + 0.035 * Math.sin(8 * t + c);
      pts.push([n.x + Math.cos(t) * n.rx * w, n.y + Math.sin(t) * n.ry * w]);
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let d = `M${f1(mid(pts[k - 1], pts[0])[0])},${f1(mid(pts[k - 1], pts[0])[1])}`;
    for (let i = 0; i < k; i++) { const m = mid(pts[i], pts[(i + 1) % k]); d += ` Q${f1(pts[i][0])},${f1(pts[i][1])} ${f1(m[0])},${f1(m[1])}`; }
    return d + 'Z';
  }
  const linkPath = (a, b, via = []) => {
    const p = [[a.x, a.y], ...via, [b.x, b.y]];
    let d = `M${f1(p[0][0])},${f1(p[0][1])}`;
    if (p.length === 2) return d + ` L${f1(p[1][0])},${f1(p[1][1])}`;
    for (let i = 1; i < p.length - 1; i++) { const m = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]; d += ` Q${f1(p[i][0])},${f1(p[i][1])} ${f1(i === p.length - 2 ? p[i + 1][0] : m[0])},${f1(i === p.length - 2 ? p[i + 1][1] : m[1])}`; }
    return d;
  };

  function figure(here) {
    const byId = Object.fromEntries(sec.nodes.map((n) => [n.id, n]));
    const [vx, vy, vw, vh] = sec.view;
    const gnd = sec.ground.map(([x, y]) => `${x},${y}`).join(' L');
    const earth = `M${sec.ground[0][0]},${sec.ground[0][1]} L${gnd} L${vx + vw},${vy + vh} L${vx},${vy + vh}Z`;
    const peak = sec.peak;
    let s = `<svg class="cit-svg" viewBox="${sec.view.join(' ')}" role="img" aria-label="Section through the mountain of Citadel, showing its burroughs stacked and joined">`;
    s += `<defs><pattern id="cit-hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="14" stroke="#5b4631" stroke-opacity="0.16" stroke-width="3"/></pattern></defs>`;
    s += `<path d="${earth}" fill="var(--vellum-deep)"/><path d="${earth}" fill="url(#cit-hatch)"/>`;
    s += `<path d="M${peak.map(([x, y]) => `${x},${y}`).join(' L')}" fill="var(--vellum)" stroke="var(--ink)" stroke-width="5" stroke-linejoin="round"/>`;
    s += `<path d="M${gnd.replace(/^/, '')}" fill="none" stroke="var(--ink)" stroke-width="5" stroke-linejoin="round"/>`;
    s += `<text x="${vx + 14}" y="${sec.ground[0][1] - 14}" class="cit-note">surface</text>`;
    // tunnels: a dark line with a light line inside, so they read as corridors
    for (const [a, b, via] of sec.links) s += `<path d="${linkPath(byId[a], byId[b], via)}" fill="none" stroke="var(--ink)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const [a, b, via] of sec.links) s += `<path d="${linkPath(byId[a], byId[b], via)}" fill="none" stroke="var(--vellum)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
    for (const [a, b, via, name] of sec.links) if (name) { const v = (via && via[Math.floor(via.length / 2)]) || [(byId[a].x + byId[b].x) / 2, (byId[a].y + byId[b].y) / 2]; s += `<text x="${v[0] - 14}" y="${v[1]}" class="cit-note" text-anchor="end">${esc(name)}</text>`; }
    // burroughs
    for (const n of sec.nodes) {
      if (n.kind === 'junction') continue;
      const on = here && n.place === here;
      const cls = `cit-n cit-${n.kind}${on ? ' here' : ''}${n.place ? ' pin' : ''}`;
      s += `<path d="${blob(n)}" class="${cls}" data-id="${n.id}"/>`;
    }
    for (const n of sec.nodes) {
      if (n.label === false || n.kind === 'junction') continue;
      const big = n.rx > 100, size = big ? 52 : 40;
      let x = n.x, y = n.y + size * 0.3, anchor = 'middle';
      if (n.side === 'left') { x = n.x - n.rx - 14; anchor = 'end'; y = n.y; }
      else if (n.side === 'right') { x = n.x + n.rx + 14; anchor = 'start'; y = n.y; }
      else if (n.side === 'below') { y = n.y + n.ry + size + 4; }
      else if (n.side === 'above') { y = n.y - n.ry - 12; }
      const lines = n.lines || [n.name.toUpperCase()];
      lines.forEach((t, i) => { s += `<text x="${f1(x)}" y="${f1(y + (i - (n.side === 'left' || n.side === 'right' ? (lines.length - 1) / 2 : 0)) * (size + 4))}" class="cit-name" text-anchor="${anchor}" font-size="${size}">${esc(t)}</text>`; });
      if (n.sub) s += `<text x="${f1(x)}" y="${f1(y + 34)}" class="cit-sub" text-anchor="${anchor}">${esc(n.sub)}</text>`;
    }
    for (const l of sec.labels) s += `<text x="${l.x}" y="${l.y}" class="cit-name" font-size="${l.size}" text-anchor="${l.anchor || 'middle'}">${esc(l.arrow && l.text === 'WEST' ? l.arrow + ' ' + l.text : l.arrow ? l.text + ' ' + l.arrow : l.text)}</text>`;
    return s + '</svg>';
  }

  atlas.selectionListeners.add(async (feature) => {
    if (!feature) return;
    await ready;
    if (!sec) return;
    const name = feature.properties.name;
    const node = sec.nodes.find((n) => n.place === name);
    if (name !== 'Citadel' && !node) return;
    const body = document.getElementById('pane-body');
    if (body.querySelector('.cit-fig')) return;
    const here = node ? node.place : null;
    const CAPTION = `Citadel is a city in three dimensions: its burroughs lie under the mountain, some under others. A section after the author’s drawing, not to scale.${here ? '' : ' Click a burrough with a pin to open it.'}`;
    const describe = (n) => `<b>${esc(n.name)}</b>${n.sub ? ` · <i>${esc(n.sub)}</i>` : ''}${n.place ? ' · click to open its card' : ' · on the author’s drawing; no pin on the surface map yet'}`;
    // hovering a burrough names it; clicking one that has a pin opens its card
    const wire = (root, onOpen) => {
      const cap = root.querySelector('.cit-cap'), svg = root.querySelector('svg');
      svg.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-id]'); if (el) cap.innerHTML = describe(sec.nodes.find((n) => n.id === el.dataset.id)); });
      svg.addEventListener('click', (e) => {
        const el = e.target.closest('[data-id]');
        if (!el) return;
        const n = sec.nodes.find((x) => x.id === el.dataset.id);
        if (!n || !n.place) { cap.innerHTML = describe(n); return; }
        const f = places.find((p) => p.properties.name === n.place);
        if (f && atlas.explore) { onOpen(); atlas.explore.goTo(f); }
      });
    };
    const wrap = document.createElement('div');
    wrap.className = 'cit-fig';
    wrap.innerHTML = `<h4>Under the mountain <button type="button" class="cit-big">Enlarge</button></h4>${figure(here)}<div class="cit-cap" aria-live="polite">${CAPTION}</div>`;
    const before = body.querySelector('.explore-extra');
    if (before) body.insertBefore(wrap, before); else body.appendChild(wrap);
    wire(wrap, () => {});
    wrap.querySelector('.cit-big').addEventListener('click', () => { // the same section, filling the window
      const ov = document.createElement('div');
      ov.className = 'cit-modal';
      ov.innerHTML = `<div class="cit-modal-in"><button type="button" class="cit-x" aria-label="Close">×</button>${figure(here)}<div class="cit-cap" aria-live="polite">${CAPTION}</div></div>`;
      const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.cit-x')) close(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      wire(ov, close);
    });
  });
};
(function wait() { if (window.atlas && window.atlas.explore) startCitadel(); else setTimeout(wait, 30); })();
