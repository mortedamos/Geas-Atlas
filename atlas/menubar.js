// The menu band across the top. Layers shows or hides the Layers panel; Plan a journey, Place entries and Paint terrain open the tools
// that the other scripts build (they tag their own buttons data-menu="journey|place|paint" and leave them in the Layers panel, hidden);
// View holds Map | Globe | Relief | Climate, which map.js wires up (it looks for ".modes button"). Place entries and Paint terrain
// exist only on the local dev server, so their menu items stay hidden until the tools show up.
(() => {
  const bar = document.getElementById('menubar');
  const layersPanel = document.getElementById('layers');
  const btn = (act) => bar.querySelector(`[data-act="${act}"]`);
  const tool = (act) => layersPanel.querySelector(`[data-menu="${act}"]`);
  const TOOLS = ['journey', 'place', 'paint'];

  // ---- is a tool's panel open? ----
  const isOpen = {
    journey: () => { const p = document.querySelector('.trip'); return !!p && !p.hidden; },
    place: () => { const p = document.querySelector('.placer:not(.painter)'); return !!p && !p.hidden; },
    paint: () => { const p = document.querySelector('.painter'); return !!p && !p.hidden; },
  };
  const close = {
    journey: () => tool('journey')?.click(),
    place: () => document.querySelector('.placer:not(.painter) .placer-close')?.click(),
    paint: () => tool('paint')?.click(),
  };
  const sync = () => {
    for (const t of TOOLS) btn(t).classList.toggle('on', isOpen[t]());
    const shown = !document.body.classList.contains('layers-hidden');
    btn('layers').classList.toggle('on', shown);
    btn('layers').setAttribute('aria-pressed', String(shown));
  };

  // ---- tools appear as their scripts build them ----
  const discover = () => {
    for (const t of TOOLS) {
      const src = tool(t), b = btn(t);
      if (!src) continue;
      b.parentElement.hidden = false;
      if (t === 'place') b.textContent = src.textContent; // keeps the "(n)" count
    }
  };
  new MutationObserver(discover).observe(layersPanel, { childList: true, subtree: true, characterData: true });
  discover();

  // ---- Layers ----
  let hid = false;
  try { hid = localStorage.getItem('atlas-layers-hidden') === '1'; } catch { /* ignore */ }
  document.body.classList.toggle('layers-hidden', hid);
  btn('layers').addEventListener('click', () => {
    const now = document.body.classList.toggle('layers-hidden');
    try { localStorage.setItem('atlas-layers-hidden', now ? '1' : '0'); } catch { /* ignore */ }
    sync();
  });

  // ---- tools: one at a time, since they share the right-hand side of the map ----
  for (const t of TOOLS) {
    btn(t).addEventListener('click', () => {
      const src = tool(t); if (!src) return;
      if (!isOpen[t]()) for (const o of TOOLS) if (o !== t && isOpen[o]()) close[o]();
      src.click();
      sync();
    });
  }
  // panels open and close from their own buttons and Esc too
  new MutationObserver(sync).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });

  // ---- View ----
  const view = document.getElementById('mb-view'), viewBtn = view.querySelector('.mb-caret');
  const setView = (open) => { view.classList.toggle('open', open); viewBtn.setAttribute('aria-expanded', String(open)); };
  viewBtn.addEventListener('click', (e) => { e.stopPropagation(); setView(!view.classList.contains('open')); });
  view.querySelector('.mb-drop').addEventListener('click', () => setView(false)); // map.js handles the choice itself
  document.addEventListener('click', (e) => { if (!view.contains(e.target)) setView(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setView(false); });

  sync();
})();
