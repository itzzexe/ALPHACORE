// Unpacking the engine's release archive with nothing but zlib.
//
// llama.cpp ships its builds as .zip (and, for some platforms, .tar.gz). Node
// has inflate but no unzip, and adding a dependency to read one archive a year
// would be a poor trade — so this reads the two formats directly: the zip
// central directory, and tar's 512-byte headers.
//
// Every path is checked before anything is written. An archive whose entry is
// "../../etc/cron.d/x" or an absolute path is refused whole: that is the zip
// slip, and the engine archive is downloaded from the internet.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function safeTarget(root, name) {
  const clean = String(name).replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..')) {
    throw new Error(`refusing an archive entry that escapes its folder: ${name}`);
  }
  const out = path.resolve(root, clean);
  if (out !== path.resolve(root) && !out.startsWith(path.resolve(root) + path.sep)) throw new Error(`refusing ${name}`);
  return out;
}

function write(root, name, data, mode) {
  const out = safeTarget(root, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, data);
  if (mode && process.platform !== 'win32') fs.chmodSync(out, mode & 0o777);
  return out;
}

/** Read a zip held in memory into a folder. Returns the paths written. */
export function unzip(buf, root) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('zip64 archives are not supported');
  const written = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('a damaged zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const attrs = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) { safeTarget(root, name); continue; }
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`a damaged entry: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compSize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported compression in ${name}`);
    written.push(write(root, name, data, attrs >>> 16));
  }
  return written;
}

const octal = (b) => parseInt(b.toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);

/** Read a .tar.gz held in memory into a folder. Symlinks are kept only if they stay inside it. */
export function untargz(buf, root) {
  const tar = zlib.gunzipSync(buf);
  const written = [];
  let longName = null;
  let paxPath = null;
  for (let p = 0; p + 512 <= tar.length;) {
    const h = tar.subarray(p, p + 512);
    if (h.every((x) => x === 0)) break;
    const size = octal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48);
    const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    let name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (prefix && h.subarray(257, 262).toString('ascii') === 'ustar') name = `${prefix}/${name}`;
    if (longName) { name = longName; longName = null; }
    if (paxPath) { name = paxPath; paxPath = null; }
    const body = tar.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/, ''); continue; }
    if (type === 'x') { const m = body.toString('utf8').match(/\d+ path=([^\n]+)\n/); paxPath = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    if (type === '5') { fs.mkdirSync(safeTarget(root, name), { recursive: true }); continue; }
    if (type === '2') {
      const target = h.subarray(157, 257).toString('utf8').replace(/\0.*$/, '');
      const at = safeTarget(root, name);
      safeTarget(root, path.posix.join(path.posix.dirname(name.replace(/\\/g, '/')), target));
      fs.mkdirSync(path.dirname(at), { recursive: true });
      try { fs.rmSync(at, { force: true }); fs.symlinkSync(target, at); written.push(at); } catch { /* a platform without symlinks */ }
      continue;
    }
    if (type === '0' || type === '\0' || type === '7') written.push(write(root, name, body, octal(h.subarray(100, 108))));
  }
  return written;
}
