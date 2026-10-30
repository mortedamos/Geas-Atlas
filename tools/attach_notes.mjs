// Attach old-database notes to the atlas places/regions, honouring the canon policy.
// Run after interior.mjs:   node attach_notes.mjs ../atlas/data
// Writes: atlas/data/notes.json (canon text only), updates places.geojson / regions.geojson with db links,
//         tools/source/canon_review.md (what was held back and why).
import fs from 'node:fs';
import path from 'node:path';
import * as turf from '@turf/turf';
import { loadMapDefs, lonlatFor } from './lib_maps.mjs';

const dataDir = path.resolve(process.argv[2] || '../atlas/data');
const objs = JSON.parse(fs.readFileSync('../original_data/db/objects.json', 'utf8'));
const users = new Map(JSON.parse(fs.readFileSync('../original_data/db/user_names.json', 'utf8')).map((u) => [u.id, u.fullname]));
const policy = JSON.parse(fs.readFileSync('source/canon_policy.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync('source/db_overrides.json', 'utf8'));
const autoMatches = JSON.parse(fs.readFileSync('source/db_matches.json', 'utf8'));
const byId = new Map(objs.map((o) => [o.id, o]));
const byName = new Map();
for (const o of objs) if (['place', 'group'].includes(o.type)) byName.set(o.name.toLowerCase(), o);

// ---- canon test ----
const thirdParty = new Set(policy.thirdPartyOwners.ids);
const forced = policy.overrides.byId || {};
function canonStatus(o) {
  if (forced[o.id] === 'canon') return { canon: true, why: 'forced' };
  if (forced[o.id] === 'exclude') return { canon: false, why: 'excluded by decision' };
  if (thirdParty.has(o.owner)) return { canon: false, why: 'third-party game content' };
  if (!policy.canonOwners.includes(o.owner)) return { canon: false, why: `written by ${users.get(o.owner) || o.owner}` };
  const last = o.modowner === '' ? null : Number(o.modowner);
  if (last !== null && !policy.includeIfLastEditedBy.includes(last)) return { canon: false, why: `canon author, but last edited by ${users.get(last) || last}` };
  return { canon: true, why: 'canon author' };
}

// ---- helpers ----
const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
function parentOf(o) {
  const g = (o.parentgroup || '').trim();
  if (!g) return null;
  if (/^\d+$/.test(g)) return byId.get(Number(g)) || null;
  return byName.get(g.toLowerCase()) || { name: g };
}
function breadcrumb(o) {
  const out = [];
  let cur = parentOf(o), guard = 0;
  while (cur && guard++ < 8) { out.unshift(cur.name); if (/^(geas|ourgos)$/i.test(cur.name)) break; cur = cur.id ? parentOf(cur) : null; }
  return out.filter((n) => !/^(ourgos)$/i.test(n));
}
// places filed under this entry (wards, taverns, districts...): shown in its card instead of as separate pins
function withinOf(parent) {
  const out = [];
  for (const o of objs) {
    if (o.type !== 'place' || o.id === parent.id || !canonStatus(o).canon) continue;
    const g = (o.parentgroup || '').trim();
    if (Number(g) === parent.id || g.toLowerCase() === parent.name.toLowerCase()) out.push({ id: o.id, name: o.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
}
function peopleAt(place) {
  const key = place.name.toLowerCase();
  const out = [];
  for (const o of objs) {
    if (!['npc', 'deity', 'group'].includes(o.type) || o.id === place.id) continue;
    const here = o.regions.split(',').map((s) => s.trim().toLowerCase()).includes(key) || (o.parentgroup || '').trim().toLowerCase() === key || Number(o.parentgroup) === place.id;
    if (here && canonStatus(o).canon) out.push({ id: o.id, name: o.name, type: o.type });
  }
  return out.slice(0, 14);
}

// ---- links: automatic exact matches + hand-checked overrides, minus rejects ----
const links = {};
for (const [k, v] of Object.entries(autoMatches)) if (v.confidence === 'exact') links[k] = { id: v.id };
for (const [k, v] of Object.entries(overrides.links)) links[k] = v;
for (const k of overrides.reject) delete links[k];

// ---- pins placed by hand with the viewer's placement mode (tools/source/placements.json) ----
const REGION_KINDS = new Set(['region', 'forest', 'mountain', 'lake', 'island', 'marsh']);
const placementFile = 'source/placements.json';
const placements = fs.existsSync(placementFile) ? JSON.parse(fs.readFileSync(placementFile, 'utf8')).placements : [];
// first-pass guesses (tools/source/auto_placements.json) fill in only where nothing was placed by hand
const mapDefs = loadMapDefs();
const autoPlacements = JSON.parse(fs.readFileSync('source/auto_placements.json', 'utf8')).placements;
// a guessed pin that falls just offshore (ports on the drawn bay, say) is pulled onto the nearest shore
const landFeat = JSON.parse(fs.readFileSync(path.join(dataDir, 'land.geojson'), 'utf8')).features[0];
const landSegs = landFeat.geometry.coordinates.flatMap((poly) => poly.flatMap((r) => r.slice(0, -1).map((a, i) => [a[0], a[1], r[i + 1][0], r[i + 1][1]])));
function snapToLand(lng, lat) {
  if (turf.booleanPointInPolygon([lng, lat], landFeat)) return [lng, lat];
  let best = { d: Infinity, q: [lng, lat] };
  for (const [x0, y0, x1, y1] of landSegs) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    let t = l2 ? ((lng - x0) * dx + (lat - y0) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const q = [x0 + t * dx, y0 + t * dy], d = Math.hypot(lng - q[0], lat - q[1]);
    if (d < best.d) best = { d, q };
  }
  const k = 1 + (0.4 * (20 / 1024)) / best.d; // continue a little past the shoreline, inland
  return [lng + (best.q[0] - lng) * k, lat + (best.q[1] - lat) * k];
}
function allPins() {
  const manual = new Set(placements.map((p) => p.dbId));
  const pins = placements.filter((p) => byId.has(p.dbId)).map((p) => ({ dbId: p.dbId, lng: p.lng, lat: p.lat, kind: p.kind, guess: false }));
  for (const a of autoPlacements) {
    const o = byId.get(a.id);
    if (!o || manual.has(a.id) || !canonStatus(o).canon) continue;
    let [lng, lat] = lonlatFor(mapDefs[a.map])([a.x, a.y]);
    if (!['lake', 'island', 'region'].includes(a.kind)) [lng, lat] = snapToLand(lng, lat);
    pins.push({ dbId: a.id, lng: +lng.toFixed(5), lat: +lat.toFixed(5), kind: a.kind, rank: a.rank, guess: !a.confirmed, basis: a.basis, rename: a.rename });
  }
  return pins;
}
function placedFeatures(group) {
  return allPins().filter((p) => (REGION_KINDS.has(p.kind) ? 'region' : 'place') === group).map((p) => {
    const o = byId.get(p.dbId);
    const shown = p.rename || o.name; // the author may call a place something other than the old notes do
    links[`placed:${group}:${shown}`] = { id: o.id };
    const props = { name: shown, ...(p.rename ? { aka: o.name } : {}), kind: p.kind, rank: p.rank ?? (group === 'region' ? 3 : 2), source: 'placed', placed: true, guess: p.guess };
    if (p.basis) props.basis = p.basis;
    return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } };
  });
}

const notes = {};
const review = [];
function attach(file, group) {
  const fc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  fc.features = fc.features.filter((f) => !f.properties.placed).concat(placedFeatures(group)); // idempotent: rebuild placed pins each run
  const kept = [];
  for (const f of fc.features) {
    const key = `${f.properties.source}:${group}:${f.properties.mapName || f.properties.name}`;
    if (overrides.skip.includes(key)) continue;
    f.properties.mapName = f.properties.mapName || f.properties.name;
    const link = links[key];
    if (link) {
      const o = byId.get(link.id);
      const st = canonStatus(o);
      f.properties.dbId = o.id;
      if (link.rename) f.properties.name = typeof link.rename === 'string' ? link.rename : o.name;
      f.properties.verified = true;
      if (st.canon) {
        f.properties.notes = true;
        if (!notes[o.id]) notes[o.id] = {
          id: o.id, name: o.name, type: o.type, path: breadcrumb(o),
          summary: clean(o.shortdesc), text: clean(o.description), people: peopleAt(o), within: withinOf(o),
        };
      } else {
        f.properties.notes = false;
        review.push({ place: f.properties.name, id: o.id, why: st.why });
      }
    } else if (group === 'place') f.properties.verified = false;
    kept.push(f);
  }
  fc.features = kept;
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(fc));
  return kept.length;
}
const np = attach('places.geojson', 'place'), nr = attach('regions.geojson', 'region');

// ---- three label levels for regions (rank 1 = major realm / sea, 2 = region, 3 = sub-region) ----
// From the old notes' hierarchy: depth under "Geas" (Sellador = 1, Midland = 2, Woods Of Saurath = 3). Small features (forests,
// islands, ranges, lakes) that hang directly off "Geas" are level 2. Entries with no database page keep their drawn rank, except
// that only "region"-type labels may stay at level 1. source/region_levels.json overrides any of this by name.
{
  const lv = JSON.parse(fs.readFileSync('source/region_levels.json', 'utf8'));
  const fc = JSON.parse(fs.readFileSync(path.join(dataDir, 'regions.geojson'), 'utf8'));
  const tally = [0, 0, 0, 0];
  for (const f of fc.features) {
    const p = f.properties, o = p.dbId ? byId.get(p.dbId) : null;
    p.origRank ??= p.rank;
    let level;
    if (lv.levels[p.name] != null) level = lv.levels[p.name];
    else if (o) {
      const depth = breadcrumb(o).length;
      level = Math.min(3, Math.max(1, depth));
      if (depth <= 1 && p.kind !== 'region') level = 2;
    } else level = p.kind !== 'region' && p.origRank === 1 ? 2 : p.origRank;
    p.rank = level; tally[level]++;
  }
  fs.writeFileSync(path.join(dataDir, 'regions.geojson'), JSON.stringify(fc));
  console.log(`region label levels: major ${tally[1]}, regions ${tally[2]}, sub-regions ${tally[3]}`);
}
// ---- hand edits (source/place_edits.json, written by the viewer's side-pane editor) ----
// An edit is keyed "<source>:<place|region>:<name on the map>" and can rename, move, change the type, set the size / label level,
// add a note, or remove the entry. Each run first puts an entry back as the build made it, then applies whatever the file says,
// so deleting an edit really undoes it. Removed map-drawn entries wait in source/place_removed_cache.json so they can come back.
{
  const edits = fs.existsSync('source/place_edits.json') ? JSON.parse(fs.readFileSync('source/place_edits.json', 'utf8')).edits || {} : {};
  const cacheFile = 'source/place_removed_cache.json';
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const n = { edited: 0, removed: 0, restored: 0 };
  for (const [file, group] of [['places.geojson', 'place'], ['regions.geojson', 'region']]) {
    const fc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const keyOf = (f) => `${f.properties.source}:${group}:${f.properties.mapName || f.properties.name}`;
    const have = new Set(fc.features.map(keyOf));
    for (const [k, v] of Object.entries(cache)) {
      if (v.group !== group || edits[k]?.hidden) continue;
      if (!have.has(k)) fc.features.push(v.feature);
      delete cache[k]; n.restored++;
    }
    const kept = [];
    for (const f of fc.features) {
      const p = f.properties, k = keyOf(f), e = edits[k];
      p.editKey = k;
      if (p.orig) { p.name = p.orig.name; p.kind = p.orig.kind; f.geometry.coordinates = p.orig.xy; delete p.orig; }
      for (const x of ['editNote', 'tierEdit', 'edited']) delete p[x];
      if (e?.hidden) {
        if (p.source !== 'placed') cache[k] = { group, feature: f };
        n.removed++;
        continue;
      }
      if (e) {
        p.orig = { name: p.name, kind: p.kind, xy: f.geometry.coordinates.slice() };
        if (e.name) p.name = e.name;
        if (e.kind) p.kind = e.kind;
        if (Number.isFinite(e.lng) && Number.isFinite(e.lat)) f.geometry.coordinates = [e.lng, e.lat];
        if (e.tier) p.tierEdit = e.tier;
        if (e.rank && group === 'region') p.rank = e.rank;
        if (e.note) p.editNote = e.note;
        p.edited = true; n.edited++;
      }
      kept.push(f);
    }
    fc.features = kept;
    fs.writeFileSync(path.join(dataDir, file), JSON.stringify(fc));
  }
  if (Object.keys(cache).length) fs.writeFileSync(cacheFile, JSON.stringify(cache)); else if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  console.log(`hand edits: ${n.edited} entries changed, ${n.removed} removed, ${n.restored} restored`);
}
fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify(notes));

// ---- settlement sizes (source/settlement_tiers.json): 1 village (small), 2 town (medium), 3 city (large) ----
// The size sets the icon scale and the label level (rank = 4 - size: cities label first, villages last).
{
  const st = JSON.parse(fs.readFileSync('source/settlement_tiers.json', 'utf8'));
  const fc = JSON.parse(fs.readFileSync(path.join(dataDir, 'places.geojson'), 'utf8'));
  const tally = { 1: 0, 2: 0, 3: 0 };
  for (const f of fc.features) {
    const p = f.properties;
    p.origRank ??= p.rank;
    const tier = st.byKind[p.kind] || st.overrides[p.name] ? (p.tierEdit ?? st.overrides[p.name] ?? st.byKind[p.kind]) : null;
    if (!tier) { delete p.tier; delete p.icon; p.rank = p.origRank; continue; }
    p.tier = tier; p.rank = 4 - tier; tally[tier]++;
    p.icon = p.kind === 'port' ? 'port' : ['', 'village', 'town', 'city'][tier]; // the symbol follows the size, not the raw kind
  }
  fs.writeFileSync(path.join(dataDir, 'places.geojson'), JSON.stringify(fc));
  console.log(`settlement sizes: ${tally[3]} cities, ${tally[2]} towns/ports, ${tally[1]} villages`);
}

// ---- magical climate (source/climate_magic.json): tag the place and everything filed under it, so the details pane can show it ----
{
  const cm = JSON.parse(fs.readFileSync('source/climate_magic.json', 'utf8'));
  const kinds = cm.kinds, lc = (v) => String(v || '').toLowerCase();
  let tagged = 0;
  for (const file of ['places.geojson', 'regions.geojson']) {
    const fc = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    for (const f of fc.features) {
      const p = f.properties, o = p.dbId ? byId.get(p.dbId) : null;
      for (const k of ['magicKind', 'magicLabel', 'magicIcon', 'magicNote', 'magicFrom']) delete p[k];
      const trail = o ? breadcrumb(o).map(lc) : [];
      for (const e of cm.effects) {
        const own = lc(e.name) === lc(p.name) || lc(e.name) === lc(p.mapName) || (e.dbId && e.dbId === p.dbId);
        const inh = e.inherit || {};
        const below = inh.children && trail.includes(lc(e.name));
        const bySource = (inh.maps || []).includes(p.source);
        if (!own && !below && !bySource) continue;
        p.magicKind = e.kind; p.magicLabel = kinds[e.kind]?.label || e.kind; p.magicIcon = kinds[e.kind]?.icon || '';
        p.magicNote = e.summary; if (!own) p.magicFrom = e.name;
        tagged++;
        break;
      }
    }
    fs.writeFileSync(path.join(dataDir, file), JSON.stringify(fc));
  }
  console.log(`magical climate: ${tagged} map entries tagged; not on the map yet: ${cm.effects.filter((e) => e.onMap === false).map((e) => e.name).join(', ') || 'none'}`);
}

// ---- review report: what the policy is holding back ----
const places = objs.filter((o) => o.type === 'place');
const held = places.filter((o) => !canonStatus(o).canon);
const byWhy = {};
for (const o of held) (byWhy[canonStatus(o).why] ||= []).push(o.name);
let md = `# Canon review\n\nGenerated by tools/attach_notes.mjs. Policy: tools/source/canon_policy.json.\n\n`;
md += `## Linked on the map but notes held back (${review.length})\n\n${review.map((r) => `- **${r.place}** (#${r.id}) — ${r.why}`).join('\n') || '_none_'}\n\n`;
md += `## All places held back by the policy (${held.length} of ${places.length})\n\n`;
for (const [why, names] of Object.entries(byWhy).sort((a, b) => b[1].length - a[1].length)) md += `### ${why} (${names.length})\n${names.sort().join(', ')}\n\n`;
fs.writeFileSync('source/canon_review.md', md);

console.log(`places ${np}, regions ${nr}; notes written for ${Object.keys(notes).length} entries; ${review.length} linked but held back`);
console.log('held back by reason:', Object.fromEntries(Object.entries(byWhy).map(([k, v]) => [k, v.length])));
