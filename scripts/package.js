#!/usr/bin/env node
// Build the Chrome Web Store upload: dist/upload-to-google-photos-<version>.zip
//
//   node scripts/package.js
//
// What it does, and why:
//   - Includes only what the extension needs at runtime (manifest, src/, icons/).
//   - Strips the "key" field. The store manages its own key pair and refuses
//     packages that carry one; "key" is only for matching the ID during local
//     development (see STORE.md step 3).
//   - Refuses to build if oauth2.client_id is still the placeholder, because a
//     store build with no client ID would install fine and then fail at sign-in.
//
// No dependencies: the ZIP writer below is the minimum needed (deflate
// entries, one central directory) and is what Chrome's uploader expects.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE_DIRS = ['src', 'icons'];

// ---------------------------------------------------------------------------
// Minimal ZIP writer
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time fields, which is all the ZIP format stores. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, day } = dosDateTime(new Date());

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), // sig, version, flags (utf8), method deflate
      u16(time), u16(day), u32(crc), u32(deflated.length), u32(data.length),
      u16(nameBuf.length), u16(0), nameBuf, deflated,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8),
      u16(time), u16(day), u32(crc), u32(deflated.length), u32(data.length),
      u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

// ---------------------------------------------------------------------------
// Collect files
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (!entry.name.startsWith('.')) out.push(full);
  }
  return out;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  if (!manifest.oauth2 || /YOUR_CLIENT_ID_HERE/.test(manifest.oauth2.client_id || '')) {
    console.error('manifest.json still has the placeholder oauth2.client_id; fill it in first (STORE.md step 4).');
    process.exit(1);
  }
  const hadKey = 'key' in manifest;
  delete manifest.key; // the store supplies its own

  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') }];
  for (const dir of INCLUDE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      entries.push({ name: path.relative(ROOT, file).split(path.sep).join('/'), data: fs.readFileSync(file) });
    }
  }

  const distDir = path.join(ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const out = path.join(distDir, `upload-to-google-photos-${manifest.version}.zip`);
  fs.writeFileSync(out, buildZip(entries));

  console.log(`wrote ${path.relative(ROOT, out)} (${entries.length} files)`);
  console.log(hadKey ? 'stripped "key" from manifest.json for the store build' : 'manifest had no "key" field');
  for (const e of entries) console.log('  ' + e.name);
}

if (require.main === module) main();

module.exports = { buildZip, crc32 };
