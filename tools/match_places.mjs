// Match the names transcribed from the maps (tools/source/*.json) to entries in the old database.
// Writes tools/source/db_matches.json (atlas name -> db id) and prints a report to review.
// usage: node match_places.mjs
import fs from 'node:fs';

const objs = JSON.parse(fs.readFileSync('../original_data/db/objects.json', 'utf8'));
const byId = new Map(objs.map((o) => [o.id, o]));
const places = objs.filter((o) => o.type === 'place');
const others = objs.filter((o) => ['group', 'race', 'creature'].includes(o.type));

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(port of|the|tel-|isle of|city of|caer)\b/g, ' ').replace(/[^a-z]/g, '');
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const score = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

const maps = ['tel-tenauril', 'sellador', 'argusund', 'free-nations', 'curmeah', 'lochlainn'].map((n) => ({ n, d: JSON.parse(fs.readFileSync(`source/${n}.json`, 'utf8')) }));
const result = {};
const lines = [];
for (const { n, d } of maps) {
  for (const [group, list] of [['place', d.places || []], ['region', d.regions || []]]) {
    for (const item of list) {
      const key = norm(item.name);
      const rank = (pool) => pool.map((o) => ({ o, s: score(key, norm(o.name)) })).sort((a, b) => b.s - a.s);
      const best = [...rank(places).slice(0, 3), ...rank(others).slice(0, 1)].sort((a, b) => b.s - a.s);
      const top = best[0];
      const status = top.s >= 0.99 ? 'exact' : top.s >= 0.7 ? 'close' : 'none';
      lines.push(`${status.padEnd(5)} ${n.padEnd(13)} ${item.name.padEnd(24)} -> ${status === 'none' ? '' : top.o.name} (#${top.o.id}, ${top.o.type}, ${top.s.toFixed(2)})${status === 'none' ? `   nearest: ${best.slice(0, 2).map((b) => b.o.name).join(', ')}` : ''}`);
      if (status !== 'none') result[`${n}:${group}:${item.name}`] = { id: top.o.id, db_name: top.o.name, confidence: status, score: +top.s.toFixed(2) };
    }
  }
}
fs.writeFileSync('source/db_matches.json', JSON.stringify(result, null, 1));
console.log(lines.sort().join('\n'));
const c = Object.values(result).reduce((a, v) => ((a[v.confidence] = (a[v.confidence] || 0) + 1), a), {});
console.log('\nmatched', c, 'of', lines.length);
