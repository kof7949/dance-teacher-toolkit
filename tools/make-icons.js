// Generates simple placeholder PNG app icons (192x192, 512x512) with no external deps.
// Draws a rounded-square gradient background with a simple music-note + footstep glyph.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg1 = [124, 58, 237];   // violet
  const bg2 = [236, 72, 153];   // pink
  const pad = Math.round(size * 0.12);
  const radius = Math.round(size * 0.22);

  function setPixel(x, y, r, g, b, a) {
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  }

  function inRoundedSquare(x, y) {
    const x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad;
    if (x >= x0 + radius && x <= x1 - radius) return y >= y0 && y <= y1;
    if (y >= y0 + radius && y <= y1 - radius) return x >= x0 && x <= x1;
    const cxs = [x0 + radius, x1 - radius];
    const cys = [y0 + radius, y1 - radius];
    for (const cx of cxs) for (const cy of cys) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(lerp(bg1[0], bg2[0], t));
    const g = Math.round(lerp(bg1[1], bg2[1], t));
    const b = Math.round(lerp(bg1[2], bg2[2], t));
    for (let x = 0; x < size; x++) {
      if (inRoundedSquare(x, y)) setPixel(x, y, r, g, b, 255);
      else setPixel(x, y, 0, 0, 0, 0);
    }
  }

  // Simple music-note glyph in white, centered.
  const cx = size / 2, cy = size / 2;
  const noteHeadR = size * 0.11;
  const stemW = size * 0.055;
  const stemH = size * 0.36;

  function fillCircle(px, py, rad) {
    const x0 = Math.max(0, Math.floor(px - rad)), x1 = Math.min(size - 1, Math.ceil(px + rad));
    const y0 = Math.max(0, Math.floor(py - rad)), y1 = Math.min(size - 1, Math.ceil(py + rad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy <= rad * rad) setPixel(x, y, 255, 255, 255, 255);
    }
  }
  function fillRect(x0, y0, w, h) {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++)
        if (x >= 0 && x < size && y >= 0 && y < size) setPixel(x, y, 255, 255, 255, 255);
  }

  const headX = cx - size * 0.09, headY = cy + size * 0.14;
  fillCircle(headX, headY, noteHeadR);
  fillRect(headX + noteHeadR - stemW, headY - stemH, stemW, stemH);
  // flag
  fillRect(headX + noteHeadR - stemW, headY - stemH, size * 0.16, stemW * 0.9);
  fillRect(headX + noteHeadR - stemW, headY - stemH + size * 0.09, size * 0.14, stemW * 0.8);

  return encodePNG(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const buf = drawIcon(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buf);
  console.log('wrote icon-' + size + '.png', buf.length, 'bytes');
}
