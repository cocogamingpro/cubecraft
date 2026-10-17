#!/usr/bin/env node
"use strict";
// Draws a top-down map of the biomes of a world as a PNG, and prints how much of the land each one covers.
//   node biomemap.js [seed] [size in pixels] [blocks per pixel] [centre x] [centre z] [output.png]
//   node biomemap.js farm-test 800 8
// (Needs worldgen.js next to it. Development tool: the game doesn't use it.)
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const W = require(path.join(__dirname, "worldgen.js"));
const seed = process.argv[2] || "farm-test", size = +process.argv[3] || 800, step = +process.argv[4] || 8;
const cx = +process.argv[5] || 0, cz = +process.argv[6] || 0, out = process.argv[7] || `biomes-${seed}.png`;
const gen = W.createWorld(seed, W.GEN_LATEST);
const COLORS = { [W.BIOME.OCEAN]: [38, 84, 184], [W.BIOME.BEACH]: [226, 210, 150], [W.BIOME.PLAINS]: [146, 196, 80], [W.BIOME.FOREST]: [40, 120, 52],
  [W.BIOME.DESERT]: [236, 190, 90], [W.BIOME.SNOWY]: [226, 236, 244], [W.BIOME.MOUNTAINS]: [120, 120, 126] };
const rgba = Buffer.alloc(size * size * 4), count = new Array(7).fill(0);
for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
  const x = cx + (px - size / 2) * step, z = cz + (py - size / 2) * step;
  const c = gen.column(Math.floor(x), Math.floor(z));
  count[c.biome]++;
  const col = COLORS[c.biome], shade = c.biome === W.BIOME.OCEAN ? 0.7 + (c.h / W.SEA) * 0.3 : 0.85 + Math.min(0.3, (c.h - W.SEA) / 100);
  rgba.set([col[0] * shade, col[1] * shade, col[2] * shade, 255], (py * size + px) * 4);
}
const crc = (b) => { let c, k = ~0; for (const x of b) { c = (k ^ x) & 255; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; k = (k >>> 8) ^ c; } return ~k >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
const total = size * size, land = total - count[W.BIOME.OCEAN];
console.log(`${out}: ${size}x${size} pixels, ${step} blocks per pixel (${size * step} blocks across), seed "${seed}"`);
W.BIOME_INFO.forEach((b, i) => console.log(`  ${b.name.padEnd(10)} ${(100 * count[i] / total).toFixed(1).padStart(5)}% of the map${i === W.BIOME.OCEAN ? "" : `, ${(100 * count[i] / land).toFixed(1).padStart(5)}% of the land`}`));
