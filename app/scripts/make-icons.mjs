// Draw the app icons.
//
// A phone that installs this needs PNGs — iOS ignores the manifest and reads
// `apple-touch-icon`, and it will not read an SVG. Rather than add an image
// library to a project whose whole point is that it has none, this writes the
// pixels itself: a rounded square in ink, an accent diamond, deflate, CRC,
// done. Run it when the mark changes:
//
//   node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../src/env.js';

const INK = [20, 16, 12];        // --ink-deep, the tab-bar black
const ACCENT = [224, 113, 79];   // --accent, the ember

// ---------------------------------------------------------------- the PNG --
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

/** rgba: a function (x, y) => [r, g, b, a] over a size×size square. */
function png(size, rgba) {
  // One filter byte per scanline, filter 0 (none) — simplest thing that works,
  // and at these sizes the extra bytes cost nothing worth optimising.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = rgba(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- the mark --
// Coverage-based antialiasing: sample each pixel on a 3×3 grid and mix by how
// much of it the shape covers. Cheap, and at 192px the diamond's diagonals
// would look like a staircase without it.
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function mark(size, { bleed = false } = {}) {
  const r = size * 0.22;                       // corner radius
  // A maskable icon is cropped to a circle on some launchers, so the diamond
  // stays inside the middle 60% where nothing is ever cut off.
  const half = size * (bleed ? 0.5 : 0.30);
  const cx = size / 2, cy = size / 2;

  const inSquare = (x, y) => {
    if (bleed) return true;                    // full bleed: the OS masks it
    const dx = Math.max(r - x, 0, x - (size - r));
    const dy = Math.max(r - y, 0, y - (size - r));
    return dx * dx + dy * dy <= r * r;
  };
  const inDiamond = (x, y) => Math.abs(x - cx) + Math.abs(y - cy) <= half;

  return (px, py) => {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const x = px + (sx + 0.5) / 3, y = py + (sy + 0.5) / 3;
        if (!inSquare(x, y)) continue;
        bg++;
        if (inDiamond(x, y)) fg++;
      }
    }
    if (!bg) return [0, 0, 0, 0];
    const colour = mix(INK, ACCENT, fg / bg);
    return [...colour, Math.round((bg / 9) * 255)];
  };
}

// ------------------------------------------------------------------ write --
const pub = path.join(ROOT, 'public');
const files = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  // Maskable: full bleed, because Android crops it to whatever shape it likes.
  ['icon-maskable-512.png', 512, { bleed: true }],
  // iOS composites onto its own rounded rect and does not respect alpha, so
  // this one bleeds too.
  ['apple-touch-icon.png', 180, { bleed: true }],
];

for (const [name, size, opts] of files) {
  const buf = png(size, mark(size, opts));
  fs.writeFileSync(path.join(pub, name), buf);
  console.log(`  ${name.padEnd(26)} ${size}×${size}  ${(buf.length / 1024).toFixed(1)} kB`);
}
console.log('\nicons written to public/');
