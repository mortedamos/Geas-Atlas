// Local dev server for the atlas (MapLibre needs http, not file://), plus a tiny editing API used by the
// viewer's placement mode. Bound to 127.0.0.1 only; the API does not exist on a published copy of the atlas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', 'atlas');
const placementFile = path.join(here, 'source', 'placements.json');
const unplacedFile = path.join(here, 'source', 'unplaced.json');
const editsFile = path.join(here, 'source', 'place_edits.json');
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.pbf': 'application/x-protobuf' };

const readPlacements = () => (fs.existsSync(placementFile) ? JSON.parse(fs.readFileSync(placementFile, 'utf8')) : { placements: [] });
const writePlacements = (j) => fs.writeFileSync(placementFile, JSON.stringify(j, null, 1));
// hand edits to any pin or label, keyed "<source>:<place|region>:<name on the map>"; applied by attach_notes.mjs
const readEdits = () => (fs.existsSync(editsFile) ? JSON.parse(fs.readFileSync(editsFile, 'utf8')) : { edits: {} });
const writeEdits = (j) => fs.writeFileSync(editsFile, JSON.stringify(j, null, 1));
const EDIT_FIELDS = {
  name: (v) => (typeof v === 'string' && v.trim() && v.length <= 120 ? v.trim() : undefined),
  lng: (v) => (Number.isFinite(v) ? +v.toFixed(5) : undefined),
  lat: (v) => (Number.isFinite(v) ? +v.toFixed(5) : undefined),
  kind: (v) => (typeof v === 'string' && /^[a-z]{3,12}$/.test(v) ? v : undefined),
  tier: (v) => (v === 1 || v === 2 || v === 3 ? v : undefined),
  rank: (v) => (v === 1 || v === 2 || v === 3 ? v : undefined),
  note: (v) => (typeof v === 'string' && v.trim() && v.length <= 4000 ? v.trim() : undefined),
  hidden: (v) => (v === true ? true : undefined),
};
const json = (res, code, body) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
// rebuild notes + pins (and the unplaced list) after any change
const rebuild = () => new Promise((resolve) => execFile('node', ['attach_notes.mjs', '../atlas/data'], { cwd: here }, (e1) => execFile('node', ['gazetteer.mjs', '../atlas/data'], { cwd: here }, (e2) => resolve(!e1 && !e2))));

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = decodeURIComponent(url.pathname);

  if (rel === '/api/unplaced' && req.method === 'GET') return json(res, 200, fs.existsSync(unplacedFile) ? JSON.parse(fs.readFileSync(unplacedFile, 'utf8')) : []);
  if (rel === '/api/placements' && req.method === 'GET') return json(res, 200, readPlacements());
  if (rel === '/api/place' && req.method === 'POST') {
    const { dbId, lng, lat, kind, name } = await readBody(req);
    if (!Number.isInteger(dbId) || !Number.isFinite(lng) || !Number.isFinite(lat)) return json(res, 400, { error: 'dbId, lng, lat required' });
    const j = readPlacements();
    j.placements = j.placements.filter((p) => p.dbId !== dbId).concat({ dbId, lng: +lng.toFixed(5), lat: +lat.toFixed(5), kind: kind || 'town' });
    writePlacements(j);
    if (typeof name === 'string') { const ed = readEdits(); for (const g of ['place', 'region']) if (ed.edits?.[`placed:${g}:${name}`]?.hidden) delete ed.edits[`placed:${g}:${name}`]; writeEdits(ed); }
    return json(res, 200, { ok: await rebuild(), placements: j.placements.length });
  }
  if (rel === '/api/place-edits' && req.method === 'GET') return json(res, 200, readEdits());
  if (rel === '/api/edit-place' && req.method === 'POST') {
    const { key, set = {}, unset = [], reset } = await readBody(req);
    if (typeof key !== 'string' || !/^[^:]+:(place|region):.+/.test(key)) return json(res, 400, { error: 'key required' });
    const j = readEdits();
    j.edits ||= {};
    const e = reset ? {} : { ...(j.edits[key] || {}) };
    for (const f of unset) if (f in EDIT_FIELDS) delete e[f];
    for (const [f, v] of Object.entries(set)) {
      if (!(f in EDIT_FIELDS)) continue;
      const ok = EDIT_FIELDS[f](v);
      if (ok === undefined) delete e[f]; else e[f] = ok;
    }
    if (('lng' in e) !== ('lat' in e)) { delete e.lng; delete e.lat; }
    if (Object.keys(e).length) j.edits[key] = e; else delete j.edits[key];
    writeEdits(j);
    return json(res, 200, { ok: await rebuild(), edits: Object.keys(j.edits).length });
  }
  if (rel === '/api/unplace' && req.method === 'POST') {
    const { dbId } = await readBody(req);
    const j = readPlacements();
    j.placements = j.placements.filter((p) => p.dbId !== dbId);
    writePlacements(j);
    return json(res, 200, { ok: await rebuild(), placements: j.placements.length });
  }

  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Atlas on http://localhost:${port}`));
