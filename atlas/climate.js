// Climate view: colour bands over the flat map showing the model's climate (tools/climate.mjs, tools/climate_layers.mjs).
// It is not a separate renderer: the same MapLibre map keeps its coast, rivers, names and pins, gains band layers between the land and the rivers,
// and puts its terrain symbols away while the view is open.
const atlas = window.atlas;
const map = atlas.map;
const LAYERS = ['cl-sea', 'cl-land', 'cl-land-edge', 'cl-magic-regions', 'cl-magic-places', 'cl-magic-regions-name', 'cl-magic-places-name'];
const MAGIC_COLOR = ['match', ['get', 'magicKind'], 'cold', '#3d6f93', 'temperate', '#55803a', 'warm', '#c2552b', 'storms', '#8a4fbf', 'arid', '#c99a3a', '#7b5ea7'];
const VIEWS = [['zones', 'Zones'], ['jan', 'January'], ['jul', 'July'], ['rain', 'Rainfall']];
const TITLE = { zones: 'Climate zones', jan: 'Mean temperature in January', jul: 'Mean temperature in July', rain: 'Rainfall a year' };
let legend = null, built = false, view = 'zones', hidden = [], panel = null, readEl = null;

async function build() {
  legend = await (await fetch('data/climate_legend.json')).json();
  map.addSource('climate', { type: 'geojson', data: 'data/climate_zones.geojson' });
  const before = (id) => (map.getLayer(id) ? id : undefined);
  const filt = () => ['==', ['get', 'view'], view];
  // the sea first, under the land; the land bands over the land fill and the terrain tints, under lakes, rivers, roads and names
  map.addLayer({ id: 'cl-sea', type: 'fill', source: 'climate', filter: ['all', filt(), ['==', ['get', 'part'], 'sea']], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.9, 'fill-antialias': true } }, before('land-shadow'));
  map.addLayer({ id: 'cl-land', type: 'fill', source: 'climate', filter: ['all', filt(), ['==', ['get', 'part'], 'land']], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.9, 'fill-antialias': true } }, before('lakes-fill'));
  map.addLayer({ id: 'cl-land-edge', type: 'line', source: 'climate', filter: ['all', filt(), ['==', ['get', 'part'], 'land']], paint: { 'line-color': '#4a2f16', 'line-opacity': 0.22, 'line-width': 0.6 } }, before('lakes-fill'));
  // places whose climate the author set by magic (Thanatos, Tel-Tenauril, Valkith, Enaria...): marked, because the bands show the model, not the magic, except where it was applied
  const magicFilter = ['all', ['has', 'magicKind'], ['!', ['has', 'magicFrom']]]; // only the places that carry the tag themselves, not everything filed under them
  for (const src of ['regions', 'places']) {
    map.addLayer({ id: `cl-magic-${src}`, type: 'circle', source: src, filter: magicFilter, paint: { 'circle-radius': 5, 'circle-color': MAGIC_COLOR, 'circle-stroke-color': '#f6ecd0', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: `cl-magic-${src}-name`, type: 'symbol', source: src, minzoom: 3, filter: magicFilter, layout: { 'text-field': ['concat', ['get', 'name'], ' · ', ['get', 'magicLabel']], 'text-font': ['IM Fell English Italic'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#2a1a0c', 'text-halo-color': 'rgba(246,236,208,0.9)', 'text-halo-width': 1.6 } });
  }
  map.on('mousemove', onMove);
  map.on('mouseleave', () => { if (readEl) readEl.hidden = true; });
  built = true;
}

function setView(v) {
  view = v;
  for (const id of ['cl-sea', 'cl-land', 'cl-land-edge']) {
    const part = id === 'cl-sea' ? 'sea' : 'land';
    map.setFilter(id, ['all', ['==', ['get', 'view'], view], ['==', ['get', 'part'], part]]);
  }
  render();
}

function render() {
  panel.querySelector('.cl-title').textContent = TITLE[view];
  panel.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const rows = (items) => items.map((x) => `<li><i style="background:${x.color}"></i>${x.label}</li>`).join('');
  let html;
  if (view === 'zones') html = `<h4>Land</h4><ul>${rows(legend.zones)}</ul><h4>Sea, mean temperature</h4><ul class="sea">${rows(legend.sea)}</ul>`;
  else if (view === 'rain') html = `<ul>${rows(legend.rain)}</ul><p class="cl-note">A relative index: the model has no absolute calibration. Wettest places are scaled to about 3,000 mm.</p>`;
  else html = `<ul>${rows(legend.temp)}</ul><p class="cl-note">Sea level, before height lowers it.</p>`;
  panel.querySelector('.cl-legend').innerHTML = html;
}

function onMove(e) {
  if (!document.body.classList.contains('climate') || !readEl) return;
  const f = map.queryRenderedFeatures(e.point, { layers: ['cl-land', 'cl-sea'] })[0];
  if (!f) { readEl.hidden = true; return; }
  const p = f.properties, what = view === 'zones' ? (p.part === 'sea' ? `Sea, ${p.label}` : p.label) : view === 'rain' ? p.label : `${p.label} in ${view === 'jan' ? 'January' : 'July'}`;
  readEl.textContent = what; readEl.hidden = false;
}

export async function enter() {
  panel ??= document.getElementById('climate-panel');
  readEl ??= document.getElementById('climate-read');
  if (!built) {
    if (!map.isStyleLoaded()) await new Promise((r) => map.once('idle', r));
    await build();
    panel.querySelector('.seg').innerHTML = VIEWS.map(([k, l]) => `<button data-view="${k}" class="${k === view ? 'on' : ''}">${l}</button>`).join('');
    panel.querySelector('.seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
  }
  for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', 'visible');
  // put the terrain symbols away; they come back as they were
  hidden = map.getStyle().layers.filter((l) => l.id.startsWith('sym-') && (map.getLayoutProperty(l.id, 'visibility') ?? 'visible') !== 'none').map((l) => l.id);
  for (const id of hidden) map.setLayoutProperty(id, 'visibility', 'none');
  setView(view);
}

export function leave() {
  if (!built) return;
  for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', 'none');
  for (const id of hidden) map.setLayoutProperty(id, 'visibility', 'visible');
  hidden = [];
  if (readEl) readEl.hidden = true;
}
