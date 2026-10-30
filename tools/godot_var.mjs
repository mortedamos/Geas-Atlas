// Decoder for Godot 3 binary Variants (what `var2bytes` / FileAccess.store_var write), enough for Wonderdraft map files.
import fs from 'node:fs';

export function decodeVariant(buf, pos = 0) {
  let p = pos;
  const u32 = () => { const v = buf.readUInt32LE(p); p += 4; return v; };
  const i32 = () => { const v = buf.readInt32LE(p); p += 4; return v; };
  const f32 = () => { const v = buf.readFloatLE(p); p += 4; return v; };
  const str = () => { const n = u32(); const s = buf.toString('utf8', p, p + n); p += n; p += (4 - (n % 4)) % 4; return s; };
  function value() {
    const head = u32(), type = head & 0xffff, flags = head >>> 16;
    switch (type) {
      case 0: return null;
      case 1: return u32() !== 0;
      case 2: { if (flags & 1) { const v = buf.readBigInt64LE(p); p += 8; return Number(v); } return i32(); }
      case 3: { if (flags & 1) { const v = buf.readDoubleLE(p); p += 8; return v; } return f32(); }
      case 4: return str();
      case 5: return { x: f32(), y: f32() };
      case 6: return { pos: { x: f32(), y: f32() }, size: { x: f32(), y: f32() } };
      case 7: return { x: f32(), y: f32(), z: f32() };
      case 8: { const a = [f32(), f32(), f32(), f32(), f32(), f32()]; return { transform2d: a }; }
      case 9: return { plane: [f32(), f32(), f32(), f32()] };
      case 10: return { quat: [f32(), f32(), f32(), f32()] };
      case 11: return { aabb: [f32(), f32(), f32(), f32(), f32(), f32()] };
      case 12: { const a = []; for (let i = 0; i < 9; i++) a.push(f32()); return { basis: a }; }
      case 13: { const a = []; for (let i = 0; i < 12; i++) a.push(f32()); return { transform: a }; }
      case 14: return { r: f32(), g: f32(), b: f32(), a: f32() };
      case 15: { const n = u32(); if (n & 0x80000000) { const names = n & 0x7fffffff, sub = u32(); const flagsn = u32(); const parts = []; for (let i = 0; i < names + sub; i++) parts.push(str()); return { nodepath: parts.join('/') }; } const s = buf.toString('utf8', p, p + n); p += n; p += (4 - (n % 4)) % 4; return { nodepath: s }; }
      case 16: return { rid: u32() };
      case 17: { // object: class name, property count, then name + value pairs (an empty class name is null)
        if (flags & 1) { p += 8; return { objectId: true }; }
        const cls = str(); if (!cls) return null;
        const n = u32(), props = {};
        for (let i = 0; i < n; i++) { const k = str(); props[k] = value(); }
        return { object: cls, props };
      }
      case 18: { const n = u32() & 0x7fffffff; const d = {}; for (let i = 0; i < n; i++) { const k = value(); const v = value(); d[typeof k === 'object' ? JSON.stringify(k) : String(k)] = v; } return d; }
      case 19: { const n = u32() & 0x7fffffff; const a = []; for (let i = 0; i < n; i++) a.push(value()); return a; }
      case 20: { const n = u32(); const b = buf.subarray(p, p + n); p += n; p += (4 - (n % 4)) % 4; return { bytes: b }; }
      case 21: { const n = u32(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i32(); return { ints: a }; }
      case 22: { const n = u32(); const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = f32(); return { reals: a }; }
      case 23: { const n = u32(); const a = []; for (let i = 0; i < n; i++) a.push(str()); return a; }
      case 24: { const n = u32(); const a = new Float32Array(n * 2); for (let i = 0; i < n * 2; i++) a[i] = f32(); return { vec2: a }; }
      case 25: { const n = u32(); const a = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) a[i] = f32(); return { vec3: a }; }
      case 26: { const n = u32(); const a = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) a[i] = f32(); return { colors: a }; }
      default: throw new Error(`unknown variant type ${type} at ${p - 4}`);
    }
  }
  const v = value();
  return { value: v, end: p };
}

// compact outline of a decoded value, for looking at the structure without dumping it
export function outline(v, depth = 0, maxDepth = 4, name = '') {
  const pad = '  '.repeat(depth);
  if (v === null || typeof v !== 'object') return `${pad}${name}: ${typeof v === 'string' ? JSON.stringify(v.slice(0, 60)) : v}\n`;
  if (Array.isArray(v)) {
    let s = `${pad}${name}: array(${v.length})\n`;
    if (depth < maxDepth) for (const x of v.slice(0, 2)) s += outline(x, depth + 1, maxDepth, '[0..]');
    return s;
  }
  for (const k of ['bytes', 'ints', 'reals', 'vec2', 'vec3', 'colors']) if (k in v) return `${pad}${name}: ${k}(${(v[k].length / (k === 'vec2' ? 2 : k === 'vec3' ? 3 : k === 'colors' ? 4 : 1)) | 0})\n`;
  const keys = Object.keys(v);
  if (!keys.length || ['x', 'r', 'pos'].includes(keys[0])) return `${pad}${name}: ${JSON.stringify(v)}\n`;
  let s = `${pad}${name}: dict{${keys.length}}\n`;
  if (depth < maxDepth) for (const k of keys.slice(0, 40)) s += outline(v[k], depth + 1, maxDepth, k);
  return s;
}

if (process.argv[1] && process.argv[1].endsWith('godot_var.mjs')) {
  const buf = fs.readFileSync(process.argv[2]);
  const { value, end } = decodeVariant(buf, Number(process.argv[3] ?? 0));
  console.log('decoded to byte', end, 'of', buf.length);
  console.log(outline(value, 0, Number(process.argv[4] ?? 3), 'root'));
}
