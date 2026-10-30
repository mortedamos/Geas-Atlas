import fs from 'node:fs';
const objs = JSON.parse(fs.readFileSync('../original_data/db/objects.json', 'utf8'));
const byType = {};
for (const o of objs) byType[o.type] = (byType[o.type] || 0) + 1;
console.log('types', byType);
const places = objs.filter((o) => o.type === 'place');
console.log('places', places.length, 'with description', places.filter((p) => p.description.trim()).length, 'with image', places.filter((p) => p.imageuri).length);
// hierarchy via parentgroup (a name)
const children = {};
for (const p of places) (children[p.parentgroup.toLowerCase()] ||= []).push(p.name);
const names = new Set(places.map((p) => p.name.toLowerCase()));
const roots = [...new Set(places.map((p) => p.parentgroup.toLowerCase()).filter((g) => !names.has(g)))];
console.log('top-level groups (parents that are not places):', roots);
function show(name, depth) {
  if (depth > 4) return;
  for (const c of (children[name.toLowerCase()] || []).sort()) { console.log(' '.repeat(depth * 2) + c); show(c, depth + 1); }
}
for (const r of roots) { console.log(`== ${r || '(none)'}`); show(r, 1); }
