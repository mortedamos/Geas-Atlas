// Parse the INSERT statements of a phpMyAdmin dump into JSON, for the tables named on the command line.
// The `users` table (logins) is deliberately never read.
// usage: node parse_sql.mjs <dump.sql> <outDir> objects events location_compass
import fs from 'node:fs';
import path from 'node:path';

const [dumpFile, outDir, ...tables] = process.argv.slice(2);
const sql = fs.readFileSync(dumpFile, 'utf8');
fs.mkdirSync(outDir, { recursive: true });

function parseValues(text, start) {
  const rows = [];
  let i = start, row = null;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (row === null) {
      if (c === '(') { row = []; i++; continue; }
      if (c === ';') return { rows, end: i + 1 };
      i++; continue;
    }
    if (c === ' ' || c === '\n' || c === '\r' || c === ',') { i++; continue; }
    if (c === ')') { rows.push(row); row = null; i++; continue; }
    if (c === "'") {
      let s = '';
      i++;
      while (i < n) {
        const d = text[i];
        if (d === '\\') {
          const e = text[i + 1];
          s += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e === 'Z' ? '\x1a' : e;
          i += 2;
        } else if (d === "'" && text[i + 1] === "'") { s += "'"; i += 2; }
        else if (d === "'") { i++; break; }
        else { s += d; i++; }
      }
      row.push(s);
      continue;
    }
    let j = i;
    while (j < n && text[j] !== ',' && text[j] !== ')') j++;
    const tok = text.slice(i, j).trim();
    row.push(tok === 'NULL' ? null : Number(tok));
    i = j;
  }
  return { rows, end: n };
}

for (const table of tables) {
  if (table === 'users') { console.log('skipping users'); continue; }
  const re = new RegExp('INSERT INTO `' + table + '` \\(([^)]*)\\) VALUES', 'g');
  const out = [];
  let m;
  while ((m = re.exec(sql))) {
    const cols = m[1].split(',').map((c) => c.trim().replace(/`/g, ''));
    const { rows, end } = parseValues(sql, m.index + m[0].length);
    for (const r of rows) out.push(Object.fromEntries(cols.map((c, k) => [c, r[k]])));
    re.lastIndex = end;
  }
  fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(out, null, 1));
  console.log(table, out.length, 'rows');
}
