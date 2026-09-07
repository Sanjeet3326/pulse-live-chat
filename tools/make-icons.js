const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(OUT_DIR, { recursive: true });

function crc32(buffer) {
  let table = crc32.table;

  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }

  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));

  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;

  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, size);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CORAL = [255, 92, 61];
const AMBER = [255, 154, 43];
const GOLD = [255, 210, 90];
const CREAM = [255, 246, 224];

function mix(a, b, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * clamped),
    Math.round(a[1] + (b[1] - a[1]) * clamped),
    Math.round(a[2] + (b[2] - a[2]) * clamped),
  ];
}

function emberPixel(x, y, size) {
  const u = x / (size - 1);
  const v = y / (size - 1);

  const diagonal = (u + v) / 2;
  let colour = diagonal < 0.5
    ? mix(CORAL, AMBER, diagonal * 2)
    : mix(AMBER, GOLD, (diagonal - 0.5) * 2);

  const dx = u - 0.5;
  const dy = v - 0.5;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const dotRadius = 0.17;
  const glowRadius = 0.34;

  if (distance < glowRadius) {
    const glow = 1 - distance / glowRadius;
    colour = mix(colour, CREAM, glow * glow * 0.55);
  }

  if (distance < dotRadius) {
    const edge = Math.min(1, (dotRadius - distance) * size * 0.25);
    const highlight = 1 - Math.min(1, Math.hypot(u - 0.44, v - 0.43) / 0.22);
    const dot = mix(CREAM, [255, 255, 255], highlight * 0.8);
    colour = mix(colour, dot, edge);
  }

  return [...colour, 255];
}

const sizes = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of sizes) {
  const png = encodePng(size, emberPixel);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(name.padEnd(26), size + "x" + size, (png.length / 1024).toFixed(1) + " KB");
}
