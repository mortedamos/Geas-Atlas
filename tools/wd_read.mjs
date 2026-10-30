// Read a Wonderdraft map (.wonderdraft_map). The file is a Godot "GCPF" compressed file: magic, mode (0 = FastLZ), block size, total size,
// a table of compressed block sizes, then the blocks. Decompresses it to _wd_raw.bin next to the script's cwd (or argv[3]).
// usage: node wd_read.mjs <file.wonderdraft_map> [out.bin]
import fs from 'node:fs';

function fastlzDecompress(inp, outCap) {
  const level = (inp[0] >> 5) + 1;
  const out = Buffer.alloc(outCap);
  let ip = 0, op = 0;
  let ctrl = inp[ip++] & 31;
  const end = inp.length;
  for (;;) {
    let len = ctrl >> 5, ref = op;
    const ofs = (ctrl & 31) << 8;
    if (ctrl >= 32) {
      len--; ref -= ofs;
      if (level === 1) {
        if (len === 6) len += inp[ip++];
        ref -= inp[ip++];
      } else {
        if (len === 6) { let code; do { code = inp[ip++]; len += code; } while (code === 255); }
        const code = inp[ip++]; ref -= code;
        if (code === 255 && ofs === (31 << 8)) { let o2 = inp[ip++] << 8; o2 += inp[ip++]; ref = op - o2 - 8191; }
      }
      len += 3;
      ref -= 1;
      if (ref < 0 || op + len > outCap) throw new Error(`bad match at op ${op} ref ${ref} len ${len}`);
      for (let k = 0; k < len; k++) out[op++] = out[ref++];
    } else {
      ctrl++;
      if (op + ctrl > outCap || ip + ctrl > end) throw new Error('bad literal run');
      inp.copy(out, op, ip, ip + ctrl); ip += ctrl; op += ctrl;
    }
    if (ip >= end) break;
    ctrl = inp[ip++];
  }
  return out.subarray(0, op);
}

export function readGcpf(buf) {
  if (buf.slice(0, 4).toString() !== 'GCPF') throw new Error('not a GCPF file');
  const mode = buf.readUInt32LE(4), block = buf.readUInt32LE(8), total = buf.readUInt32LE(12);
  if (mode !== 0) throw new Error('compression mode ' + mode + ' not handled');
  const bc = Math.floor(total / block) + 1;
  const sizes = Array.from({ length: bc }, (_, i) => buf.readUInt32LE(16 + 4 * i));
  let pos = 16 + 4 * bc;
  const parts = [];
  sizes.forEach((sz, i) => {
    const want = i === bc - 1 ? total - block * (bc - 1) : block;
    parts.push(fastlzDecompress(buf.subarray(pos, pos + sz), Math.max(want, 1) + 16).subarray(0, want));
    pos += sz;
  });
  return Buffer.concat(parts);
}

if (process.argv[1] && process.argv[1].endsWith('wd_read.mjs')) {
  const src = process.argv[2], dst = process.argv[3] ?? '_wd_raw.bin';
  const raw = readGcpf(fs.readFileSync(src));
  fs.writeFileSync(dst, raw);
  console.log('decompressed', raw.length, 'bytes ->', dst);
  console.log(raw.subarray(0, 400).toString('latin1').replace(/[^\x20-\x7e\n]/g, '.'));
}
