// usage: node db_list.mjs <parent name or id> [more...]   -> lists DB places (any type) whose parentgroup matches, with a one-line description
import fs from 'node:fs';
const objs = JSON.parse(fs.readFileSync('../original_data/db/objects.json', 'utf8'));
const byId = new Map(objs.map((o) => [String(o.id), o]));
const keys = process.argv.slice(2).map((s) => s.toLowerCase());
const parentOf = (o) => o.parentgroup;
const resolve = (g) => (byId.get(g) ? byId.get(g).name : g);
for (const o of objs) {
  const p = parentOf(o).toLowerCase();
  const pn = resolve(parentOf(o)).toLowerCase();
  if (keys.some((k) => p === k || pn === k)) {
    const text = (o.shortdesc || o.description || '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`#${o.id} [${o.type}] ${o.name}  (parent: ${resolve(o.parentgroup)})  ${text}`);
  }
}
